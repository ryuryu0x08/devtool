//! The relay's server: on 127.0.0.1, it takes a request with a token it handed out, finds the
//! route, and sends the request to the route's upstreams in order with the upstream's key in place
//! of the token. A connection error, 429 or 5xx moves on to the next upstream; the answer that
//! ends it is passed back as it comes (streamed replies stay streamed).
//!
//! Turned away: requests for another host name (a web page that pointed its own name here, DNS
//! rebinding), and requests without a known token. Browser pages may call it (CORS), with a token.

use crate::config::{AuthStyle, Config, Route};
use crate::log::{Entry, Log};
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::Response;
use axum::Router;
use bytes::Bytes;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::RwLock;

/// The largest request body passed on (API requests are JSON, with images at most a few MB).
pub const MAX_BODY: usize = 64 * 1024 * 1024;

pub struct Relay {
    pub config: RwLock<Config>,
    pub log: Mutex<Log>,
    /// Straight to the API (no system proxy: an internal address must not go through one).
    direct: reqwest::Client,
    /// Through the system's proxy, for upstreams that ask for it.
    proxied: reqwest::Client,
}

impl Relay {
    pub fn new(config: Config) -> Arc<Relay> {
        let build = |proxy: bool| {
            let b = reqwest::Client::builder().connect_timeout(Duration::from_secs(15));
            let b = if proxy { b } else { b.no_proxy() };
            b.build().expect("an HTTP client with these settings")
        };
        Arc::new(Relay {
            config: RwLock::new(config),
            log: Mutex::new(Log::new(300)),
            direct: build(false),
            proxied: build(true),
        })
    }
}

/// Listens on 127.0.0.1:`port`. An error (most often: the port is taken) is the caller's to show:
/// the port is not changed by itself, since the clients are set up with it.
pub async fn bind(port: u16) -> std::io::Result<TcpListener> {
    TcpListener::bind(("127.0.0.1", port)).await
}

/// Serves until `shutdown` completes.
pub async fn serve(
    listener: TcpListener,
    relay: Arc<Relay>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let app = Router::new().fallback(handle).with_state(relay);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
}

async fn handle(State(relay): State<Arc<Relay>>, req: Request) -> Response {
    let origin = req.headers().get(header::ORIGIN).cloned();
    let mut resp = if !from_this_machine(req.headers()) {
        error(
            StatusCode::FORBIDDEN,
            "permission_error",
            "接口中继只接受发给本机地址的请求",
        )
    } else if req.method() == Method::OPTIONS
        && origin.is_some()
        && req
            .headers()
            .contains_key(header::ACCESS_CONTROL_REQUEST_METHOD)
    {
        preflight(req.headers())
    } else {
        relay_request(&relay, req).await
    };
    if let Some(o) = origin {
        let h = resp.headers_mut();
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
        h.insert(header::VARY, HeaderValue::from_static("Origin"));
        h.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static("*"),
        );
    }
    resp
}

/// The request was addressed to this machine (its Host header, if any, is 127.0.0.1, localhost
/// or ::1).
pub fn from_this_machine(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|h| h.to_str().ok()) else {
        return true;
    };
    let host = host.trim().to_ascii_lowercase();
    let name = if host.starts_with('[') {
        host.split_inclusive(']').next().unwrap_or("").to_string()
    } else {
        host.split(':').next().unwrap_or("").to_string()
    };
    matches!(name.as_str(), "127.0.0.1" | "localhost" | "[::1]")
}

fn preflight(headers: &HeaderMap) -> Response {
    let asked = headers
        .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
        .cloned()
        .unwrap_or(HeaderValue::from_static("*"));
    let mut r = Response::new(Body::empty());
    *r.status_mut() = StatusCode::NO_CONTENT;
    let h = r.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"),
    );
    h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, asked);
    h.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    r
}

/// The token a client sent: `x-api-key`, or `Authorization: Bearer`.
pub fn client_token(headers: &HeaderMap) -> Option<String> {
    if let Some(k) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        let k = k.trim();
        if !k.is_empty() {
            return Some(k.to_string());
        }
    }
    let auth = headers.get(header::AUTHORIZATION)?.to_str().ok()?.trim();
    let (scheme, rest) = auth.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer") && !rest.trim().is_empty())
        .then(|| rest.trim().to_string())
}

/// Request headers not passed on: this hop's own, the client's credentials (the upstream's key
/// goes instead), and the browser's origin.
fn passed_on(name: &HeaderName) -> bool {
    !matches!(
        name.as_str(),
        "host"
            | "content-length"
            | "connection"
            | "keep-alive"
            | "proxy-authorization"
            | "proxy-connection"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "authorization"
            | "x-api-key"
            | "origin"
            | "referer"
    )
}

/// Reply headers not passed back: this hop's own.
fn passed_back(name: &HeaderName) -> bool {
    !matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-connection"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

async fn relay_request(relay: &Relay, req: Request) -> Response {
    let started = Instant::now();
    let method = req.method().clone();
    let path_q = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "/".into());
    // The path only, in the log: a query can carry a key.
    let path = req.uri().path().to_string();
    let headers = req.headers().clone();

    let Some(token) = client_token(&headers) else {
        return error(
            StatusCode::UNAUTHORIZED,
            "authentication_error",
            "缺少 token (x-api-key 或 Authorization: Bearer)",
        );
    };
    let (route, token_id, token_name) = {
        let config = relay.config.read().await;
        match config.find_token(&token) {
            Some((r, t)) => (r.clone(), t.id.clone(), t.name.clone()),
            None => {
                return error(
                    StatusCode::UNAUTHORIZED,
                    "authentication_error",
                    "token 无效或已停用",
                )
            }
        }
    };
    let body = match axum::body::to_bytes(req.into_body(), MAX_BODY).await {
        Ok(b) => b,
        Err(_) => {
            return error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request_too_large",
                "请求太大",
            )
        }
    };

    let mut entry = Entry::new(&route.name, &token_name, method.as_str(), &path);
    let resp = send(relay, &route, &method, &path_q, &headers, body, &mut entry).await;
    entry.status = resp.status().as_u16();
    entry.ms = started.elapsed().as_millis() as u64;
    relay
        .log
        .lock()
        .expect("the log lock")
        .add(&token_id, entry);
    resp
}

