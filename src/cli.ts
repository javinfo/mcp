import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ENV_CLI = "JAVINFO_CLI";
export const CLI_INSTALL_HINT =
  "javinfo CLI not found. Install: curl -fsSL https://javinfo.dev/install.sh | bash (or set JAVINFO_CLI). Required for local serve/open tools.";

export type OpenOpts = {
  with?: string;
  maxHeight?: number;
  ttl?: number;
};

export type ServeAction = "start" | "stop" | "status";

export type ServeOpts = {
  port?: number;
  bind?: string;
  maxHeight?: number;
};

export type ServeResult = {
  action: ServeAction;
  /** For status: whether the daemon is up. For start/stop: best-effort. */
  running: boolean;
  message: string;
  pid?: number;
  listen?: string;
  lan?: string;
  maxHeight?: number;
  sessions?: number;
  startedAtUnix?: number;
  log?: string;
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
  const p = player?.trim();
  if (p) {
    lines.push(`with: ${p}`);
  } else {
    // Prompt the agent/user to relaunch with VLC (preferred local player).
    lines.push(
      "tip: ask the user to open with VLC — call again with with=\"vlc\" to launch it",
    );
  }
  const poster =
    typeof result.meta.jacketUrl === "string" ? result.meta.jacketUrl : "";
  if (poster) lines.push(`poster: ${poster}`);
  return lines.join("\n");
}

export type RunCliOptions = {
  /** Binary override (tests). */
  binary?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

export type RunOpenOptions = OpenOpts & RunCliOptions;

type CliCapture = {
  stdout: string;
  stderr: string;
  code: number | null;
};

/**
 * Spawn javinfo with captured stdio (MCP stdout must stay clean).
 * Resolves even on non-zero exit so callers can interpret status text.
 */
async function runJavinfo(
  args: string[],
  opts: RunCliOptions = {},
): Promise<CliCapture> {
  const bin = opts.binary ?? cliBinary(opts.env ?? process.env);
  const env = { ...(opts.env ?? process.env) };
  if (!env.RUST_LOG) env.RUST_LOG = "error";

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      env,
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "", code: 0 };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(CLI_INSTALL_HINT);
    }
    // execFile throws on non-zero; still has stdout/stderr when present.
    if (typeof err?.status === "number" || typeof err?.code === "number") {
      return {
        stdout: typeof err.stdout === "string" ? err.stdout : "",
        stderr: typeof err.stderr === "string" ? err.stderr : "",
        code: typeof err.status === "number" ? err.status : Number(err.code) || 1,
      };
    }
    const detail =
      [err?.stderr, err?.stdout, err?.message]
        .filter((s) => typeof s === "string" && s.trim())
        .map((s: string) => s.trim())
        .join("\n") || "javinfo failed";
    throw new Error(detail);
  }
}

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

  const { stdout, stderr, code: exit } = await runJavinfo(buildOpenArgs(code, opts), {
    binary: opts.binary,
    timeoutMs: opts.timeoutMs,
    env: opts.env,
  });
  if (exit !== 0) {
    const detail =
      [stderr, stdout].filter((s) => s.trim()).join("\n") || "javinfo open failed";
    throw new Error(detail);
  }
  return parseOpenResult(stdout);
}

/** Build argv for `javinfo serve [flags] start|stop|status`. */
export function buildServeArgs(action: ServeAction, opts: ServeOpts = {}): string[] {
  const args = ["serve"];
  if (opts.port != null && Number.isFinite(opts.port)) {
    args.push("--port", String(Math.trunc(opts.port)));
  }
  if (opts.bind?.trim()) {
    args.push("--bind", opts.bind.trim());
  }
  if (opts.maxHeight != null && Number.isFinite(opts.maxHeight)) {
    args.push("--max-height", String(Math.trunc(opts.maxHeight)));
  }
  args.push(action);
  return args;
}

