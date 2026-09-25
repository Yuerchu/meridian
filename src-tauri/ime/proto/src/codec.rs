//! Length-prefixed JSON frames over any `Read`/`Write`.

use std::io::{Read, Write};

use serde::Serialize;
use serde::de::DeserializeOwned;

/// Largest frame either side will accept. A frame is a key event or a page of
/// candidates; a megabyte is a bug, not a big dictionary.
pub const MAX_FRAME: usize = 1 << 20;

#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("frame of {0} bytes exceeds the {MAX_FRAME}-byte limit")]
    Oversize(u32),
    #[error("malformed frame: {0}")]
    Json(#[from] serde_json::Error),
}

/// Writes one frame. Flushes, because the peer is waiting on exactly this.
pub fn write_message<W: Write, T: Serialize>(w: &mut W, msg: &T) -> Result<(), CodecError> {
    let body = serde_json::to_vec(msg)?;
    if body.len() > MAX_FRAME {
        return Err(CodecError::Oversize(body.len() as u32));
    }
    let mut frame = Vec::with_capacity(4 + body.len());
    frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
    frame.extend_from_slice(&body);
    w.write_all(&frame)?;
    w.flush()?;
    Ok(())
}

/// Reads one frame. `Ok(None)` is a clean end of stream *between* frames; an
/// end of stream inside a frame is an `UnexpectedEof` error, because the peer
/// went away mid-sentence.
pub fn read_message<R: Read, T: DeserializeOwned>(r: &mut R) -> Result<Option<T>, CodecError> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_le_bytes(len);
    if len as usize > MAX_FRAME {
        return Err(CodecError::Oversize(len));
    }
    let mut body = vec![0u8; len as usize];
    r.read_exact(&mut body)?;
    Ok(Some(serde_json::from_slice(&body)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClientMessage, KeyEvent, Modifiers, PROTOCOL_VERSION, ServerMessage};

    #[test]
    fn codec_roundtrip() {
        let mut buf = Vec::new();
        let hello = ClientMessage::Hello {
            version: PROTOCOL_VERSION,
            kind: crate::ClientKind::Ime,
            session_id: 7,
            profile: crate::Profile::PinyinSimplified,
            app_name: Some("notepad.exe".into()),
            pid: 42,
        };
        write_message(&mut buf, &hello).unwrap();
        write_message(
            &mut buf,
            &ClientMessage::Key {
                session_id: 7,
                event: KeyEvent {
                    vk: 0x41,
                    ch: Some('a'),
                    mods: Modifiers::default(),
                    caps_lock: false,
                },
                surrounding: None,
            },
        )
        .unwrap();
        let mut cursor = std::io::Cursor::new(buf);
        let a: ClientMessage = read_message(&mut cursor).unwrap().unwrap();
        assert!(matches!(a, ClientMessage::Hello { session_id: 7, .. }));
        let b: ClientMessage = read_message(&mut cursor).unwrap().unwrap();
        assert!(matches!(b, ClientMessage::Key { .. }));
        let c: Option<ClientMessage> = read_message(&mut cursor).unwrap();
        assert!(c.is_none(), "clean EOF at a frame boundary is None");
    }

    #[test]
    fn eof_inside_a_frame_is_an_error() {
        let mut buf = Vec::new();
        write_message(&mut buf, &ServerMessage::Ack).unwrap();
        buf.truncate(buf.len() - 1);
        let mut cursor = std::io::Cursor::new(buf);
        let r: Result<Option<ServerMessage>, _> = read_message(&mut cursor);
        assert!(matches!(r, Err(CodecError::Io(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof));
    }

    #[test]
    fn oversize_frame_rejected() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&((MAX_FRAME + 1) as u32).to_le_bytes());
        let mut cursor = std::io::Cursor::new(buf);
        let r: Result<Option<ServerMessage>, _> = read_message(&mut cursor);
        assert!(matches!(r, Err(CodecError::Oversize(_))));
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let json = br#"{"type":"reset","session_id":3,"future_field":true}"#;
        let mut buf = Vec::new();
        buf.extend_from_slice(&(json.len() as u32).to_le_bytes());
        buf.extend_from_slice(json);
        let mut cursor = std::io::Cursor::new(buf);
        let m: ClientMessage = read_message(&mut cursor).unwrap().unwrap();
        assert!(matches!(m, ClientMessage::Reset { session_id: 3 }));
    }
}
