//! How an event leaves this machine.
//!
//! One socket per connected device, carrying every channel. The frames are
//! `{"channel": ..., "payload": ...}` — the same two things `listen()` takes on
//! the other side, so the client's dispatch is the same shape whether it is
//! talking to Tauri or to this.
//!
//! ## Why one connection, and why it may be dropped
//!
//! Ordering is the reason for one connection: `chat-stream` deltas only make
//! sense in the order they were produced, and two sockets have no order between
//! them. A single writer task per connection means the frame order is the emit
//! order, which is what lets the client keep the buffering it already does for
//! the desktop.
//!
//! Backpressure is the reason a connection can be dropped. A device that has
//! stopped reading — asleep, out of range — must not make the turn wait, and a
//! queue that grows instead is a leak that ends in the process dying rather than
//! the connection. So each one gets a bounded queue and a full queue closes it.
//! Nothing is replayed afterwards: a client that missed part of a stream cannot
//! catch up by being sent the rest, so it reconnects and asks for the
//! conversation again. Losing frames is recoverable; pretending they arrived is
//! not.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use meridian_core::events::EventSink;
use tokio::sync::mpsc;

use super::SharedState;

/// Frames a connection may fall behind by before it is closed. A turn streaming
/// hard produces a few hundred over its lifetime, so this is a device that has
/// stopped reading rather than one that is merely slow.
const QUEUE_DEPTH: usize = 1024;

/// How long a socket has to prove itself before it is closed. Long enough for a
/// phone waking up its radio, short enough that an unauthenticated connection is
/// not a way to hold resources.
const AUTH_TIMEOUT: Duration = Duration::from_secs(5);

/// The connected devices, as somewhere an event can go.
#[derive(Default)]
pub(crate) struct WsFanout {
    conns: std::sync::Mutex<Vec<Conn>>,
    next_id: AtomicU64,
}

struct Conn {
    id: u64,
    tx: mpsc::Sender<String>,
}

