import test from "node:test";
import assert from "node:assert/strict";

process.env.JAVINFO_MCP_NO_AUTOSTART = "1";
const {
  cliBinary,
  buildOpenArgs,
  extractJsonObject,
  parseOpenResult,
  fmtOpen,
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
  const text = fmtOpen(r, "EBOD-391", "vlc");
  assert.match(text, /\*\*EBOD-391\*\* — Demo/);
  assert.match(text, /play: http:\/\/lan\/s\/t\/EBOD-391\.m3u8/);
  assert.match(text, /with: vlc/);
  assert.match(text, /poster: https:\/\/img\/x\.jpg/);
});

test("CLI_INSTALL_HINT is actionable", () => {
  assert.match(CLI_INSTALL_HINT, /install\.sh/);
  assert.match(CLI_INSTALL_HINT, /JAVINFO_CLI/);
});
