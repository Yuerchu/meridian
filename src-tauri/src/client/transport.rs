use crate::client::error::TransportError;
use crate::client::request::{Request, Response};
use async_trait::async_trait;
use bytes::Bytes;
use futures::StreamExt;
use futures::stream::BoxStream;
use http::HeaderMap;
use http::Method;
use http::StatusCode;

pub type ByteStream = BoxStream<'static, Result<Bytes, TransportError>>;

pub struct StreamResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub bytes: ByteStream,
}

#[async_trait]
pub trait HttpTransport: Send + Sync {
    async fn execute(&self, req: Request) -> Result<Response, TransportError>;
    async fn stream(&self, req: Request) -> Result<StreamResponse, TransportError>;
}

#[derive(Clone, Debug)]
pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    fn build(&self, req: &Request) -> Result<reqwest::RequestBuilder, TransportError> {
        let prepared = req.prepare_body_for_send().map_err(TransportError::Build)?;

        let mut builder = self.client.request(
            Method::from_bytes(req.method.as_str().as_bytes()).unwrap_or(Method::GET),
            &req.url,
        );

        if let Some(timeout) = req.timeout {
            builder = builder.timeout(timeout);
        }

        builder = builder.headers(prepared.headers);
        if let Some(body) = prepared.body {
            builder = builder.body(body);
        }
        Ok(builder)
    }

    /// Host and path only. A query string routinely carries an API key, and this
    /// value ends up in a file the user can export.
    fn safe_url(url: &str) -> String {
        match reqwest::Url::parse(url) {
            Ok(parsed) => format!("{}{}", parsed.host_str().unwrap_or("?"), parsed.path()),
            Err(_) => "?".to_string(),
        }
    }

    /// The provider's own error code, when the body is JSON shaped like
    /// `{"error": {"code": ...}}`. The message beside it can quote the request
    /// back, so only the code is taken.
    fn error_code(body: Option<&str>) -> Option<String> {
        let parsed: serde_json::Value = serde_json::from_str(body?).ok()?;
        let error = parsed.get("error")?;
        error
            .get("code")
            .or_else(|| error.get("type"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    }

    fn log_http_failure(status: StatusCode, url: &str, body: Option<&str>, streaming: bool) {
        let code = Self::error_code(body);
        // This is the single exit every provider's HTTP failure passes through —
        // 401 on a stale key, 429, 5xx. Without a record here the user sees a red
        // bubble and the log has nothing to say about it.
        tracing::error!(
            status = status.as_u16(),
            url = %Self::safe_url(url),
            error_code = code.as_deref().unwrap_or(""),
            body_len = body.map(str::len).unwrap_or(0),
            streaming,
            "provider request failed"
        );
    }

    fn map_error(err: reqwest::Error) -> TransportError {
        // `Timeout` renders as the single word "timeout", which cannot tell a
        // blocked proxy from a slow model. The kind is recorded here because it
        // is the last place that still knows.
        let kind = if err.is_timeout() {
            "timeout"
        } else if err.is_connect() {
            "connect"
        } else if err.is_body() || err.is_decode() {
            "body"
        } else if err.is_request() {
            "request"
        } else {
            "other"
        };
        // Not err.to_string(): reqwest's error chain can carry the full URL,
        // query string included.
        tracing::warn!(
            kind,
            url = %err.url().map(|u| Self::safe_url(u.as_str())).unwrap_or_default(),
            "provider request could not be completed"
        );

        if err.is_timeout() {
            TransportError::Timeout
        } else {
            TransportError::Network(err.to_string())
        }
    }
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn execute(&self, req: Request) -> Result<Response, TransportError> {
        let url = req.url.clone();
        let builder = self.build(&req)?;
        let resp = builder.send().await.map_err(Self::map_error)?;
        let status = resp.status();
        let headers = resp.headers().clone();
        let bytes = resp.bytes().await.map_err(Self::map_error)?;
        if !status.is_success() {
            let body = String::from_utf8(bytes.to_vec()).ok();
            Self::log_http_failure(status, &url, body.as_deref(), false);
            return Err(TransportError::Http {
                status,
                url: Some(url),
                headers: Some(headers),
                body,
            });
        }
        Ok(Response {
            status,
            headers,
            body: bytes,
        })
    }

    async fn stream(&self, req: Request) -> Result<StreamResponse, TransportError> {
        let url = req.url.clone();
        let builder = self.build(&req)?;
        let resp = builder.send().await.map_err(Self::map_error)?;
        let status = resp.status();
        let headers = resp.headers().clone();
        if !status.is_success() {
            let body = resp.text().await.ok();
            Self::log_http_failure(status, &url, body.as_deref(), true);
            return Err(TransportError::Http {
                status,
                url: Some(url),
                headers: Some(headers),
                body,
            });
        }
        let stream = resp
            .bytes_stream()
            .map(|result| result.map_err(Self::map_error));
        Ok(StreamResponse {
            status,
            headers,
            bytes: Box::pin(stream),
        })
    }
}
