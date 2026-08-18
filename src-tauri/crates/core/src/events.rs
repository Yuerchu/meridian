//! Where an event goes once it has happened.
//!
//! There used to be exactly one destination — the window — and `app.emit` was
//! called wherever something worth reporting occurred. A second destination (a
//! remote client over a socket) cannot be added that way without every call site
//! learning about it, so the call sites now name the bus and the bus knows the
//! destinations.
//!
//! The bus deliberately does not fan out over a channel. A `broadcast` would
//! make every send infallible from the sender's point of view, and that is the
//! one thing this cannot do: the desktop's events *are* its answer, so a window
//! that missed one is showing a transcript that never catches up, and the turn
//! producing it has to fail rather than carry on talking to nobody. Delivery is
//! therefore synchronous and a sink can be marked `critical`, meaning its
//! failure is the caller's failure.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tracing::debug;

/// One destination for events.
///
/// Takes the payload by reference because a bus with two sinks would otherwise
/// clone it once per sink for no reason; implementations that need an owned
/// value clone it themselves.
pub trait EventSink: Send + Sync {
    fn emit(&self, channel: &str, payload: &serde_json::Value) -> Result<(), String>;
}

/// Names a registration so it can be taken back out. A sink that outlives its
/// purpose — the socket server after it stops listening — must not keep
/// receiving, and it cannot be identified by its address once it is behind an
/// `Arc<dyn _>`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SinkId(u64);

struct SinkEntry {
    id: SinkId,
    sink: Arc<dyn EventSink>,
    /// Whether this sink failing is the emitting turn's problem. True for the
    /// window, false for anything a turn can carry on without.
    critical: bool,
}

#[derive(Clone, Default)]
pub struct EventBus(Arc<Inner>);

#[derive(Default)]
struct Inner {
    /// A `std::sync::RwLock`, not tokio's: every critical section is one walk of
    /// a list of two or three entries with nothing awaited inside, and `Drop`
    /// implementations emit, which cannot await.
    sinks: std::sync::RwLock<Vec<SinkEntry>>,
    next_id: AtomicU64,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start delivering to `sink`. `critical` says whether a failed delivery
    /// should be reported back to whoever emitted.
    pub fn register(&self, sink: Arc<dyn EventSink>, critical: bool) -> SinkId {
        let id = SinkId(self.0.next_id.fetch_add(1, Ordering::Relaxed));
        self.lock().push(SinkEntry { id, sink, critical });
        id
    }

    /// Stop delivering to a sink that has outlived its purpose. Remote access
    /// is the caller: it stops when the user turns listening off, and a fan-out
    /// left registered would be handed every event in the app for the rest of
    /// the process's life, queueing for connections that are gone.
    pub fn unregister(&self, id: SinkId) {
        self.lock().retain(|entry| entry.id != id);
    }

    /// Deliver to every sink, in registration order.
    ///
    /// Returns the first critical failure. A non-critical one is logged and
    /// otherwise invisible, and no failure stops the remaining sinks — one
    /// client dropping its connection mid-turn must not cost the others the rest
    /// of the answer.
    ///
    /// No sinks at all is success. A headless run has no window to miss an
    /// event, and treating that as failure would end every turn it made.
    pub fn emit(&self, channel: &str, payload: serde_json::Value) -> Result<(), String> {
        let mut first_critical_error = None;
        for entry in self.read().iter() {
            if let Err(e) = entry.sink.emit(channel, &payload) {
                if entry.critical {
                    if first_critical_error.is_none() {
                        first_critical_error = Some(e);
                    }
                } else {
                    // The channel, never the payload: these carry message bodies
                    // and exported logs leave the machine.
                    debug!(channel, error = %e, "event sink refused a payload");
                }
            }
        }
        match first_critical_error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    fn lock(&self) -> std::sync::RwLockWriteGuard<'_, Vec<SinkEntry>> {
        self.0.sinks.write().unwrap_or_else(|e| e.into_inner())
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, Vec<SinkEntry>> {
        self.0.sinks.read().unwrap_or_else(|e| e.into_inner())
    }
}

/// The bus, seen as a turn's progress port.
///
/// `Emit` is what a turn borrows for the length of one run; this hands whatever
/// it produces to every registered destination. The failure rule the desktop
/// depends on lives in the registration — `WindowSink` is registered as
/// critical — rather than in the type of the emitter, which is what lets one
/// implementation serve both runners.
pub struct BusEmit(pub EventBus);

impl crate::agent::engine::Emit for BusEmit {
    fn emit(&self, channel: &str, payload: serde_json::Value) -> Result<(), String> {
        self.0.emit(channel, payload)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct Recorder {
        seen: Mutex<Vec<String>>,
        fail: bool,
    }

    impl EventSink for Recorder {
        fn emit(&self, channel: &str, _payload: &serde_json::Value) -> Result<(), String> {
            self.seen.lock().unwrap().push(channel.to_string());
            if self.fail { Err("refused".into()) } else { Ok(()) }
        }
    }

    /// A run with nowhere to send its progress is not a failed run. Getting this
    /// wrong would end every turn made without a window open.
    #[test]
    fn a_bus_with_no_sinks_succeeds() {
        let bus = EventBus::new();
        assert!(bus.emit("chat-stream", serde_json::json!({})).is_ok());
    }

    /// The desktop rule: its events are the answer, so losing one ends the turn.
    #[test]
    fn a_critical_sink_reports_its_failure() {
        let bus = EventBus::new();
        bus.register(
            Arc::new(Recorder {
                fail: true,
                ..Default::default()
            }),
            true,
        );
        assert_eq!(bus.emit("chat-stream", serde_json::json!({})), Err("refused".into()));
    }

    /// And the opposite rule, which is why `critical` is a property of the
    /// registration: a remote client that has gone away costs the turn nothing.
    #[test]
    fn a_non_critical_sink_failing_is_invisible() {
        let bus = EventBus::new();
        bus.register(
            Arc::new(Recorder {
                fail: true,
                ..Default::default()
            }),
            false,
        );
        assert!(bus.emit("chat-stream", serde_json::json!({})).is_ok());
    }

    /// One sink refusing must not cost the others the rest of the turn.
    #[test]
    fn every_sink_is_offered_the_event_even_after_one_fails() {
        let bus = EventBus::new();
        let good = Arc::new(Recorder::default());
        bus.register(
            Arc::new(Recorder {
                fail: true,
                ..Default::default()
            }),
            false,
        );
        bus.register(Arc::clone(&good) as Arc<dyn EventSink>, false);

        let _ = bus.emit("conversation-updated", serde_json::json!({}));
        assert_eq!(good.seen.lock().unwrap().len(), 1);
    }

    /// A server that has stopped listening must stop receiving. Without this its
    /// queue would fill for the rest of the process's life.
    #[test]
    fn an_unregistered_sink_stops_receiving() {
        let bus = EventBus::new();
        let sink = Arc::new(Recorder::default());
        let id = bus.register(Arc::clone(&sink) as Arc<dyn EventSink>, false);

        let _ = bus.emit("chat-stream", serde_json::json!({}));
        bus.unregister(id);
        let _ = bus.emit("chat-stream", serde_json::json!({}));

        assert_eq!(sink.seen.lock().unwrap().len(), 1);
    }
}
