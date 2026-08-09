//! Who is allowed to write to a conversation right now.
//!
//! The resource being protected is not the runner but the rows: `messages` plus
//! the `head_message_id` that names which of them are on the active path. Two
//! turns writing the same conversation do not merge into two branches the way
//! the tree was designed for — whichever finishes last owns the head, and the
//! other one's entire output stops being reachable. So the key here is the
//! conversation, and everything that writes one passes through this table:
//! desktop turns, OneBot turns, and the handful of commands that rewrite
//! history without being a turn at all.
//!
//! Leases rather than a checked flag. `if busy { return }` followed by an
//! `await` and then a write leaves room for a turn to start in between, which is
//! the race it was meant to prevent. A lease is taken atomically and released by
//! `Drop`, so every early return and every panic frees it — and turns have
//! roughly thirty ways out.
//!
//! The lock is `std::sync::Mutex`: every critical section is one map operation
//! with nothing awaited inside, and `Drop` cannot await. Poisoning is recovered
//! from rather than propagated — one turn panicking while holding it must not
//! stop every later turn in the app from starting.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use tokio_util::sync::CancellationToken;

/// Which end started a turn. Decides what happens to a message that arrives for
/// a conversation someone else is already answering: the OneBot inbox is only
/// drained by the OneBot runner, so parking a message there while the desktop
/// holds the conversation would strand it until the next QQ message happened to
/// come along.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOrigin {
    Desktop,
    OneBot,
}

struct ActiveTurn {
    turn_id: String,
    cancel: CancellationToken,
    origin: TurnOrigin,
}

enum Occupant {
    Turn(ActiveTurn),
    /// A short write that is not a turn: compaction, a subtree delete, a branch
    /// switch. No cancellation token — nothing sends these a stop.
    Mutation { operation_id: String, kind: &'static str },
}

impl Occupant {
    fn id(&self) -> &str {
        match self {
            Occupant::Turn(t) => &t.turn_id,
            Occupant::Mutation { operation_id, .. } => operation_id,
        }
    }

    fn busy(&self) -> Busy {
        match self {
            Occupant::Turn(t) => Busy::Turn(t.origin),
            Occupant::Mutation { kind, .. } => Busy::Mutation(kind),
        }
    }
}

/// Why a request was refused, in terms the caller can hand to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Busy {
    Turn(TurnOrigin),
    Mutation(&'static str),
}

impl std::fmt::Display for Busy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Busy::Turn(TurnOrigin::Desktop) => {
                write!(f, "This conversation is already answering. Wait for it to finish, or stop it first.")
            }
            Busy::Turn(TurnOrigin::OneBot) => {
                write!(f, "This conversation is being answered from QQ right now. Wait for that turn to finish.")
            }
            Busy::Mutation(kind) => {
                write!(f, "This conversation is busy: {kind} is in progress.")
            }
        }
    }
}

#[derive(Default)]
pub struct TurnCoordinator {
    occupied: Mutex<HashMap<String, Occupant>>,
}

impl TurnCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Occupant>> {
        self.occupied.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Take the conversation for a turn, or say who already has it.
    pub fn try_acquire_turn(
        self: &Arc<Self>,
        conversation_id: &str,
        origin: TurnOrigin,
    ) -> Result<TurnLease, Busy> {
        self.try_acquire_turn_as(conversation_id, origin, uuid::Uuid::new_v4().to_string())
    }

    /// Same, under an id the caller already has.
    ///
    /// The desktop mints its id in the front end, before it sends, because the
    /// composer locks at that moment and everything arriving afterwards has to
    /// be measurable against it — including the previous turn's stop, which can
    /// be delivered after that turn's rejection has already unlocked the
    /// composer. An id minted here would not exist until the command had been
    /// dispatched, taken the conversation and resolved a provider, and the gap
    /// is where a stale stop gets mistaken for this turn's.
    ///
    /// The id is not trusted for anything but matching: it names a turn within
    /// one conversation, and the occupancy check below is what actually decides
    /// whether the turn may run.
    pub fn try_acquire_turn_as(
        self: &Arc<Self>,
        conversation_id: &str,
        origin: TurnOrigin,
        turn_id: String,
    ) -> Result<TurnLease, Busy> {
        let cancel = CancellationToken::new();
        {
            let mut map = self.lock();
            if let Some(occupant) = map.get(conversation_id) {
                return Err(occupant.busy());
            }
            map.insert(
                conversation_id.to_string(),
                Occupant::Turn(ActiveTurn {
                    turn_id: turn_id.clone(),
                    cancel: cancel.clone(),
                    origin,
                }),
            );
        }
        Ok(TurnLease {
            coordinator: Arc::clone(self),
            conversation_id: conversation_id.to_string(),
            turn_id,
            cancel,
        })
    }

