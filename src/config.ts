import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_BASE_URL = "https://api.javinfo.dev";
export const ENV_API_KEY = "JAVINFO_API_KEY";
export const ENV_BASE_URL = "JAVINFO_BASE_URL";

export type JavinfoConfig = {
  apiKey?: string;
  baseUrl?: string;
};

/** Config dir: $XDG_CONFIG_HOME/javinfo or ~/.config/javinfo (CLI parity). */
export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, "javinfo");
  return path.join(home, ".config", "javinfo");
}

export function configPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  return path.join(configDir(env, home), "config.toml");
}

/**
 * Read top-level string keys only (before the first `[table]`).
 * Matches CLI keys: api_key, base_url.
 */
export function parseTopLevelStrings(raw: string): JavinfoConfig {
  const out: JavinfoConfig = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("[")) break;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/);
    if (!m) continue;
    const key = m[1];
    const val = (m[2] ?? m[3] ?? "").trim();
    if (key === "api_key" && val) out.apiKey = val;
    if (key === "base_url" && val) out.baseUrl = val;
  }
  return out;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): JavinfoConfig {
  const file = configPath(env, home);
  if (!fs.existsSync(file)) return {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    return parseTopLevelStrings(raw);
  } catch {
    return {};
  }
}

export function resolveApiKey(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string | null {
  const fromEnv = env[ENV_API_KEY]?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = loadConfig(env, home).apiKey?.trim();
  return fromFile || null;
}

export function resolveBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const fromEnv = env[ENV_BASE_URL]?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const fromFile = loadConfig(env, home).baseUrl?.trim();
  if (fromFile) return fromFile.replace(/\/+$/, "");
  return DEFAULT_BASE_URL;
}

/**
 * If env has a key and config.toml has no non-empty api_key, write/merge it
 * (mode 0600 on Unix). Never overwrites an existing non-empty key.
 * Returns true if a write occurred.
 */
export function seedApiKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): boolean {
  const envKey = env[ENV_API_KEY]?.trim();
  if (!envKey) return false;

  const file = configPath(env, home);
  let raw = "";
  if (fs.existsSync(file)) {
    raw = fs.readFileSync(file, "utf8");
    const existing = parseTopLevelStrings(raw).apiKey?.trim();
    if (existing) return false;
  }

  const next = mergeApiKeyIntoToml(raw, envKey);
  const dir = configDir(env, home);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, next, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // non-Unix or restricted FS — best-effort
  }
  return true;
}

/** Insert or replace top-level api_key without clobbering the rest of the file. */
export function mergeApiKeyIntoToml(raw: string, apiKey: string): string {
  const line = `api_key = "${escapeTomlBasic(apiKey)}"`;
  if (!raw.trim()) return `${line}\n`;

  const lines = raw.split(/\r?\n/);
  let replaced = false;
  let inTable = false;
  const out: string[] = [];

  for (const row of lines) {
    const t = row.trim();
    if (t.startsWith("[")) inTable = true;
    if (
      !inTable &&
      !replaced &&
      /^api_key\s*=/.test(t) &&
      !t.startsWith("#")
    ) {
      out.push(line);
      replaced = true;
      continue;
    }
    out.push(row);
  }

  if (!replaced) {
    // Prepend so it stays top-level before any [players] table.
    const body = out.join("\n").replace(/^\n+/, "");
    return `${line}\n${body.endsWith("\n") || body === "" ? body : body + "\n"}`;
  }
  return out.join("\n").endsWith("\n") ? out.join("\n") : out.join("\n") + "\n";
}

function escapeTomlBasic(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
