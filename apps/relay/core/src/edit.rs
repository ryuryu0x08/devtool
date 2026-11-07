//! Changes to the config, as the window asks for them. Each checks what it is given and says
//! what is wrong in a few words; nothing is changed then.

use crate::config::{new_id, new_token, AuthStyle, Config, Protocol, Route, Upstream};

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum EditError {
    #[error("没有这个入口")]
    NoRoute,
    #[error("没有这个上游")]
    NoUpstream,
    #[error("没有这个 token")]
    NoToken,
    #[error("名字不能为空")]
    NoName,
    #[error("地址需以 http:// 或 https:// 开头")]
    BadUrl,
    #[error("key 不能为空")]
    NoKey,
    #[error("端口需在 1024 到 65535 之间")]
    BadPort,
}

/// What an upstream is set to; `key` None keeps the one it has.
pub struct UpstreamFields {
    pub name: String,
    pub base_url: String,
    pub key: Option<String>,
    pub auth: AuthStyle,
    pub enabled: bool,
    pub system_proxy: bool,
}

fn name(s: &str) -> Result<String, EditError> {
    let s = s.trim();
    if s.is_empty() {
        Err(EditError::NoName)
    } else {
        Ok(s.to_string())
    }
}

fn url(s: &str) -> Result<String, EditError> {
    let s = s.trim().trim_end_matches('/');
    let rest = s
        .strip_prefix("http://")
        .or_else(|| s.strip_prefix("https://"))
        .ok_or(EditError::BadUrl)?;
    if rest.is_empty() || rest.starts_with('/') || rest.contains(char::is_whitespace) {
        return Err(EditError::BadUrl);
    }
    Ok(s.to_string())
}

impl Config {
    fn route_mut(&mut self, id: &str) -> Result<&mut Route, EditError> {
        self.routes
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or(EditError::NoRoute)
    }

    pub fn set_port(&mut self, port: u16) -> Result<(), EditError> {
        if port < 1024 {
            return Err(EditError::BadPort);
        }
        self.port = port;
        Ok(())
    }

    /// A new route; its id.
    pub fn add_route(&mut self, n: &str, protocol: Protocol) -> Result<String, EditError> {
        let id = new_id();
        self.routes.push(Route {
            id: id.clone(),
            name: name(n)?,
            protocol,
            upstreams: Vec::new(),
            tokens: Vec::new(),
        });
        Ok(id)
    }

    pub fn rename_route(&mut self, id: &str, n: &str) -> Result<(), EditError> {
        let n = name(n)?;
        self.route_mut(id)?.name = n;
        Ok(())
    }

    pub fn delete_route(&mut self, id: &str) -> Result<(), EditError> {
        let before = self.routes.len();
        self.routes.retain(|r| r.id != id);
        if self.routes.len() == before {
            return Err(EditError::NoRoute);
        }
        Ok(())
    }

    /// A new upstream, last in the order; its id.
    pub fn add_upstream(&mut self, route: &str, f: UpstreamFields) -> Result<String, EditError> {
        let key = f
            .key
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
            .ok_or(EditError::NoKey)?;
        let u = Upstream {
            id: new_id(),
            name: name(&f.name)?,
            base_url: url(&f.base_url)?,
            key,
            auth: f.auth,
            enabled: f.enabled,
            system_proxy: f.system_proxy,
        };
        let id = u.id.clone();
        self.route_mut(route)?.upstreams.push(u);
        Ok(id)
    }

    pub fn update_upstream(
        &mut self,
        route: &str,
        id: &str,
        f: UpstreamFields,
    ) -> Result<(), EditError> {
        let n = name(&f.name)?;
        let base = url(&f.base_url)?;
        let key = match f.key.map(|k| k.trim().to_string()) {
            Some(k) if k.is_empty() => return Err(EditError::NoKey),
            other => other,
        };
        let u = self
            .route_mut(route)?
            .upstreams
            .iter_mut()
            .find(|u| u.id == id)
            .ok_or(EditError::NoUpstream)?;
        u.name = n;
        u.base_url = base;
        if let Some(k) = key {
            u.key = k;
        }
        u.auth = f.auth;
        u.enabled = f.enabled;
        u.system_proxy = f.system_proxy;
        Ok(())
    }

    /// Moves an upstream up (`by` < 0) or down in the order they are tried.
    pub fn move_upstream(&mut self, route: &str, id: &str, by: i32) -> Result<(), EditError> {
        let ups = &mut self.route_mut(route)?.upstreams;
        let i = ups
            .iter()
            .position(|u| u.id == id)
            .ok_or(EditError::NoUpstream)?;
        let j = (i as i64 + by as i64).clamp(0, ups.len() as i64 - 1) as usize;
        let u = ups.remove(i);
        ups.insert(j, u);
        Ok(())
    }

    pub fn delete_upstream(&mut self, route: &str, id: &str) -> Result<(), EditError> {
        let ups = &mut self.route_mut(route)?.upstreams;
        let before = ups.len();
        ups.retain(|u| u.id != id);
        if ups.len() == before {
            return Err(EditError::NoUpstream);
        }
        Ok(())
    }