    /// Take the conversation for a write that is not a turn.
    ///
    /// Shares the occupancy table with turns on purpose: two tables would mean
    /// two lookups, and a turn could start between them.
    pub fn try_acquire_mutation(
        self: &Arc<Self>,
        conversation_id: &str,
        kind: &'static str,
    ) -> Result<MutationLease, Busy> {
        let operation_id = uuid::Uuid::new_v4().to_string();
        {
            let mut map = self.lock();
            if let Some(occupant) = map.get(conversation_id) {
                return Err(occupant.busy());
            }
            map.insert(
                conversation_id.to_string(),
                Occupant::Mutation { operation_id: operation_id.clone(), kind },
            );
        }
        Ok(MutationLease {
            coordinator: Arc::clone(self),
            conversation_id: conversation_id.to_string(),
            operation_id,
        })
    }

    /// Signal the turn running for this conversation to stop.
    ///
    /// `turn_id` names which run the caller meant. A stop aimed at a turn that
    /// has already ended must not cancel whatever started after it — the front
    /// end can only tell them apart by id, and without the check "stop, then
    /// send again" cancelled the new turn about as often as the old one.
    /// Returns whether a matching turn was found.
    pub fn cancel(&self, conversation_id: &str, turn_id: Option<&str>) -> bool {
        let map = self.lock();
        match map.get(conversation_id) {
            Some(Occupant::Turn(t)) if turn_id.is_none_or(|id| id == t.turn_id) => {
                t.cancel.cancel();
                true
            }
            _ => false,
        }
    }

    /// Release, but only if the entry is still the one the lease took.
    ///
    /// A guard can outlive its own release — a task cancelled mid-drop, an old
    /// runner unwinding while a new one has already started. Removing blindly
    /// would take the new turn's token with it, and nothing would be able to
    /// stop that turn afterwards.
    fn release(&self, conversation_id: &str, id: &str) {
        let mut map = self.lock();
        if map.get(conversation_id).is_some_and(|o| o.id() == id) {
            map.remove(conversation_id);
        }
    }
}

/// Held on the runner's stack for the whole turn, follow-up rounds included.
pub struct TurnLease {
    coordinator: Arc<TurnCoordinator>,
    conversation_id: String,
    turn_id: String,
    cancel: CancellationToken,
}

impl TurnLease {
    pub fn turn_id(&self) -> &str {
        &self.turn_id
    }

    pub fn cancel_token(&self) -> &CancellationToken {
        &self.cancel
    }
}

impl Drop for TurnLease {
    fn drop(&mut self) {
        self.coordinator.release(&self.conversation_id, &self.turn_id);
    }
}

/// Held across one write. Short by construction: anything long enough to want a
/// stop button is a turn.
pub struct MutationLease {
    coordinator: Arc<TurnCoordinator>,
    conversation_id: String,
    operation_id: String,
}

