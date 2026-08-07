import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ENV_CLI = "JAVINFO_CLI";
export const CLI_INSTALL_HINT =
  "javinfo CLI not found. Install: curl -fsSL https://javinfo.dev/install.sh | bash (or set JAVINFO_CLI). Required for javinfo-open.";

export type OpenOpts = {
  with?: string;
  maxHeight?: number;
  ttl?: number;
};

export type OpenResult = {
  token: string;
  play_url: string;
  meta_url: string;
  meta: Record<string, unknown>;
};

export function cliBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[ENV_CLI]?.trim();
  return override || "javinfo";
}

/** Build argv for `javinfo open --json …` (no binary name). */
export function buildOpenArgs(q: string, opts: OpenOpts = {}): string[] {
  const code = q.trim();
  const args = ["open", "--json", code];
  const player = opts.with?.trim();
  if (player) {
    args.push("--with", player);
  }
  if (opts.maxHeight != null && Number.isFinite(opts.maxHeight)) {
    args.push("--max-height", String(Math.trunc(opts.maxHeight)));
  }
  if (opts.ttl != null && Number.isFinite(opts.ttl)) {
    args.push("--ttl", String(Math.trunc(opts.ttl)));
  }
  return args;
}

/** Pull the first JSON object from mixed stdout (CLI may log INFO lines). */
export function extractJsonObject(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("javinfo open returned no JSON on stdout");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

export function parseOpenResult(stdout: string): OpenResult {
  const raw = extractJsonObject(stdout) as Record<string, unknown>;
  if (
    typeof raw.token !== "string" ||
    typeof raw.play_url !== "string" ||
    typeof raw.meta_url !== "string"
  ) {
    throw new Error("javinfo open JSON missing token/play_url/meta_url");
  }
  return {
    token: raw.token,
    play_url: raw.play_url,
    meta_url: raw.meta_url,
    meta:
      raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta)
        ? (raw.meta as Record<string, unknown>)
        : {},
  };
}

export function fmtOpen(
  result: OpenResult,
  q: string,
  player?: string,
): string {
  const label =
    (typeof result.meta.dvdId === "string" && result.meta.dvdId) ||
    (typeof result.meta.code === "string" && result.meta.code) ||
    q;
  const title =
    typeof result.meta.title === "string" && result.meta.title
      ? result.meta.title
      : "";
  const lines = [
    title ? `**${label}** — ${title}` : `**${label}**`,
    `play: ${result.play_url}`,
    `meta: ${result.meta_url}`,
  ];
  if (player?.trim()) lines.push(`with: ${player.trim()}`);
  const poster =
    typeof result.meta.jacketUrl === "string" ? result.meta.jacketUrl : "";
  if (poster) lines.push(`poster: ${poster}`);
  return lines.join("\n");
}

export type RunOpenOptions = OpenOpts & {
  /** Binary override (tests). */
  binary?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

/**
 * Spawn `javinfo open --json`. Captures stdout/stderr (never inherits stdio —
 * MCP stdio must stay clean).
 */
export async function runJavinfoOpen(
  q: string,
  opts: RunOpenOptions = {},
): Promise<OpenResult> {
  const code = q.trim();
  if (!code) throw new Error("q (DVD code) cannot be empty");

  const bin = opts.binary ?? cliBinary(opts.env ?? process.env);
  const args = buildOpenArgs(code, opts);
  const env = { ...(opts.env ?? process.env) };
  // Keep CLI logs off stdout/stderr noise unless the user already set RUST_LOG.
  if (!env.RUST_LOG) env.RUST_LOG = "error";

  try {
    const { stdout } = await execFileAsync(bin, args, {
      env,
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    return parseOpenResult(stdout);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(CLI_INSTALL_HINT);
    }
    // execFile attaches stdout/stderr on failure — prefer CLI text.
    const detail =
      [err?.stderr, err?.stdout, err?.message]
        .filter((s) => typeof s === "string" && s.trim())
        .map((s: string) => s.trim())
        .join("\n") || "javinfo open failed";
    throw new Error(detail);
  }
}