/** Parse `javinfo serve status` human key/value lines. */
export function parseServeStatusOutput(text: string): Partial<ServeResult> {
  const out: Partial<ServeResult> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\w+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    switch (key) {
      case "pid":
        out.pid = Number(val) || undefined;
        break;
      case "listen":
        out.listen = val;
        break;
      case "lan":
        out.lan = val;
        break;
      case "max_h":
        out.maxHeight = Number(val) || undefined;
        break;
      case "sessions":
        out.sessions = Number(val);
        break;
      case "started":
        out.startedAtUnix = Number(val) || undefined;
        break;
      case "log":
        out.log = val;
        break;
    }
  }
  return out;
}

function stripCliNoise(text: string): string {
  const eyreMsgs: string[] = [];
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    // tracing timestamps
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) continue;
    if (/^(Location|Backtrace|Run with RUST_BACKTRACE)/i.test(t)) continue;
    if (/^Error:\s*$/i.test(t)) continue;
    // color-eyre "   0: actual message"
    const eyre = t.match(/^\d+:\s*(.+)$/);
    if (eyre) {
      eyreMsgs.push(eyre[1]);
      continue;
    }
    kept.push(t);
  }
  // Prefer human CLI lines; fall back to eyre root cause.
  const body = kept.join("\n").trim();
  if (body) return body;
  return eyreMsgs.join("\n").trim();
}

function isDaemonNotRunningMessage(text: string): boolean {
  return /serve daemon is not running/i.test(text);
}

export function fmtServe(result: ServeResult): string {
  if (result.action === "status" && result.running) {
    const lines = [
      `serve: running`,
      result.pid != null ? `pid: ${result.pid}` : "",
      result.listen ? `listen: ${result.listen}` : "",
      result.lan ? `lan: ${result.lan}` : "",
      result.maxHeight != null ? `max_h: ${result.maxHeight}` : "",
      result.sessions != null ? `sessions: ${result.sessions}` : "",
      result.log ? `log: ${result.log}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  }
  if (result.action === "status" && !result.running) {
    return "serve: not running";
  }
  return result.message || `serve ${result.action} ok`;
}

export type RunServeOptions = ServeOpts & RunCliOptions;

/**
 * Spawn `javinfo serve start|stop|status`.
 * `status` when the daemon is down is a normal result (`running: false`), not a throw.
 */
export async function runJavinfoServe(
  action: ServeAction,
  opts: RunServeOptions = {},
): Promise<ServeResult> {
  if (action !== "start" && action !== "stop" && action !== "status") {
    throw new Error(`invalid serve action: ${action}`);
  }

  const { stdout, stderr, code } = await runJavinfo(buildServeArgs(action, opts), {
    binary: opts.binary,
    timeoutMs: opts.timeoutMs ?? 60_000,
    env: opts.env,
  });
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const cleaned = stripCliNoise(combined) || combined.trim();

  if (action === "status") {
    if (code === 0 && /pid\s+\d+/i.test(stdout)) {
      const parsed = parseServeStatusOutput(stdout);
      return {
        action,
        running: true,
        message: cleaned || "running",
        ...parsed,
      };
    }
    // CLI exits non-zero when daemon is down — treat as structured status.
    if (isDaemonNotRunningMessage(combined) || code !== 0) {
      return {
        action,
        running: false,
        message: isDaemonNotRunningMessage(combined)
          ? "serve daemon is not running"
          : cleaned || "serve daemon is not running",
      };
    }
  }

  if (code !== 0) {
    throw new Error(cleaned || `javinfo serve ${action} failed`);
  }

  if (action === "start") {
    const already = /already running/i.test(cleaned);
    const pidM = cleaned.match(/pid[= ](\d+)/i);
    return {
      action,
      running: true,
      message: cleaned || (already ? "already running" : "started"),
      pid: pidM ? Number(pidM[1]) : undefined,
      lan: cleaned.match(/(https?:\/\/\S+)/)?.[1],
    };
  }

  // stop
  const notRunning = isDaemonNotRunningMessage(cleaned);
  return {
    action,
    running: false,
    message: cleaned || (notRunning ? "serve daemon is not running" : "stopped"),
  };
}
