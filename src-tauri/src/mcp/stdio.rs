use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, ChildStdout};

use super::protocol::{JsonRpcRequest, JsonRpcResponse};

pub struct StdioTransport {
    child: Child,
    writer: BufWriter<ChildStdin>,
    reader: BufReader<ChildStdout>,
    next_id: AtomicU64,
}

impl StdioTransport {
    pub async fn spawn(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
        cwd: Option<&str>,
    ) -> Result<Self, String> {
        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .envs(env);

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let mut child = cmd.spawn().map_err(|e| format!("failed to spawn MCP server: {e}"))?;

        let stdin = child.stdin.take().ok_or("failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("failed to get stdout")?;

        Ok(Self {
            child,
            writer: BufWriter::new(stdin),
            reader: BufReader::new(stdout),
            next_id: AtomicU64::new(1),
        })
    }

    pub async fn request(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let req = JsonRpcRequest::new(id, method, params);
        let body = serde_json::to_string(&req).map_err(|e| e.to_string())?;

        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        self.writer
            .write_all(header.as_bytes())
            .await
            .map_err(|e| format!("write header: {e}"))?;
        self.writer
            .write_all(body.as_bytes())
            .await
            .map_err(|e| format!("write body: {e}"))?;
        self.writer
            .flush()
            .await
            .map_err(|e| format!("flush: {e}"))?;

        loop {
            let mut header_line = String::new();
            self.reader
                .read_line(&mut header_line)
                .await
                .map_err(|e| format!("read header: {e}"))?;

            if header_line.trim().is_empty() {
                continue;
            }

            if !header_line.starts_with("Content-Length:") {
                continue;
            }

            let content_length: usize = header_line
                .trim()
                .strip_prefix("Content-Length:")
                .ok_or("missing Content-Length")?
                .trim()
                .parse()
                .map_err(|e| format!("parse Content-Length: {e}"))?;

            let mut empty_line = String::new();
            self.reader
                .read_line(&mut empty_line)
                .await
                .map_err(|e| format!("read separator: {e}"))?;

            let mut buf = vec![0u8; content_length];
            tokio::io::AsyncReadExt::read_exact(&mut self.reader, &mut buf)
                .await
                .map_err(|e| format!("read body: {e}"))?;

            let resp: JsonRpcResponse = serde_json::from_slice(&buf)
                .map_err(|e| format!("parse response: {e}"))?;

            if let Some(err) = resp.error {
                return Err(format!("MCP error {}: {}", err.code, err.message));
            }

            return resp.result.ok_or_else(|| "empty result".to_string());
        }
    }

    pub async fn shutdown(&mut self) {
        let _ = self.child.kill().await;
    }
}
