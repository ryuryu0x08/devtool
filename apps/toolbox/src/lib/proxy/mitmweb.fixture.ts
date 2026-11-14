// Flows as mitmweb 10.3 (mitmproxy-addons) lists them at GET /flows, captured from a real run
// (certificates left out): an HTTPS GET over HTTP/2, a plain-HTTP POST with a JSON body, and a
// request whose server refused the connection. Used by the unit tests and the e2e fake backend.
import type { MFlow } from './mitmproxy';

export const MITMWEB_FLOWS = [
  {
    "id": "15949e74-09c8-493b-9df8-e4dee0aa0e91",
    "intercepted": false,
    "is_replay": null,
    "type": "http",
    "modified": false,
    "marked": "",
    "comment": "",
    "timestamp_created": 1794671424.8952901,
    "client_conn": {
      "id": "8b1e312b-016e-4d1d-80e6-4d650c83d27b",
      "peername": [
        "127.0.0.1",
        57683
      ],
      "sockname": [
        "127.0.0.1",
        18888
      ],
      "tls_established": true,
      "sni": "httpbin.org",
      "cipher": "TLS_AES_256_GCM_SHA384",
      "alpn": "h2",
      "tls_version": "TLSv1.3",
      "timestamp_start": 1794671424.268023,
      "timestamp_tls_setup": 1794671424.894096,
      "timestamp_end": 1794671427.1186008
    },
    "server_conn": {
      "id": "97027519-0931-412b-a8d0-2aeebffa2ec2",
      "peername": [
        "44.209.237.184",
        443
      ],
      "sockname": [
        "192.168.6.44",
        57684
      ],
      "address": [
        "httpbin.org",
        443
      ],
      "tls_established": true,
      "sni": "httpbin.org",
      "cipher": "TLS_AES_256_GCM_SHA384",
      "alpn": "h2",
      "tls_version": "TLSv1.3",
      "timestamp_start": 1794671424.269276,
      "timestamp_tcp_setup": 1794671424.560825,
      "timestamp_tls_setup": 1794671424.875795,
      "timestamp_end": 1794671427.119039
    },
    "request": {
      "method": "GET",
      "scheme": "https",
      "host": "httpbin.org",
      "port": 443,
      "path": "/json",
      "http_version": "HTTP/2.0",
      "headers": [
        [
          "user-agent",
          "curl/8.7.1"
        ],
        [
          "accept",
          "*/*"
        ]
      ],
      "contentLength": 0,
      "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "timestamp_start": 1794671424.895173,
      "timestamp_end": 1794671424.896189,
      "pretty_host": "httpbin.org"
    },
    "response": {
      "http_version": "HTTP/2.0",
      "status_code": 200,
      "reason": "",
      "headers": [
        [
          "access-control-allow-credentials",
          "true"
        ],
        [
          "access-control-allow-origin",
          "*"
        ],
        [
          "access-control-expose-headers",
          "Retry-After, RateLimit, RateLimit-Policy, WWW-Authenticate"
        ],
        [
          "content-length",
          "429"
        ],
        [
          "content-type",
          "application/json"
        ],
        [
          "x-content-type-options",
          "nosniff"
        ],
        [
          "date",
          "Sat, 14 Nov 2026 15:50:25 GMT"
        ]
      ],
      "contentLength": 429,
      "contentHash": "bab3dfd2a6c992e4bf589eee05fc9650cc9d6988660b947a7a87b99420d108f9",
      "timestamp_start": 1794671427.111686,
      "timestamp_end": 1794671427.114927
    }
  },
  {
    "id": "256e5aba-37ab-481e-b8d4-acf436b25428",
    "intercepted": false,
    "is_replay": null,
    "type": "http",
    "modified": false,
    "marked": "",
    "comment": "",
    "timestamp_created": 1794671427.136825,
    "client_conn": {
      "id": "40b4a8ff-a62b-408e-8b84-0ca92b7119a9",
      "peername": [
        "127.0.0.1",
        57690
      ],
      "sockname": [
        "127.0.0.1",
        18888
      ],
      "tls_established": false,
      "sni": null,
      "cipher": null,
      "alpn": null,
      "tls_version": null,
      "timestamp_start": 1794671427.135618,
      "timestamp_tls_setup": null,
      "timestamp_end": 1794671428.333754
    },
    "server_conn": {
      "id": "35e63241-cff3-4271-bc66-2fff9a2e0501",
      "peername": [
        "44.209.237.184",
        80
      ],
      "sockname": [
        "192.168.6.44",
        57691
      ],
      "address": [
        "httpbin.org",
        80
      ],
      "tls_established": false,
      "sni": null,
      "cipher": null,
      "alpn": null,
      "tls_version": null,
      "timestamp_start": 1794671427.1389718,
      "timestamp_tcp_setup": 1794671427.381761,
      "timestamp_tls_setup": null,
      "timestamp_end": 1794671428.3341272
    },
    "request": {
      "method": "POST",
      "scheme": "http",
      "host": "httpbin.org",
      "port": 80,
      "path": "/post?x=1",
      "http_version": "HTTP/1.1",
      "headers": [
        [
          "Host",
          "httpbin.org"
        ],
        [
          "User-Agent",
          "curl/8.7.1"
        ],
        [
          "Accept",
          "*/*"
        ],
        [
          "Proxy-Connection",
          "Keep-Alive"
        ],
        [
          "Content-Type",
          "application/json"
        ],
        [
          "Content-Length",
          "7"
        ]
      ],
      "contentLength": 7,
      "contentHash": "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
      "timestamp_start": 1794671427.1364741,
      "timestamp_end": 1794671427.137316,
      "pretty_host": "httpbin.org"
    },
    "response": {
      "http_version": "HTTP/1.1",
      "status_code": 200,
      "reason": "OK",
      "headers": [
        [
          "access-control-allow-credentials",
          "true"
        ],
        [
          "access-control-allow-origin",
          "*"
        ],
        [
          "access-control-expose-headers",
          "Retry-After, RateLimit, RateLimit-Policy, WWW-Authenticate"
        ],
        [
          "content-length",
          "367"
        ],
        [
          "content-type",
          "application/json"
        ],
        [
          "x-content-type-options",
          "nosniff"
        ],
        [
          "date",
          "Sat, 14 Nov 2026 15:50:27 GMT"
        ]
      ],
      "contentLength": 367,
      "contentHash": "6aff0221350727f63f6f2dbae56f3b17ccd2d7070614d36bfbe0f11322772266",
      "timestamp_start": 1794671428.3307579,
      "timestamp_end": 1794671428.3319318
    }
  },
  {
    "id": "fbce037f-b047-418f-8c90-e6aa58929200",
    "intercepted": false,
    "is_replay": null,
    "type": "http",
    "modified": false,
    "marked": "",
    "comment": "",
    "timestamp_created": 1794671428.352535,
    "client_conn": {
      "id": "3a06d246-f7ba-4122-b80b-7d309f25916d",
      "peername": [
        "127.0.0.1",
        57695
      ],
      "sockname": [
        "127.0.0.1",
        18888
      ],
      "tls_established": false,
      "sni": null,
      "cipher": null,
      "alpn": null,
      "tls_version": null,
      "timestamp_start": 1794671428.351568,
      "timestamp_tls_setup": null,
      "timestamp_end": 1794671428.355583
    },
    "server_conn": {
      "id": "9aa2d7aa-af16-4634-b26b-05c03ea76e1a",
      "peername": null,
      "sockname": null,
      "address": null,
      "tls_established": false,
      "sni": null,
      "cipher": null,
      "alpn": null,
      "tls_version": null,
      "timestamp_start": null,
      "timestamp_tcp_setup": null,
      "timestamp_tls_setup": null,
      "timestamp_end": null
    },
    "error": {
      "msg": "[Errno 61] Connect call failed ('127.0.0.1', 1)",
      "timestamp": 1794671428.3547158
    },
    "request": {
      "method": "GET",
      "scheme": "http",
      "host": "127.0.0.1",
      "port": 1,
      "path": "/nothing",
      "http_version": "HTTP/1.1",
      "headers": [
        [
          "Host",
          "127.0.0.1:1"
        ],
        [
          "User-Agent",
          "curl/8.7.1"
        ],
        [
          "Accept",
          "*/*"
        ],
        [
          "Proxy-Connection",
          "Keep-Alive"
        ]
      ],
      "contentLength": 0,
      "contentHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "timestamp_start": 1794671428.352422,
      "timestamp_end": 1794671428.3529751,
      "pretty_host": "127.0.0.1"
    }
  }
] as unknown as MFlow[];
