// A client like Claude Desktop's (Node's fetch, which keeps connections open and reuses them),
// sending what the Anthropic SDK sends, several requests in a row, one of them streamed.
// Usage: node desktop_like.mjs http://127.0.0.1:47831
const base = process.argv[2];
const headers = {
  "authorization": "Bearer sk-demo-ye",
  "content-type": "application/json",
  "accept": "application/json",
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "interleaved-thinking-2025-05-14",
  "user-agent": "Claude/1.0 (desktop)",
  "x-stainless-lang": "js",
  "accept-encoding": "gzip, deflate, br",
};
let failed = 0;
for (let i = 0; i < 10; i++) {
  const stream = i % 2 === 1;
  const r = await fetch(base + "/v1/messages", {
    method: "POST", headers,
    body: JSON.stringify({ model: "claude-x", max_tokens: 10, stream, messages: [{ role: "user", content: "hi " + i }] }),
  });
  const text = await r.text();
  const ok = r.status === 200 && (stream ? text.includes("message_stop") : text.includes('"type": "message"'));
  if (!ok) failed++;
  console.log(`request ${i} (${stream ? "stream" : "json"}): ${r.status} ${ok ? "ok" : "BAD " + JSON.stringify(text.slice(0, 120))}`);
}
console.log(failed ? `${failed} of 10 failed` : "all 10 ok");
process.exit(failed ? 1 : 0);
