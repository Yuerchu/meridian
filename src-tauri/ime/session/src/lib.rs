//! The key state machine and the table of sessions the host keeps.
//!
//! [`Session`] is one text field's worth of state: the keys typed so far, the
//! candidates for them, the page and highlight, Chinese or English mode,
//! whether the document is private. It turns one [`KeyEvent`] into one
//! [`KeyOutcome`] — eat the key or not, text to commit, a [`Frame`] to draw —
//! and it is the only thing that writes to the [`Learner`]. It is pure with
//! respect to the operating system, which is why the CLI can drive it from a
//! script and the tests can assert on golden key sequences.
//!
//! [`Router`] owns one `Session` per connected text service and the shared
//! engine and learner, decides which session's frame is on screen, and flushes
//! learning on a timer. The host wraps it in pipe I/O and nothing else.

mod chain;
pub mod keys;
mod punct;
mod router;
pub mod script;
mod session;

pub use chain::{CommitRecord, RECENT_COMMITS};
pub use punct::{PunctState, full_width_of};
pub use router::{Router, RouterConfig, SessionKey};
pub use script::parse_script;
pub use session::{KeyOutcome, LEFT_CONTEXT_CHARS, RIGHT_CONTEXT_CHARS, Session, SessionConfig};

pub use meridian_ime_engine::{Engine, InputScheme, Learner};
pub use meridian_ime_proto::{Frame, KeyEvent, Mode, Modifiers};
