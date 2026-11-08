//! The relay between a client and stand-in upstreams, over real sockets: the key that reaches the
//! upstream, the path, failing over, streaming, what is turned away, and what is logged.

use axum::body::Body;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::response::Response;
use axum::Router;
use relay_core::config::{new_token, AuthStyle, Config, Protocol, Route, Upstream};
use relay_core::proxy::{self, Relay};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
struct Seen {
    method: String,
    uri: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// A stand-in API answering `status`; `/stream` answers three chunks 300 ms apart.
async fn upstream(status: u16) -> (String, Arc<Mutex<Vec<Seen>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s = seen.clone();
    let app = Router::new().fallback(move |req: Request| {
        let s = s.clone();
        async move {
            let (parts, body) = req.into_parts();
            let body = axum::body::to_bytes(body, usize::MAX)
                .await
                .unwrap()
                .to_vec();
            let headers = parts
                .headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect();
            s.lock().unwrap().push(Seen {
                method: parts.method.to_string(),
                uri: parts.uri.to_string(),
                headers,
                body,
            });
            if parts.uri.path().ends_with("/stream") {
                let chunks = futures_util::stream::unfold(0, |i| async move {
                    if i == 3 {
                        return None;
                    }
                    if i > 0 {
                        tokio::time::sleep(Duration::from_millis(300)).await;
                    }
                    Some((
                        Ok::<_, std::io::Error>(bytes::Bytes::from(format!("data: {i}\n\n"))),
                        i + 1,
                    ))
                });
                return Response::builder()
                    .header("content-type", "text/event-stream")
                    .body(Body::from_stream(chunks))
                    .unwrap();
            }
            Response::builder()
                .status(status)
                .header("content-type", "application/json")
                .body(Body::from(format!("{{\"from\":{status}}}")))
                .unwrap()
        }
    });
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (url, seen)
}

fn up(name: &str, base: &str, auth: AuthStyle) -> Upstream {
    Upstream {
        id: name.into(),
        name: name.into(),
        base_url: base.into(),
        key: format!("sk-{name}"),
        auth,
        enabled: true,
        system_proxy: false,
    }
}

/// A relay with one route over `ups`; its address and the token handed out.
async fn relay(protocol: Protocol, ups: Vec<Upstream>) -> (String, String, Arc<Relay>) {
    let (text, token) = new_token("ye", 1);
    let config = Config {
        port: 0,
        routes: vec![Route {
            id: "r".into(),
            name: "主线".into(),
            protocol,
            upstreams: ups,
            tokens: vec![token],
        }],
    };
    let r = Relay::new(config);
    let l = proxy::bind(0).await.unwrap();
    let url = format!("http://{}", l.local_addr().unwrap());
    let rr = r.clone();
    tokio::spawn(async move { proxy::serve(l, rr, std::future::pending()).await.unwrap() });
    (url, text, r)
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn the_upstreams_key_goes_in_place_of_the_token_with_the_path_and_body() {
    let (base, seen) = upstream(200).await;
    let (url, token, _) = relay(
        Protocol::Anthropic,
        vec![up("a", &format!("{base}/api/"), AuthStyle::XApiKey)],
    )
    .await;
    let r = client()
        .post(format!("{url}/v1/messages?beta=true"))
        .header("x-api-key", &token)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(r#"{"model":"m"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.text().await.unwrap(), r#"{"from":200}"#);
    let s = seen.lock().unwrap()[0].clone();
    assert_eq!(s.method, "POST");
    assert_eq!(s.uri, "/api/v1/messages?beta=true");
    assert_eq!(s.header("x-api-key"), Some("sk-a"));
    assert_eq!(s.header("authorization"), None);
    assert_eq!(s.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(s.body, br#"{"model":"m"}"#);
}

#[tokio::test]
async fn bearer_upstreams_get_the_key_as_bearer_whichever_header_the_token_came_in() {
    let (base, seen) = upstream(200).await;
    let (url, token, _) = relay(Protocol::OpenAI, vec![up("o", &base, AuthStyle::Bearer)]).await;
    let r = client()
        .post(format!("{url}/v1/chat/completions"))
        .bearer_auth(&token)
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let s = seen.lock().unwrap()[0].clone();
    assert_eq!(s.header("authorization"), Some("Bearer sk-o"));
    assert_eq!(s.header("x-api-key"), None);
}

#[tokio::test]
async fn no_token_an_unknown_one_or_one_turned_off_is_turned_away() {
    let (base, seen) = upstream(200).await;
    let (url, token, relay) = relay(
        Protocol::Anthropic,
        vec![up("a", &base, AuthStyle::XApiKey)],
    )
    .await;
    let c = client();
    assert_eq!(
        c.get(format!("{url}/v1/models"))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    let r = c
        .get(format!("{url}/v1/models"))
        .header("x-api-key", "rl-nope")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    let body: serde_json::Value = r.json().await.unwrap();
    assert_eq!(body["error"]["type"], "authentication_error");
    relay.config.write().await.routes[0].tokens[0].enabled = false;
    assert_eq!(
        c.get(format!("{url}/v1/models"))
            .header("x-api-key", &token)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_5xx_429_or_no_answer_moves_on_to_the_next_upstream() {
    let (down, _) = upstream(503).await;
    let (busy, _) = upstream(429).await;
    let (good, seen) = upstream(200).await;
    let refused = "http://127.0.0.1:9".to_string();
    let (url, token, relay) = relay(
        Protocol::Anthropic,
        vec![
            up("refused", &refused, AuthStyle::XApiKey),
            up("down", &down, AuthStyle::XApiKey),
            up("busy", &busy, AuthStyle::XApiKey),
            up("good", &good, AuthStyle::XApiKey),
        ],
    )
    .await;
    let r = client()
        .post(format!("{url}/v1/messages"))
        .header("x-api-key", &token)
        .body("{\"x\":1}")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    // The body reached the last one whole.
    assert_eq!(seen.lock().unwrap()[0].body, b"{\"x\":1}");
    let log = relay.log.lock().unwrap().recent();
    assert_eq!(log[0].upstream, "good");
    assert!(
        log[0].note.contains("refused")
            && log[0].note.contains("down 503")
            && log[0].note.contains("busy 429"),
        "{}",
        log[0].note
    );
}

#[tokio::test]
async fn the_last_upstreams_answer_stands_and_a_4xx_is_not_retried() {
    let (down, _) = upstream(500).await;
    let (bad, _) = upstream(400).await;
    let (other, other_seen) = upstream(200).await;
    // All failing: the last one's answer goes back.
    let (url, token, _) = relay(
        Protocol::Anthropic,
        vec![
            up("a", &down, AuthStyle::XApiKey),
            up("b", &down, AuthStyle::XApiKey),
        ],
    )
    .await;
    let r = client()
        .get(format!("{url}/v1/models"))
        .header("x-api-key", &token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 500);
    // A 400 is the request's fault: not tried elsewhere.
    let (url, token, _) = relay(
        Protocol::Anthropic,
        vec![
            up("bad", &bad, AuthStyle::XApiKey),
            up("other", &other, AuthStyle::XApiKey),
        ],
    )
    .await;
    let r = client()
        .get(format!("{url}/v1/models"))
        .header("x-api-key", &token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
    assert!(other_seen.lock().unwrap().is_empty());
    // None reachable: 502 with the reason.
    let (url, token, _) = relay(
        Protocol::Anthropic,
        vec![up("x", "http://127.0.0.1:9", AuthStyle::XApiKey)],
    )
    .await;
    let r = client()
        .get(format!("{url}/v1/models"))
        .header("x-api-key", &token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 502);
    assert!(r.text().await.unwrap().contains("连不上"));
}

#[tokio::test]
async fn upstreams_turned_off_are_skipped_and_none_left_is_503() {
    let (good, seen) = upstream(200).await;
    let mut off = up("off", "http://127.0.0.1:9", AuthStyle::XApiKey);
    off.enabled = false;
    let (url, token, relay) = relay(
        Protocol::Anthropic,
        vec![off, up("good", &good, AuthStyle::XApiKey)],
    )
    .await;
    assert_eq!(
        client()
            .get(format!("{url}/v1/models"))
            .header("x-api-key", &token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(seen.lock().unwrap().len(), 1);
    relay.config.write().await.routes[0].upstreams[1].enabled = false;
    let r = client()
        .get(format!("{url}/v1/models"))
        .header("x-api-key", &token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 503);
    let body: serde_json::Value = r.json().await.unwrap();
    assert_eq!(body["error"]["message"], "接口中继的入口 \"主线\" 没有可用的上游 (上游都已停用): 在接口中继里添加上游, 或打开已有上游的开关");
    assert_eq!(
        relay.log.lock().unwrap().recent()[0].note,
        "没有可用的上游: 上游都已停用"
    );
    relay.config.write().await.routes[0].upstreams.clear();
    assert_eq!(
        client()
            .get(format!("{url}/v1/models"))
            .header("x-api-key", &token)
            .send()
            .await
            .unwrap()
            .status(),
        503
    );
    assert_eq!(
        relay.log.lock().unwrap().recent()[0].note,
        "没有可用的上游: 还没有添加上游"
    );
}

#[tokio::test]
async fn a_streamed_reply_arrives_as_it_is_sent() {
    let (base, _) = upstream(200).await;
    let (url, token, _) = relay(
        Protocol::Anthropic,
        vec![up("a", &base, AuthStyle::XApiKey)],
    )
    .await;
    let started = Instant::now();
    let mut r = client()
        .post(format!("{url}/v1/stream"))
        .header("x-api-key", &token)
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(r.headers()["content-type"], "text/event-stream");
    let first = r.chunk().await.unwrap().unwrap();
    let first_at = started.elapsed();
    assert_eq!(&first[..], b"data: 0\n\n");
    let mut rest = Vec::new();
    while let Some(c) = r.chunk().await.unwrap() {
        rest.extend_from_slice(&c);
    }
    assert_eq!(rest, b"data: 1\n\ndata: 2\n\n");
    // The first chunk came before the upstream was done (600 ms later).
    assert!(
        first_at < Duration::from_millis(400),
        "first chunk after {first_at:?}"
    );
    assert!(started.elapsed() >= Duration::from_millis(600));
}

#[tokio::test]
async fn another_host_name_is_turned_away_and_browsers_may_call_it() {
    let (base, seen) = upstream(200).await;
    let (url, token, _) = relay(
        Protocol::Anthropic,
        vec![up("a", &base, AuthStyle::XApiKey)],
    )
    .await;
    let c = client();
    let r = c
        .get(format!("{url}/v1/models"))
        .header("host", "evil.example")
        .header("x-api-key", &token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    assert!(seen.lock().unwrap().is_empty());
    // A preflight is answered here (no token needed for it), and the reply carries the origin.
    let r = c
        .request(reqwest::Method::OPTIONS, format!("{url}/v1/messages"))
        .header("origin", "http://toolbox.test")
        .header("access-control-request-method", "POST")
        .header("access-control-request-headers", "x-api-key, content-type")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT.as_u16());
    assert_eq!(
        r.headers()["access-control-allow-origin"],
        "http://toolbox.test"
    );
    assert_eq!(
        r.headers()["access-control-allow-headers"],
        "x-api-key, content-type"
    );
    let r = c
        .post(format!("{url}/v1/messages"))
        .header("origin", "http://toolbox.test")
        .header("x-api-key", &token)
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(
        r.headers()["access-control-allow-origin"],
        "http://toolbox.test"
    );
    // The origin isn't passed on.
    assert_eq!(seen.lock().unwrap()[0].header("origin"), None);
}

#[tokio::test]
async fn the_log_has_the_path_without_the_query_and_counts_per_token() {
    let (base, _) = upstream(200).await;
    let (url, token, relay) = relay(
        Protocol::Anthropic,
        vec![up("a", &base, AuthStyle::XApiKey)],
    )
    .await;
    for _ in 0..2 {
        client()
            .get(format!("{url}/v1/models?key=secret"))
            .header("x-api-key", &token)
            .send()
            .await
            .unwrap();
    }
    let log = relay.log.lock().unwrap();
    let e = &log.recent()[0];
    assert_eq!(
        (
            e.route.as_str(),
            e.token.as_str(),
            e.upstream.as_str(),
            e.path.as_str(),
            e.status
        ),
        ("主线", "ye", "a", "/v1/models", 200)
    );
    let id = relay.config.try_read().unwrap().routes[0].tokens[0]
        .id
        .clone();
    assert_eq!(log.uses()[&id].requests, 2);
}
