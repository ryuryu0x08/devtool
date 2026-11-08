//! The local network: which addresses a request may come from when the relay listens on it too,
//! and this machine's addresses there (what the window shows other devices to use).

use std::net::{IpAddr, Ipv4Addr};

/// A local-network address: this machine, the private ranges (10/8, 172.16/12, 192.168/16),
/// link-local (169.254/16), and 100.64/10 (carrier NAT, Tailscale); for IPv6 loopback, fc00::/7
/// and fe80::/10. Everything else is the internet.
pub fn nearby(ip: IpAddr) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local() || shared(v4),
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            v6.is_loopback() || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80
        }
    }
}

/// 100.64.0.0/10.
fn shared(v4: Ipv4Addr) -> bool {
    let [a, b, ..] = v4.octets();
    a == 100 && b & 0xc0 == 64
}

/// This machine's IPv4 addresses that other devices nearby can reach it on: the private ranges
/// and 100.64/10, home networks (192.168) first. Left out: loopback, self-assigned 169.254, and
/// the 198.18/15 a proxy app's virtual network uses.
pub fn lan_addresses() -> Vec<Ipv4Addr> {
    let mut found: Vec<Ipv4Addr> = Vec::new();
    for i in if_addrs::get_if_addrs().unwrap_or_default() {
        if let IpAddr::V4(v4) = i.ip() {
            if (v4.is_private() || shared(v4)) && !found.contains(&v4) {
                found.push(v4);
            }
        }
    }
    found.sort_by_key(|v4| match v4.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        [172, ..] => 2,
        _ => 3,
    });
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn the_local_network_and_not_the_internet() {
        for s in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.5",
            "169.254.3.4",
            "100.64.0.1",
            "100.127.255.255",
            "::1",
            "fd7a:115c:a1e0::1",
            "fe80::1",
            "::ffff:192.168.1.5",
        ] {
            assert!(nearby(ip(s)), "{s}");
        }
        for s in [
            "8.8.8.8",
            "172.32.0.1",
            "100.128.0.1",
            "198.18.0.1",
            "1.1.1.1",
            "2001:4860::8888",
            "::ffff:8.8.8.8",
        ] {
            assert!(!nearby(ip(s)), "{s}");
        }
    }

    #[test]
    fn this_machines_addresses_are_local_ones() {
        for a in lan_addresses() {
            assert!(
                nearby(IpAddr::V4(a)) && !a.is_loopback() && !a.is_link_local(),
                "{a}"
            );
        }
    }
}