/// Tries the route's upstreams in order; the reply that ends it is streamed back.
async fn send(
    relay: &Relay,
    route: &Route,
    method: &Method,
    path_q: &str,
    headers: &HeaderMap,
    body: Bytes,
    entry: &mut Entry,
) -> Response {
    let ups: Vec<_> = route.upstreams.iter().filter(|u| u.enabled).collect();
    if ups.is_empty() {
        // Said so that whoever sees it (the client's error, the window's log) knows what to do.
        let why = if route.upstreams.is_empty() {
            "还没有添加上游"
        } else {
            "上游都已停用"
        };
        entry.note = format!("没有可用的上游: {why}");
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "api_error",
            &format!("接口中继的入口 \"{}\" 没有可用的上游 ({why}): 在接口中继里添加上游, 或打开已有上游的开关", route.name),
        );
    }
    let mut tried: Vec<String> = Vec::new();
    for (i, up) in ups.iter().enumerate() {
        let last = i + 1 == ups.len();
        let url = format!("{}{}", up.base_url.trim_end_matches('/'), path_q);
        let client = if up.system_proxy {
            &relay.proxied
        } else {
            &relay.direct
        };
        let mut rb = client.request(method.clone(), &url);
        for (k, v) in headers.iter().filter(|(k, _)| passed_on(k)) {
            rb = rb.header(k, v);
        }
        rb = match up.auth {
            AuthStyle::XApiKey => rb.header("x-api-key", &up.key),
            AuthStyle::Bearer => rb.header(header::AUTHORIZATION, format!("Bearer {}", up.key)),
        };
        entry.upstream = up.name.clone();
        match rb.body(body.clone()).send().await {
            Ok(r)
                if !last
                    && (r.status() == StatusCode::TOO_MANY_REQUESTS
                        || r.status().is_server_error()) =>
            {
                tried.push(format!("{} {}", up.name, r.status().as_u16()));
            }
            Ok(r) => {
                if !tried.is_empty() {
                    entry.note = format!("先试了: {}", tried.join(", "));
                }
                return pass_back(r);
            }
            Err(e) if !last => tried.push(format!("{} 连不上 ({})", up.name, short(&e))),
            Err(e) => {
                tried.push(format!("{} 连不上 ({})", up.name, short(&e)));
                entry.note = tried.join(", ");
                return error(
                    StatusCode::BAD_GATEWAY,
                    "api_error",
                    &format!("上游都连不上: {}", tried.join(", ")),
                );
            }
        }
    }
    unreachable!("the last upstream always returns")
}

fn pass_back(r: reqwest::Response) -> Response {
    let mut out = Response::new(Body::empty());
    *out.status_mut() = r.status();
    for (k, v) in r.headers().iter().filter(|(k, _)| passed_back(k)) {
        out.headers_mut().append(k, v.clone());
    }
    *out.body_mut() = Body::from_stream(r.bytes_stream());
    out
}

/// The error's kind and the address, without the request's details.
fn short(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "超时".into()
    } else if e.is_connect() {
        "无法连接".into()
    } else {
        e.to_string()
    }
}

/// An error in the shape both Anthropic's and OpenAI's clients read: {"error": {type, message}}.
fn error(status: StatusCode, kind: &str, message: &str) -> Response {
    let body =
        serde_json::json!({ "type": "error", "error": { "type": kind, "message": message } });
    let mut r = Response::new(Body::from(body.to_string()));
    *r.status_mut() = status;
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut m = HeaderMap::new();
        for (k, v) in pairs {
            m.insert(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        m
    }

    #[test]
    fn only_requests_addressed_to_this_machine() {
        assert!(from_this_machine(&h(&[("host", "127.0.0.1:8790")])));
        assert!(from_this_machine(&h(&[("host", "LOCALHOST:8790")])));
        assert!(from_this_machine(&h(&[("host", "[::1]:8790")])));
        assert!(from_this_machine(&h(&[])));
        assert!(!from_this_machine(&h(&[("host", "evil.example:8790")])));
        assert!(!from_this_machine(&h(&[(
            "host",
            "127.0.0.1.evil.example"
        )])));
    }

    #[test]
    fn the_token_from_either_header() {
        assert_eq!(
            client_token(&h(&[("x-api-key", "rl-a")])),
            Some("rl-a".into())
        );
        assert_eq!(
            client_token(&h(&[("authorization", "Bearer rl-b")])),
            Some("rl-b".into())
        );
        assert_eq!(
            client_token(&h(&[("authorization", "bearer  rl-c ")])),
            Some("rl-c".into())
        );
        assert_eq!(
            client_token(&h(&[
                ("x-api-key", "rl-a"),
                ("authorization", "Bearer rl-b")
            ])),
            Some("rl-a".into())
        );
        assert_eq!(client_token(&h(&[("authorization", "Basic abc")])), None);
        assert_eq!(client_token(&h(&[("authorization", "Bearer ")])), None);
        assert_eq!(client_token(&h(&[])), None);
    }
}
