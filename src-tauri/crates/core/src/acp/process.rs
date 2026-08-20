//! Starting the adapter, and keeping its complaints.
//!
//! Everything here is the half of [`crate::mcp::stdio`] that is about running a
//! child process rather than about talking to one, and it is copied on purpose:
//! each line of it was a bug. stderr is drained continuously because a full pipe
//! blocks the child; the last few lines are kept because a process that fails to
//! start explains itself there and nowhere else; `kill_on_drop` covers every
//! path that abandons a session without shutting it down; `CREATE_NO_WINDOW`
//! stops a console flashing on Windows.
//!
//! What is *not* copied is the request/response pairing. That lives in
//! [`super::peer`], which needs the streams whole.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tokio::io::BufReader;
use tokio::process::{Child, ChildStdin, ChildStdout};

/// Lines of the adapter's stderr kept for a failure report.
///
/// The same exception to "log a length, never the content" that MCP makes, for
/// the same reason: `command not found`, a missing module, a node stack trace.
/// Without these, "the session won't start" has no diagnosable cause. They go
/// through the same redaction as everything else.
const STDERR_TAIL_LINES: usize = 8;
const STDERR_LINE_CHARS: usize = 400;

/// A running adapter, taken apart into the pieces the peer needs.
pub struct AdapterProcess {
    pub child: Child,
    pub stdin: ChildStdin,
    pub stdout: BufReader<ChildStdout>,
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
}

impl AdapterProcess {
    /// Start `command` with `args`, wired for JSON-RPC over stdio.
    ///
    /// `cwd` is not set here even though every session has one: the adapter is
    /// told the working directory in `session/new`, and one process is meant to
    /// carry several sessions in different repositories. Launching it inside one
    /// of them would make the first session's directory silently special.
    pub async fn spawn(command: &str, args: &[String]) -> Result<Self, String> {
        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        // CREATE_NO_WINDOW: without it every adapter launch flashes a console.
        // `tokio::process::Command` carries this itself, so the std extension
        // trait is not needed.
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let mut child = cmd.spawn().map_err(|e| {
            tracing::error!(
                command = %command,
                arg_count = args.len(),
                error = %e,
                "failed to spawn the ACP adapter"
            );
            // Named explicitly: the usual cause is the command not being on
            // PATH, and an error that does not say what it tried to run sends
            // the user looking in the wrong place.
            format!("could not start `{command}`: {e}")
        })?;

        let stdin = child.stdin.take().ok_or("the adapter has no stdin")?;
        let stdout = child.stdout.take().ok_or("the adapter has no stdout")?;

        let stderr_tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
        if let Some(stderr) = child.stderr.take() {
            let tail = stderr_tail.clone();
            let command = command.to_string();
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = crate::secrets::sanitizer::redact_secrets(line);
                    let line = crate::util::take_bytes_at_char_boundary(&line, STDERR_LINE_CHARS).to_string();
                    tracing::debug!(command = %command, "acp stderr: {line}");
                    if let Ok(mut tail) = tail.lock() {
                        if tail.len() == STDERR_TAIL_LINES {
                            tail.pop_front();
                        }
                        tail.push_back(line);
                    }
                }
            });
        }

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            stderr_tail,
        })
    }

    /// A handle to the stderr tail that outlives this struct being taken apart.
    ///
    /// The peer splits the process into a reader task and a writer task, and by
    /// the time either of them discovers the adapter is gone, neither owns this
    /// value any more. Both still have to be able to say why.
    pub fn stderr_handle(&self) -> StderrTail {
        StderrTail(self.stderr_tail.clone())
    }
}

/// What the adapter last said on stderr. Cheap to clone, shared with the task
/// draining the pipe.
#[derive(Clone)]
pub struct StderrTail(Arc<Mutex<VecDeque<String>>>);

impl StderrTail {
    pub fn get(&self) -> String {
        self.0
            .lock()
            .map(|tail| tail.iter().cloned().collect::<Vec<_>>().join(" | "))
            .unwrap_or_default()
    }

    /// The tail as a suffix for an error message, or nothing at all when the
    /// adapter died silently. `format!("{e}{}", tail.suffix())` reads correctly
    /// either way.
    pub fn suffix(&self) -> String {
        let tail = self.get();
        if tail.is_empty() {
            String::new()
        } else {
            format!(" (adapter said: {tail})")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_command_that_does_not_exist_names_itself_in_the_error() {
        let Err(err) = AdapterProcess::spawn("meridian-no-such-adapter-binary", &[]).await else {
            panic!("spawning a binary that does not exist must fail");
        };
        assert!(
            err.contains("meridian-no-such-adapter-binary"),
            "the error must name what it tried to run, got: {err}"
        );
    }

    /// The tail is read by tasks that no longer own the process, so it has to
    /// survive being handed out — and read as nothing when there is nothing.
    #[test]
    fn an_empty_tail_contributes_no_suffix() {
        let tail = StderrTail(Arc::new(Mutex::new(VecDeque::new())));
        assert_eq!(tail.get(), "");
        assert_eq!(tail.suffix(), "");
    }

    #[test]
    fn a_tail_reads_oldest_first_and_is_bounded() {
        let shared = Arc::new(Mutex::new(VecDeque::new()));
        let tail = StderrTail(shared.clone());
        {
            let mut t = shared.lock().unwrap();
            for i in 0..STDERR_TAIL_LINES + 3 {
                if t.len() == STDERR_TAIL_LINES {
                    t.pop_front();
                }
                t.push_back(format!("line {i}"));
            }
        }
        let got = tail.get();
        assert!(!got.contains("line 0"), "the oldest lines are dropped");
        assert!(got.contains(&format!("line {}", STDERR_TAIL_LINES + 2)));
        assert!(tail.suffix().starts_with(" (adapter said: "));
    }
}
