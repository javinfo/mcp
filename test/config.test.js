import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.JAVINFO_MCP_NO_AUTOSTART = "1";
const {
  configDir,
  configPath,
  parseTopLevelStrings,
  loadConfig,
  resolveApiKey,
  resolveBaseUrl,
  seedApiKeyFromEnv,
  mergeApiKeyIntoToml,
  DEFAULT_BASE_URL,
} = await import("../dist/index.js");

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "javinfo-mcp-cfg-"));
}

test("configDir uses XDG_CONFIG_HOME when set", () => {
  const home = "/home/u";
  assert.equal(configDir({ XDG_CONFIG_HOME: "/xdg" }, home), path.join("/xdg", "javinfo"));
  assert.equal(configDir({}, home), path.join(home, ".config", "javinfo"));
});

test("parseTopLevelStrings reads api_key and base_url before tables", () => {
  const raw = `
# comment
api_key = "jvi_test"
base_url = "https://example.test/"

[players]
vlc = "/usr/bin/vlc"
api_key = "ignored_in_table"
`;
  const cfg = parseTopLevelStrings(raw);
  assert.equal(cfg.apiKey, "jvi_test");
  assert.equal(cfg.baseUrl, "https://example.test/");
});

test("resolveApiKey: env wins over file", () => {
  const home = tempHome();
  const dir = path.join(home, ".config", "javinfo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.toml"), 'api_key = "jvi_file"\n');
  assert.equal(resolveApiKey({ JAVINFO_API_KEY: "jvi_env" }, home), "jvi_env");
  assert.equal(resolveApiKey({}, home), "jvi_file");
  assert.equal(resolveApiKey({}, tempHome()), null);
  fs.rmSync(home, { recursive: true, force: true });
});

test("resolveBaseUrl: env, then file, then default", () => {
  const home = tempHome();
  const dir = path.join(home, ".config", "javinfo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.toml"), 'base_url = "https://from.file"\n');
  assert.equal(
    resolveBaseUrl({ JAVINFO_BASE_URL: "https://from.env/" }, home),
    "https://from.env",
  );
  assert.equal(resolveBaseUrl({}, home), "https://from.file");
  assert.equal(resolveBaseUrl({}, tempHome()), DEFAULT_BASE_URL);
  fs.rmSync(home, { recursive: true, force: true });
});

test("mergeApiKeyIntoToml preserves [players] and empty file", () => {
  assert.equal(mergeApiKeyIntoToml("", "jvi_x"), 'api_key = "jvi_x"\n');
  const withPlayers = '[players]\nvlc = "/usr/bin/vlc"\n';
  const merged = mergeApiKeyIntoToml(withPlayers, "jvi_x");
  assert.match(merged, /^api_key = "jvi_x"/m);
  assert.match(merged, /\[players\]/);
  assert.match(merged, /vlc = "\/usr\/bin\/vlc"/);

  const emptyKey = 'api_key = ""\n[players]\nmpv = "/usr/bin/mpv"\n';
  const replaced = mergeApiKeyIntoToml(emptyKey, "jvi_y");
  assert.match(replaced, /api_key = "jvi_y"/);
  assert.doesNotMatch(replaced, /api_key = ""/);
  assert.match(replaced, /\[players\]/);
});

test("seedApiKeyFromEnv writes only when file key empty", () => {
  const home = tempHome();
  const file = configPath({}, home);

  // no env → no write
  assert.equal(seedApiKeyFromEnv({}, home), false);
  assert.equal(fs.existsSync(file), false);

  // env + missing file → write
  assert.equal(seedApiKeyFromEnv({ JAVINFO_API_KEY: "jvi_seed" }, home), true);
  assert.equal(loadConfig({}, home).apiKey, "jvi_seed");

  // existing non-empty key → no overwrite
  assert.equal(seedApiKeyFromEnv({ JAVINFO_API_KEY: "jvi_other" }, home), false);
  assert.equal(loadConfig({}, home).apiKey, "jvi_seed");

  // empty key in file + env → write
  const home2 = tempHome();
  const dir2 = configDir({}, home2);
  fs.mkdirSync(dir2, { recursive: true });
  fs.writeFileSync(
    path.join(dir2, "config.toml"),
    'api_key = ""\n[players]\nvlc = "/bin/vlc"\n',
  );
  assert.equal(seedApiKeyFromEnv({ JAVINFO_API_KEY: "jvi_fill" }, home2), true);
  const raw = fs.readFileSync(path.join(dir2, "config.toml"), "utf8");
  assert.match(raw, /api_key = "jvi_fill"/);
  assert.match(raw, /\[players\]/);
  assert.match(raw, /vlc = "\/bin\/vlc"/);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(home2, { recursive: true, force: true });
});
