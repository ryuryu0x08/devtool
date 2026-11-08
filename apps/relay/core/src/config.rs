//! What the relay is set up with: the port it listens on (on this machine only, or on the local
//! network too), and routes. A route is one protocol
//! (Anthropic or OpenAI), the tokens handed out for it, and the upstreams (real API address and
//! key) its requests go to, tried in order.
//!
//! Tokens are kept as their SHA-256 only: a token is shown once, when it is made.

use rand::{distr::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const DEFAULT_PORT: u16 = 8790;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: u16,
    /// Also on the local network: listens on 0.0.0.0 instead of 127.0.0.1 (see proxy).
    #[serde(default)]
    pub lan: bool,
    #[serde(default)]
    pub routes: Vec<Route>,
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

impl Default for Config {
    fn default() -> Self {
        Config {
            port: DEFAULT_PORT,
            lan: false,
            routes: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Anthropic,
    #[serde(rename = "openai")]
    OpenAI,
}

impl Protocol {
    /// How keys are sent to this protocol's APIs unless an upstream says otherwise.
    pub fn default_auth(self) -> AuthStyle {
        match self {
            Protocol::Anthropic => AuthStyle::XApiKey,
            Protocol::OpenAI => AuthStyle::Bearer,
        }
    }
}

/// How the key goes to an upstream: `x-api-key: <key>` (Anthropic's own API) or
/// `Authorization: Bearer <key>` (OpenAI, and many Anthropic-compatible gateways).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthStyle {
    #[serde(rename = "x-api-key")]
    XApiKey,
    #[serde(rename = "bearer")]
    Bearer,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    #[serde(default)]
    pub upstreams: Vec<Upstream>,
    #[serde(default)]
    pub tokens: Vec<ClientToken>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    pub id: String,
    pub name: String,
    /// The API's address, with its path prefix if it has one ("https://api.anthropic.com",
    /// "http://10.0.0.5/api"); the client's path is added to it.
    pub base_url: String,
    pub key: String,
    pub auth: AuthStyle,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Through the system's proxy (for an API reachable only through it). Off: straight to the
    /// API, as an internal address needs (a proxy would answer it with an error).
    #[serde(default)]
    pub system_proxy: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientToken {
    pub id: String,
    pub name: String,
    /// SHA-256 of the token, in hex.
    pub hash: String,
    /// Its first and last characters, to tell tokens apart ("rl-Ab…xY12").
    pub hint: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// When it was made (Unix seconds).
    pub created: u64,
}

fn yes() -> bool {
    true
}

/// A new token: the text to hand out (shown once) and what is kept of it.
pub fn new_token(name: &str, now: u64) -> (String, ClientToken) {
    let body: String = rand::rng()
        .sample_iter(&Alphanumeric)
        .take(40)
        .map(char::from)
        .collect();
    let text = format!("rl-{body}");
    let hint = format!("{}…{}", &text[..5], &text[text.len() - 4..]);
    let token = ClientToken {
        id: new_id(),
        name: name.to_string(),
        hash: hash_token(&text),
        hint,
        enabled: true,
        created: now,
    };
    (text, token)
}

pub fn hash_token(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}

/// A short random id for routes, upstreams and tokens.
pub fn new_id() -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(12)
        .map(char::from)
        .collect()
}

impl Config {
    /// The route and token a client's token belongs to, if it is known and on.
    pub fn find_token(&self, text: &str) -> Option<(&Route, &ClientToken)> {
        let h = hash_token(text);
        self.routes.iter().find_map(|r| {
            r.tokens
                .iter()
                .find(|t| t.hash == h && t.enabled)
                .map(|t| (r, t))
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("读取设置失败: {0}")]
    Read(std::io::Error),
    #[error("设置文件读不出, 已另存为 {aside}, 现用默认设置")]
    Unreadable { aside: PathBuf },
    #[error("保存设置失败: {0}")]
    Write(std::io::Error),
}

/// Reads the config at `path`: the default if there is none yet. One that can't be read (edited
/// by hand, written by another version) is kept aside first, since it holds the keys, and the
/// default is used; the error says where it went.
pub fn load(path: &Path) -> (Config, Option<StoreError>) {
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (Config::default(), None),
        Err(e) => return (Config::default(), Some(StoreError::Read(e))),
    };
    match serde_json::from_slice(&data) {
        Ok(c) => (c, None),
        Err(_) => {
            let secs = now();
            let aside = path.with_file_name(format!("config.unreadable-{secs}.json"));
            let _ = std::fs::copy(path, &aside);
            restrict(&aside);
            (Config::default(), Some(StoreError::Unreadable { aside }))
        }
    }
}

/// Writes the config to `path` in one step (a file beside it, then renamed over it), readable by
/// its owner only.
pub fn save(path: &Path, config: &Config) -> Result<(), StoreError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(StoreError::Write)?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_vec_pretty(config).expect("the config is always serializable");
    std::fs::write(&tmp, text).map_err(StoreError::Write)?;
    restrict(&tmp);
    std::fs::rename(&tmp, path).map_err(StoreError::Write)
}

#[cfg(unix)]
fn restrict(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict(_: &Path) {}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(tokens: Vec<ClientToken>) -> Route {
        Route {
            id: "r".into(),
            name: "R".into(),
            protocol: Protocol::Anthropic,
            upstreams: vec![],
            tokens,
        }
    }

    #[test]
    fn a_token_is_kept_as_its_hash_and_found_by_its_text() {
        let (text, t) = new_token("ye", 1);
        assert!(text.starts_with("rl-") && text.len() == 43);
        assert_eq!(t.hash, hash_token(&text));
        assert!(!serde_json::to_string(&t).unwrap().contains(&text));
        assert!(t.hint.starts_with("rl-") && t.hint.ends_with(&text[39..]));
        let c = Config {
            port: 1,
            routes: vec![route(vec![t.clone()])],
            ..Config::default()
        };
        assert_eq!(
            c.find_token(&text).map(|(_, t)| t.id.clone()),
            Some(t.id.clone())
        );
        assert!(c.find_token("rl-other").is_none());
    }

    #[test]
    fn a_token_turned_off_is_not_found() {
        let (text, mut t) = new_token("ye", 1);
        t.enabled = false;
        let c = Config {
            port: 1,
            routes: vec![route(vec![t])],
            ..Config::default()
        };
        assert!(c.find_token(&text).is_none());
    }

    #[test]
    fn saved_and_read_back_the_same_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("relay/config.json");
        let (_, t) = new_token("ye", 1);
        let mut r = route(vec![t]);
        r.upstreams.push(Upstream {
            id: "u".into(),
            name: "U".into(),
            base_url: "http://x/api".into(),
            key: "sk".into(),
            auth: AuthStyle::Bearer,
            enabled: true,
            system_proxy: false,
        });
        let c = Config {
            port: 9000,
            lan: true,
            routes: vec![r],
        };
        save(&path, &c).unwrap();
        let (back, err) = load(&path);
        assert!(err.is_none());
        assert_eq!(back, c);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn none_yet_is_the_default_and_an_unreadable_one_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let (c, err) = load(&path);
        assert_eq!(c, Config::default());
        assert!(err.is_none());
        std::fs::write(&path, b"{ not json").unwrap();
        let (c, err) = load(&path);
        assert_eq!(c, Config::default());
        match err {
            Some(StoreError::Unreadable { aside }) => {
                assert_eq!(std::fs::read(aside).unwrap(), b"{ not json")
            }
            other => panic!("expected the file kept aside, got {other:?}"),
        }
    }

    #[test]
    fn older_files_fill_in_what_they_lack() {
        let c: Config = serde_json::from_str(r#"{"routes":[{"id":"r","name":"R","protocol":"openai","upstreams":[{"id":"u","name":"U","baseUrl":"https://api.openai.com","key":"k","auth":"bearer"}]}]}"#).unwrap();
        assert_eq!(c.port, DEFAULT_PORT);
        assert!(!c.lan);
        assert_eq!(c.routes[0].protocol, Protocol::OpenAI);
        assert!(c.routes[0].upstreams[0].enabled);
        assert!(!c.routes[0].upstreams[0].system_proxy);
        assert!(c.routes[0].tokens.is_empty());
    }
}
