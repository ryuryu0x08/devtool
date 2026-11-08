//! What the window shows: the config without the secrets (an upstream's key as its ends only;
//! tokens as their hint), with each token's use, the latest requests, whether the server runs, and
//! with `lan` on, the addresses other devices reach it at.

use crate::config::{AuthStyle, Config, Protocol};
use crate::log::{Entry, Log, TokenUse};
use crate::net;
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Server {
    /// Listening at `address`.
    Running {
        address: String,
    },
    /// Couldn't listen on the port (taken, most often).
    Failed {
        port: u16,
        error: String,
    },
    Starting {
        port: u16,
    },
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub port: u16,
    /// Listens on the local network too.
    pub lan: bool,
    /// With `lan`: this machine's addresses there ("http://192.168.1.5:8790"), if it has any.
    pub lan_addresses: Vec<String>,
    pub server: Server,
    pub routes: Vec<RouteView>,
    pub recent: Vec<Entry>,
    /// Why the saved config couldn't be used, if so.
    pub config_error: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RouteView {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub upstreams: Vec<UpstreamView>,
    pub tokens: Vec<TokenView>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamView {
    pub id: String,
    pub name: String,
    pub base_url: String,
    /// The key's ends ("sk-a…9f3c").
    pub key_hint: String,
    pub auth: AuthStyle,
    pub enabled: bool,
    pub system_proxy: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenView {
    pub id: String,
    pub name: String,
    pub hint: String,
    pub enabled: bool,
    pub created: u64,
    #[serde(rename = "use")]
    pub used: TokenUse,
}

/// The first 4 and last 4 characters of a key ("sk-a…9f3c"); a short one only as "…" and its last 2.
pub fn key_hint(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 12 {
        let tail: String = chars[chars.len().saturating_sub(2)..].iter().collect();
        return format!("…{tail}");
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

pub fn view(config: &Config, log: &Log, server: Server, config_error: Option<String>) -> View {
    let routes = config
        .routes
        .iter()
        .map(|r| RouteView {
            id: r.id.clone(),
            name: r.name.clone(),
            protocol: r.protocol,
            upstreams: r
                .upstreams
                .iter()
                .map(|u| UpstreamView {
                    id: u.id.clone(),
                    name: u.name.clone(),
                    base_url: u.base_url.clone(),
                    key_hint: key_hint(&u.key),
                    auth: u.auth,
                    enabled: u.enabled,
                    system_proxy: u.system_proxy,
                })
                .collect(),
            tokens: r
                .tokens
                .iter()
                .map(|t| TokenView {
                    id: t.id.clone(),
                    name: t.name.clone(),
                    hint: t.hint.clone(),
                    enabled: t.enabled,
                    created: t.created,
                    used: log.uses().get(&t.id).copied().unwrap_or_default(),
                })
                .collect(),
        })
        .collect();
    let lan_addresses = if config.lan {
        net::lan_addresses()
            .iter()
            .map(|ip| format!("http://{ip}:{}", config.port))
            .collect()
    } else {
        Vec::new()
    };
    View {
        port: config.port,
        lan: config.lan,
        lan_addresses,
        server,
        routes,
        recent: log.recent(),
        config_error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{new_token, Route, Upstream};

    #[test]
    fn keys_and_tokens_never_reach_the_window() {
        let key = "sk-ant-api03-SECRETSECRETSECRET-9f3c";
        let (text, t) = new_token("ye", 1);
        let c = Config {
            port: 8790,
            lan: false,
            routes: vec![Route {
                id: "r".into(),
                name: "R".into(),
                protocol: Protocol::Anthropic,
                upstreams: vec![Upstream {
                    id: "u".into(),
                    name: "U".into(),
                    base_url: "https://x".into(),
                    key: key.into(),
                    auth: AuthStyle::XApiKey,
                    enabled: true,
                    system_proxy: false,
                }],
                tokens: vec![t.clone()],
            }],
        };
        let mut log = Log::new(5);
        log.add(&t.id, Entry::new("R", "ye", "POST", "/v1/messages"));
        let v = view(
            &c,
            &log,
            Server::Running {
                address: "http://127.0.0.1:8790".into(),
            },
            None,
        );
        let json = serde_json::to_string(&v).unwrap();
        assert!(
            !json.contains("SECRET") && !json.contains(&text) && !json.contains(&t.hash),
            "{json}"
        );
        assert_eq!(v.routes[0].upstreams[0].key_hint, "sk-a…9f3c");
        assert_eq!(v.routes[0].tokens[0].used.requests, 1);
        assert!(json.contains(r#""state":"running""#));
        assert!(!v.lan && v.lan_addresses.is_empty());
    }

    #[test]
    fn on_the_local_network_its_addresses_there_with_the_port() {
        let c = Config {
            lan: true,
            ..Config::default()
        };
        let v = view(&c, &Log::new(1), Server::Starting { port: 8790 }, None);
        assert!(v.lan);
        assert_eq!(v.lan_addresses.len(), net::lan_addresses().len());
        for a in &v.lan_addresses {
            assert!(a.starts_with("http://") && a.ends_with(":8790"), "{a}");
        }
    }

    #[test]
    fn short_keys_show_only_their_last_two() {
        assert_eq!(key_hint("abc123"), "…23");
        assert_eq!(key_hint(""), "…");
    }
}
