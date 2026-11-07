//! What went through the relay, for the window: the latest requests (no keys, no bodies, no
//! queries) and, per token, how many since the app started and when last.

use serde::Serialize;
use std::collections::{HashMap, VecDeque};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// When it came (Unix milliseconds).
    pub at: u64,
    pub route: String,
    pub token: String,
    /// The upstream that answered (or was tried last).
    pub upstream: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    /// From the request to the reply's head (a streamed reply goes on after).
    pub ms: u64,
    /// Upstreams tried before, or why none answered.
    pub note: String,
}

impl Entry {
    pub fn new(route: &str, token: &str, method: &str, path: &str) -> Entry {
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Entry {
            at,
            route: route.into(),
            token: token.into(),
            upstream: String::new(),
            method: method.into(),
            path: path.into(),
            status: 0,
            ms: 0,
            note: String::new(),
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUse {
    pub requests: u64,
    pub last_used: u64,
}

pub struct Log {
    cap: usize,
    entries: VecDeque<Entry>,
    uses: HashMap<String, TokenUse>,
}

impl Log {
    pub fn new(cap: usize) -> Log {
        Log {
            cap,
            entries: VecDeque::with_capacity(cap),
            uses: HashMap::new(),
        }
    }

    pub fn add(&mut self, token_id: &str, e: Entry) {
        let u = self.uses.entry(token_id.to_string()).or_default();
        u.requests += 1;
        u.last_used = e.at;
        if self.entries.len() == self.cap {
            self.entries.pop_front();
        }
        self.entries.push_back(e);
    }

    /// Newest first.
    pub fn recent(&self) -> Vec<Entry> {
        self.entries.iter().rev().cloned().collect()
    }

    pub fn uses(&self) -> &HashMap<String, TokenUse> {
        &self.uses
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_latest_and_counts_per_token() {
        let mut l = Log::new(2);
        for (i, t) in ["a", "b", "a"].iter().enumerate() {
            let mut e = Entry::new("R", t, "POST", "/v1/messages");
            e.status = 200 + i as u16;
            l.add(t, e);
        }
        let r = l.recent();
        assert_eq!(
            r.iter().map(|e| e.status).collect::<Vec<_>>(),
            vec![202, 201]
        );
        assert_eq!(l.uses()["a"].requests, 2);
        assert_eq!(l.uses()["b"].requests, 1);
    }
}