impl WsFanout {
    fn add(&self, tx: mpsc::Sender<String>) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.lock().push(Conn { id, tx });
        id
    }

    fn remove(&self, id: u64) {
        self.lock().retain(|c| c.id != id);
    }

    pub(crate) fn len(&self) -> usize {
        self.lock().len()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Conn>> {
        self.conns.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl EventSink for WsFanout {
    /// Never fails. Registered non-critical for exactly this reason: a device
    /// that has gone away is not the turn's problem, and treating it as one
    /// would let anyone with a flaky connection kill answers being written for
    /// somebody else.
    fn emit(&self, channel: &str, payload: &serde_json::Value) -> Result<(), String> {
        let frame = serde_json::json!({ "channel": channel, "payload": payload }).to_string();

        let mut dropped = Vec::new();
        {
            let conns = self.lock();
            for conn in conns.iter() {
                // `try_send`, never `send`: this is called from inside turns and
                // from `Drop`, neither of which can afford to wait on a socket.
                if conn.tx.try_send(frame.clone()).is_err() {
                    dropped.push(conn.id);
                }
            }
        }
        for id in dropped {
            // Either the queue filled or the writer is gone. Both mean this
            // connection has already missed something, so it is closed rather
            // than left to receive a transcript with a hole in it.
            tracing::debug!(conn = id, "dropping a remote connection that fell behind");
            self.remove(id);
        }
        Ok(())
    }
}

pub(crate) async fn handler(ws: WebSocketUpgrade, State(state): State<Arc<SharedState>>) -> Response {
    ws.on_upgrade(move |socket| run(socket, state))
}

/// The first frame is the token.
///
/// It cannot be a header: a browser's `WebSocket` constructor does not let a
/// page set one. It is deliberately not a query parameter either — those end up
/// in logs and in `ps` output, and this one is the whole boundary.
async fn authenticate(socket: &mut WebSocket, config: &super::ListenConfig) -> bool {
    let first = match tokio::time::timeout(AUTH_TIMEOUT, socket.recv()).await {
        Ok(Some(Ok(Message::Text(t)))) => t,
        // Timed out, closed, or opened with something that is not text.
        _ => return false,
    };
    let presented = serde_json::from_str::<serde_json::Value>(&first)
        .ok()
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(str::to_string))
        .unwrap_or_default();

    super::http::token_ok(config, &presented)
}

async fn run(mut socket: WebSocket, state: Arc<SharedState>) {
    if !authenticate(&mut socket, &state.config).await {
        tracing::debug!("a remote websocket failed to authenticate");
        let _ = socket.send(Message::Close(None)).await;
        return;
    }

    let (tx, mut rx) = mpsc::channel::<String>(QUEUE_DEPTH);
    let id = state.fanout.add(tx);
    state.connections.store(state.fanout.len(), Ordering::Relaxed);
    tracing::info!(conn = id, "a device attached");

    // Sent before anything else so the client knows the socket is live and what
    // it is talking to, without having to wait for the first event.
    let hello = serde_json::json!({
        "channel": "remote-ready",
        "payload": { "apiRev": super::http::API_REV },
    })
    .to_string();
    if socket.send(Message::Text(hello.into())).await.is_err() {
        state.fanout.remove(id);
        state.connections.store(state.fanout.len(), Ordering::Relaxed);
        return;
    }

    let (mut sink, mut stream) = {
        use futures::StreamExt;
        socket.split()
    };

    // Two halves, and whichever finishes first ends the connection. The read
    // half exists to notice a close and to answer pings; nothing a client sends
    // after the token is acted on. Commands go over HTTP, where a failure has
    // somewhere to be reported.
    let writer = async move {
        use futures::SinkExt;
        while let Some(frame) = rx.recv().await {
            if sink.send(Message::Text(frame.into())).await.is_err() {
                break;
            }
        }
    };
    let reader = async move {
        use futures::StreamExt;
        while let Some(Ok(msg)) = stream.next().await {
            if matches!(msg, Message::Close(_)) {
                break;
            }
        }
    };

    tokio::select! {
        _ = writer => {}
        _ = reader => {}
    }

    state.fanout.remove(id);
    state.connections.store(state.fanout.len(), Ordering::Relaxed);
    tracing::info!(conn = id, "a device detached");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fanout_with(depth: usize) -> (Arc<WsFanout>, mpsc::Receiver<String>) {
        let fanout = Arc::new(WsFanout::default());
        let (tx, rx) = mpsc::channel(depth);
        fanout.add(tx);
        (fanout, rx)
    }

    #[test]
    fn an_event_reaches_a_connected_device() {
        let (fanout, mut rx) = fanout_with(4);
        fanout
            .emit("chat-stream", &serde_json::json!({ "type": "delta" }))
            .unwrap();

        let frame: serde_json::Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(frame["channel"], "chat-stream");
        assert_eq!(frame["payload"]["type"], "delta");
    }

    /// The rule the whole module is shaped around: a device that stopped
    /// reading gets disconnected, and the turn producing the events does not
    /// find out.
    #[test]
    fn a_device_that_stops_reading_is_dropped_rather_than_waited_for() {
        let (fanout, _rx) = fanout_with(1);
        // Fills the queue, then overflows it.
        assert!(fanout.emit("chat-stream", &serde_json::json!({})).is_ok());
        assert!(fanout.emit("chat-stream", &serde_json::json!({})).is_ok());

        assert_eq!(fanout.len(), 0, "the connection should have been dropped");
    }

    /// A closed receiver is the other way a connection goes bad, and it must
    /// not be reported to the caller either.
    #[test]
    fn a_closed_connection_is_forgotten_silently() {
        let (fanout, rx) = fanout_with(4);
        drop(rx);

        assert!(fanout.emit("conversation-updated", &serde_json::json!({})).is_ok());
        assert_eq!(fanout.len(), 0);
    }

    /// Every connected device gets every event; there is no per-connection
    /// filtering yet, and the client filters by conversation as it already does
    /// for the desktop.
    #[test]
    fn every_device_gets_the_event() {
        let fanout = Arc::new(WsFanout::default());
        let (tx1, mut rx1) = mpsc::channel(4);
        let (tx2, mut rx2) = mpsc::channel(4);
        fanout.add(tx1);
        fanout.add(tx2);

        fanout.emit("compact-start", &serde_json::json!({})).unwrap();

        assert!(rx1.try_recv().is_ok());
        assert!(rx2.try_recv().is_ok());
    }
}