impl Drop for MutationLease {
    fn drop(&mut self) {
        self.coordinator.release(&self.conversation_id, &self.operation_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coordinator() -> Arc<TurnCoordinator> {
        Arc::new(TurnCoordinator::new())
    }

    #[test]
    fn a_second_turn_is_refused_while_the_first_holds_the_conversation() {
        let c = coordinator();
        let first = c.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
        assert_eq!(
            c.try_acquire_turn("conv-1", TurnOrigin::Desktop).err(),
            Some(Busy::Turn(TurnOrigin::Desktop)),
        );
        // Different conversations do not contend.
        assert!(c.try_acquire_turn("conv-2", TurnOrigin::Desktop).is_ok());
        drop(first);
        assert!(c.try_acquire_turn("conv-1", TurnOrigin::Desktop).is_ok());
    }

    /// The refusal has to say which end is holding it, because that decides what
    /// the caller does next: QQ queues behind its own runner and turns a desktop
    /// turn away.
    #[test]
    fn the_refusal_names_the_origin_that_holds_it() {
        let c = coordinator();
        let _held = c.try_acquire_turn("conv-1", TurnOrigin::OneBot).expect("free");
        assert_eq!(
            c.try_acquire_turn("conv-1", TurnOrigin::Desktop).err(),
            Some(Busy::Turn(TurnOrigin::OneBot)),
        );
    }

    /// The whole reason turns and non-turn writes share one table. Two tables
    /// would each report the conversation free.
    #[test]
    fn a_mutation_and_a_turn_exclude_each_other() {
        let c = coordinator();
        let lease = c.try_acquire_mutation("conv-1", "compact").expect("free");
        assert_eq!(
            c.try_acquire_turn("conv-1", TurnOrigin::Desktop).err(),
            Some(Busy::Mutation("compact")),
        );
        drop(lease);

        let _turn = c.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
        assert_eq!(
            c.try_acquire_mutation("conv-1", "delete").err(),
            Some(Busy::Turn(TurnOrigin::Desktop)),
        );
    }

    /// A panic unwinds through the lease, which is the only cleanup path a
    /// panicking turn has.
    #[test]
    fn a_panicking_turn_releases_its_conversation() {
        let c = coordinator();
        let held = Arc::clone(&c);
        let _ = std::thread::spawn(move || {
            let _lease = held.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
            panic!("the turn died");
        })
        .join();

        assert!(c.try_acquire_turn("conv-1", TurnOrigin::Desktop).is_ok());
    }

    /// The reason release is identity-checked. Without it the late guard would
    /// take the new turn's entry with it, and nothing could stop that turn.
    #[test]
    fn a_late_guard_does_not_release_the_turn_that_replaced_it() {
        let c = coordinator();
        let old = c.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
        let old_id = old.turn_id().to_string();
        drop(old);

        let new = c.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
        assert_ne!(new.turn_id(), old_id);

        // Whatever the old guard would have done on its way out.
        c.release("conv-1", &old_id);

        assert!(
            c.try_acquire_turn("conv-1", TurnOrigin::Desktop).is_err(),
            "the new turn must still hold the conversation",
        );
        assert!(c.cancel("conv-1", Some(new.turn_id())), "and must still be stoppable");
    }

    #[test]
    fn a_stop_aimed_at_a_finished_turn_does_not_cancel_the_next_one() {
        let c = coordinator();
        let old = c.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
        let old_id = old.turn_id().to_string();
        drop(old);

        let new = c.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
        assert!(!c.cancel("conv-1", Some(&old_id)), "no turn under that id any more");
        assert!(!new.cancel_token().is_cancelled());

        assert!(c.cancel("conv-1", Some(new.turn_id())));
        assert!(new.cancel_token().is_cancelled());
    }

    /// The front end may not know which run it is looking at — a reload loses
    /// the id. Without one, stop means "whatever is running here now".
    #[test]
    fn a_stop_without_an_id_cancels_whatever_is_running() {
        let c = coordinator();
        assert!(!c.cancel("conv-1", None), "nothing to stop");
        let lease = c.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
        assert!(c.cancel("conv-1", None));
        assert!(lease.cancel_token().is_cancelled());
    }

    /// Cancelling is not releasing: the runner still has to unwind, and until it
    /// does the conversation is still occupied.
    #[test]
    fn cancelling_leaves_the_conversation_occupied_until_the_runner_unwinds() {
        let c = coordinator();
        let lease = c.try_acquire_turn("conv-1", TurnOrigin::Desktop).expect("free");
        c.cancel("conv-1", None);
        assert!(c.try_acquire_turn("conv-1", TurnOrigin::Desktop).is_err());
        drop(lease);
        assert!(c.try_acquire_turn("conv-1", TurnOrigin::Desktop).is_ok());
    }

    /// A mutation is not a turn, so nothing can send it a stop — and a stop
    /// aimed at the conversation must not report success as though it had.
    #[test]
    fn a_mutation_cannot_be_cancelled() {
        let c = coordinator();
        let _lease = c.try_acquire_mutation("conv-1", "delete").expect("free");
        assert!(!c.cancel("conv-1", None));
    }

    /// One turn panicking while holding the lock must not take the rest of the
    /// app's turns down with it.
    #[test]
    fn a_poisoned_lock_still_hands_out_the_table() {
        let c = coordinator();
        let poisoner = Arc::clone(&c);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock();
            panic!("a turn died holding the lock");
        })
        .join();

        assert!(c.try_acquire_turn("conv-1", TurnOrigin::Desktop).is_ok());
    }
}
