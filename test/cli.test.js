import test from "node:test";
import assert from "node:assert/strict";

process.env.JAVINFO_MCP_NO_AUTOSTART = "1";
const {
  cliBinary,
  buildOpenArgs,
  buildServeArgs,
  extractJsonObject,
  parseOpenResult,
  parseServeStatusOutput,
  fmtOpen,
  fmtServe,
  CLI_INSTALL_HINT,
} = await import("../dist/index.js");

test("cliBinary uses JAVINFO_CLI override", () => {
  assert.equal(cliBinary({}), "javinfo");
  assert.equal(cliBinary({ JAVINFO_CLI: "  /opt/javinfo  " }), "/opt/javinfo");
});

test("buildOpenArgs", () => {
  assert.deepEqual(buildOpenArgs("EBOD-391"), ["open", "--json", "EBOD-391"]);
  assert.deepEqual(buildOpenArgs("  SSIS-001  ", { with: "vlc", maxHeight: 720, ttl: 2 }), [
    "open",
    "--json",
    "SSIS-001",
    "--with",
    "vlc",
    "--max-height",
    "720",
    "--ttl",
    "2",
  ]);
});

test("extractJsonObject tolerates log lines before JSON", () => {
  const mixed = `2026-08-07T18:07:03Z  INFO resolve movie
{
  "token": "abc",
  "play_url": "http://x/s/t/a.m3u8",
  "meta_url": "http://x/s/t/meta.json",
  "meta": { "code": "EBOD-391" }
}
`;
  const obj = extractJsonObject(mixed);
  assert.equal(obj.token, "abc");
  assert.equal(obj.play_url, "http://x/s/t/a.m3u8");
});

test("parseOpenResult + fmtOpen", () => {
  const stdout = JSON.stringify({
    token: "t",
    play_url: "http://lan/s/t/EBOD-391.m3u8",
    meta_url: "http://lan/s/t/meta.json",
    meta: {
      code: "EBOD-391",
      dvdId: "EBOD-391",
      title: "Demo",
      jacketUrl: "https://img/x.jpg",
    },
  });
  const r = parseOpenResult(stdout);
  assert.equal(r.token, "t");
  const withVlc = fmtOpen(r, "EBOD-391", "vlc");
  assert.match(withVlc, /\*\*EBOD-391\*\* — Demo/);
  assert.match(withVlc, /play: http:\/\/lan\/s\/t\/EBOD-391\.m3u8/);
  assert.match(withVlc, /with: vlc/);
  assert.match(withVlc, /poster: https:\/\/img\/x\.jpg/);
  assert.doesNotMatch(withVlc, /tip:/);

  const urlOnly = fmtOpen(r, "EBOD-391");
  assert.match(urlOnly, /tip:.*with="vlc"/);
  assert.doesNotMatch(urlOnly, /^with:/m);
});

test("CLI_INSTALL_HINT is actionable", () => {
  assert.match(CLI_INSTALL_HINT, /install\.sh/);
  assert.match(CLI_INSTALL_HINT, /JAVINFO_CLI/);
});

test("buildServeArgs", () => {
  assert.deepEqual(buildServeArgs("status"), ["serve", "status"]);
  assert.deepEqual(buildServeArgs("stop"), ["serve", "stop"]);
  assert.deepEqual(
    buildServeArgs("start", { port: 9000, bind: "127.0.0.1", maxHeight: 720 }),
    ["serve", "--port", "9000", "--bind", "127.0.0.1", "--max-height", "720", "start"],
  );
});

test("parseServeStatusOutput + fmtServe", () => {
  const raw = `pid       123
listen    0.0.0.0:8787
lan       http://192.168.1.1:8787
max_h     1080
sessions  2
started   1786128514
log       /tmp/serve.log
`;
  const p = parseServeStatusOutput(raw);
  assert.equal(p.pid, 123);
  assert.equal(p.listen, "0.0.0.0:8787");
  assert.equal(p.lan, "http://192.168.1.1:8787");
  assert.equal(p.maxHeight, 1080);
  assert.equal(p.sessions, 2);
  assert.equal(p.log, "/tmp/serve.log");

  const running = fmtServe({
    action: "status",
    running: true,
    message: "ok",
    ...p,
  });
  assert.match(running, /serve: running/);
  assert.match(running, /pid: 123/);

  assert.equal(
    fmtServe({ action: "status", running: false, message: "down" }),
    "serve: not running",
  );
  assert.match(
    fmtServe({ action: "start", running: true, message: "started  pid=1  http://x" }),
    /started/,
  );
});