    /// A new token: its text, to be shown once (only its hash is kept).
    pub fn add_token(&mut self, route: &str, n: &str, now: u64) -> Result<String, EditError> {
        let n = name(n)?;
        let (text, t) = new_token(&n, now);
        self.route_mut(route)?.tokens.push(t);
        Ok(text)
    }

    pub fn set_token_enabled(&mut self, route: &str, id: &str, on: bool) -> Result<(), EditError> {
        let t = self
            .route_mut(route)?
            .tokens
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or(EditError::NoToken)?;
        t.enabled = on;
        Ok(())
    }

    pub fn delete_token(&mut self, route: &str, id: &str) -> Result<(), EditError> {
        let ts = &mut self.route_mut(route)?.tokens;
        let before = ts.len();
        ts.retain(|t| t.id != id);
        if ts.len() == before {
            return Err(EditError::NoToken);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields(name: &str, url: &str, key: Option<&str>) -> UpstreamFields {
        UpstreamFields {
            name: name.into(),
            base_url: url.into(),
            key: key.map(Into::into),
            auth: AuthStyle::Bearer,
            enabled: true,
            system_proxy: false,
        }
    }

    #[test]
    fn routes_upstreams_and_tokens_are_made_changed_and_removed() {
        let mut c = Config::default();
        let r = c.add_route(" 主线 ", Protocol::Anthropic).unwrap();
        assert_eq!(c.routes[0].name, "主线");
        let a = c
            .add_upstream(&r, fields("A", "http://10.0.0.5/api/", Some(" sk-a ")))
            .unwrap();
        let b = c
            .add_upstream(&r, fields("B", "https://api.anthropic.com", Some("sk-b")))
            .unwrap();
        let u = &c.routes[0].upstreams[0];
        assert_eq!(
            (u.base_url.as_str(), u.key.as_str()),
            ("http://10.0.0.5/api", "sk-a")
        );
        // Changed without a key: the key stays.
        c.update_upstream(&r, &a, fields("A2", "http://10.0.0.6", None))
            .unwrap();
        assert_eq!(
            (
                c.routes[0].upstreams[0].name.as_str(),
                c.routes[0].upstreams[0].key.as_str()
            ),
            ("A2", "sk-a")
        );
        c.move_upstream(&r, &b, -1).unwrap();
        assert_eq!(
            c.routes[0]
                .upstreams
                .iter()
                .map(|u| u.name.as_str())
                .collect::<Vec<_>>(),
            ["B", "A2"]
        );
        c.move_upstream(&r, &b, -5).unwrap();
        assert_eq!(c.routes[0].upstreams[0].name, "B");
        let text = c.add_token(&r, "ye", 1).unwrap();
        let t = c.routes[0].tokens[0].id.clone();
        assert!(c.find_token(&text).is_some());
        c.set_token_enabled(&r, &t, false).unwrap();
        assert!(c.find_token(&text).is_none());
        c.delete_token(&r, &t).unwrap();
        c.delete_upstream(&r, &a).unwrap();
        assert_eq!(c.routes[0].upstreams.len(), 1);
        c.rename_route(&r, "备线").unwrap();
        c.delete_route(&r).unwrap();
        assert!(c.routes.is_empty());
    }

    #[test]
    fn what_is_wrong_is_said_and_nothing_changes() {
        let mut c = Config::default();
        assert_eq!(c.add_route("  ", Protocol::OpenAI), Err(EditError::NoName));
        let r = c.add_route("R", Protocol::OpenAI).unwrap();
        for bad in [
            "api.openai.com",
            "ftp://x",
            "http://",
            "http:///v1",
            "http://a b",
        ] {
            assert_eq!(
                c.add_upstream(&r, fields("U", bad, Some("k"))),
                Err(EditError::BadUrl),
                "{bad}"
            );
        }
        assert_eq!(
            c.add_upstream(&r, fields("U", "http://x", Some(" "))),
            Err(EditError::NoKey)
        );
        assert_eq!(
            c.add_upstream(&r, fields("U", "http://x", None)),
            Err(EditError::NoKey)
        );
        assert_eq!(
            c.add_upstream("nope", fields("U", "http://x", Some("k"))),
            Err(EditError::NoRoute)
        );
        assert!(c.routes[0].upstreams.is_empty());
        let u = c
            .add_upstream(&r, fields("U", "http://x", Some("k")))
            .unwrap();
        assert_eq!(
            c.update_upstream(&r, &u, fields("U", "http://x", Some(""))),
            Err(EditError::NoKey)
        );
        assert_eq!(c.routes[0].upstreams[0].key, "k");
        assert_eq!(c.set_port(80), Err(EditError::BadPort));
        assert_eq!(c.delete_token(&r, "nope"), Err(EditError::NoToken));
        assert_eq!(c.delete_upstream(&r, "nope"), Err(EditError::NoUpstream));
    }
}
