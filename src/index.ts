#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  DEFAULT_BASE_URL,
  configDir,
  configPath,
  loadConfig,
  mergeApiKeyIntoToml,
  parseTopLevelStrings,
  resolveApiKey,
  resolveBaseUrl,
  seedApiKeyFromEnv,
} from "./config.js";
import {
  CLI_INSTALL_HINT,
  buildOpenArgs,
  cliBinary,
  extractJsonObject,
  fmtOpen,
  parseOpenResult,
  runJavinfoOpen,
} from "./cli.js";

// Re-export for unit tests (imported from dist/index.js).
export {
  DEFAULT_BASE_URL,
  configDir,
  configPath,
  loadConfig,
  mergeApiKeyIntoToml,
  parseTopLevelStrings,
  resolveApiKey,
  resolveBaseUrl,
  seedApiKeyFromEnv,
  CLI_INSTALL_HINT,
  buildOpenArgs,
  cliBinary,
  extractJsonObject,
  fmtOpen,
  parseOpenResult,
  runJavinfoOpen,
};

// --- API call -------------------------------------------------------------
type Path = "query" | "movie" | "random";

// API accepts providers as a comma string or array; normalize to a string.
function normProviders(p?: string | string[]): string | undefined {
  if (!p?.length) return undefined;
  return Array.isArray(p) ? p.join(",") : p;
}

async function postJavinfo(
  baseUrl: string,
  path: Path,
  body: Record<string, unknown>,
  key: string,
) {
  const res = await fetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-javinfo-key": key,
      "user-agent": "javinfo-mcp/0.3",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null; // valid miss: code not indexed, not a failure
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || `javinfo ${path} HTTP ${res.status}`);
  }
  return json;
}

// --- output schemas (exported for tests) ----------------------------------
// Permissive + forward-compatible so any provider's shape validates.
// javdb is code-only: valid on /movie, NOT on /query (list search).
const MOVIE_PROVIDERS = ["fanza", "dmm", "javdb", "missav", "javdatabase"] as const;
const SEARCH_PROVIDERS = ["fanza", "dmm", "missav", "javdatabase"] as const;
const nstr = z.string().nullable().optional();
const strArr = z.array(z.string()).optional();

const movieResultSchema = z
  .object({
    contentId: nstr,
    dvdId: nstr,
    titleEn: nstr,
    titleJa: nstr,
    commentEn: nstr,
    commentJa: nstr,
    runtimeMins: z.number().nullable().optional(),
    releaseDate: nstr,
    makers: strArr,
    label: nstr,
    series: nstr,
    categories: strArr,
    actresses: strArr,
    actors: strArr,
    directors: strArr,
    authors: strArr,
    jacketFullUrl: nstr,
    jacketThumbUrl: nstr,
    site: nstr,
    serviceCode: nstr,
    extra: z
      .object({
        actressesRich: z.array(z.object({ name: z.string(), image: nstr }).loose()).optional(),
        sampleUrl: nstr,
        galleryFull: strArr,
        galleryThumb: strArr,
        sampleImages: strArr,
        downloadLinks: z
          .array(
            z
              .object({
                name: nstr,
                hash: nstr,
                magnet: nstr,
                url: nstr,
                size: z.number().nullable().optional(),
                hd: z.boolean().nullable().optional(),
                filesCount: z.number().nullable().optional(),
              })
              .loose(),
          )
          .optional(),
        score: z.number().nullable().optional(),
        voteCount: z.number().nullable().optional(),
        pageUrl: nstr,
        description: nstr,
        trailerUrl: nstr,
        streams: z
          .object({ master: z.string(), variants: strArr })
          .loose()
          .nullable()
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const searchResultSchema = z
  .object({
    id: nstr,
    dvdId: nstr,
    title: nstr,
    cover: nstr,
    releaseDate: nstr,
    extra: z.record(z.string(), z.any()).optional(),
  })
  .loose();

export const searchOutputShape = {
  q: z.string(),
  source: z.string().nullable(),
  query: z.string().optional(),
  count: z.number().optional(),
  results: z.array(searchResultSchema),
};
export const movieOutputShape = {
  q: z.string(),
  source: z.string().nullable(),
  result: movieResultSchema.nullable(),
};
// /random returns a bare array of movie records; wrap for MCP structuredContent.
export const randomOutputShape = {
  count: z.number(),
  results: z.array(movieResultSchema),
};

// --- token-lean formatters (exported for tests) ---------------------------
const list = (a?: unknown[]) => (Array.isArray(a) && a.length ? a.join(", ") : "");
// Trim ISO datetimes ("2024-03-11T18:30:00.000Z") to the date; leave plain dates as-is.
const day = (s?: unknown) => (typeof s === "string" ? s.slice(0, 10) : "");
const names = (a?: any[]) =>
  Array.isArray(a) ? a.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean) : [];

export function fmtSearch(json: any): string {
  const results: any[] = json?.results ?? [];
  if (!results.length) return `No results for "${json?.q ?? ""}".`;
  const lines = results.map((r, i) => {
    const e = r.extra ?? {};
    const title = e.titleEn || r.title || e.titleJa || "(untitled)";
    const bits = [
      names(e.actresses).join(", "),
      day(r.releaseDate),
      e.runtimeMins ? `${e.runtimeMins}min` : "",
      e.maker,
      e.series ? `series: ${e.series}` : "",
    ].filter(Boolean);
    const cats = list(e.categories);
    return (
      `${i + 1}. **${r.dvdId}** — ${title}\n` +
      (bits.length ? `   ${bits.join(" · ")}\n` : "") +
      (cats ? `   categories: ${cats}\n` : "")
    );
  });
  return `${results.length} result(s) for "${json.q}":\n\n${lines.join("")}`.trimEnd();
}

export function fmtMovie(json: any, includeImages = false): string {
  const r = json?.result;
  if (!r) return `No movie found for "${json?.q ?? ""}".`;
  const e = r.extra ?? {};
  const clean = (s: string) => String(s).replace(/\s+/g, " ").trim();
  const rows: [string, string][] = [
    ["Source", json.source || ""],
    ["Title (EN)", r.titleEn || ""],
    ["Title (JA)", r.titleJa || ""],
    ["DVD ID", r.dvdId || ""],
    ["Content ID", r.contentId || ""],
    ["Released", day(r.releaseDate)],
    ["Runtime", r.runtimeMins ? `${r.runtimeMins} min` : ""],
    ["Makers", list(r.makers)],
    ["Label", r.label || ""],
    ["Series", r.series || ""],
    ["Categories", list(r.categories)],
    ["Actresses", names(e.actressesRich).join(", ") || names(r.actresses).join(", ")],
    ["Actors", names(r.actors).join(", ")],
    ["Directors", list(r.directors)],
    ["Authors", list(r.authors)],
    ["Score", e.score != null ? `${e.score}${e.voteCount != null ? ` (${e.voteCount} votes)` : ""}` : ""],
    ["Comment (EN)", r.commentEn || ""],
    ["Comment (JA)", r.commentJa || ""],
    ["Description", e.description ? clean(e.description) : ""],
    ["Page", e.pageUrl || ""],
    ["Trailer", e.trailerUrl || ""],
  ];
  const secs: string[] = [
    rows
      .filter(([, v]) => v)
      .map(([k, v]) => `**${k}:** ${v}`)
      .join("\n"),
  ];

  // javdb: magnet / download links
  if (Array.isArray(e.downloadLinks) && e.downloadLinks.length) {
    const lines = e.downloadLinks.map((d: any) => {
      const tags = [d.hd ? "HD" : "", d.size ? `size ${d.size}` : "", d.filesCount ? `${d.filesCount} files` : ""]
        .filter(Boolean)
        .join(" · ");
      return (
        `- ${d.name || d.hash}${tags ? ` (${tags})` : ""}` +
        (d.magnet ? `\n  ${d.magnet}` : "") +
        (d.url ? `\n  ${d.url}` : "")
      );
    });
    secs.push(`**Downloads (javdb):**\n${lines.join("\n")}`);
  }

  // missav: HLS streams
  if (e.streams?.master) {
    const variants = (e.streams.variants ?? []).map((u: string) => `- ${u}`).join("\n");
    secs.push(`**Streams (missav):**\nmaster: ${e.streams.master}${variants ? `\n${variants}` : ""}`);
  }

  // images (fanza/dmm gallery, javdatabase sampleImages) — gated
  if (includeImages) {
    const imgs = [
      r.jacketFullUrl && `jacket: ${r.jacketFullUrl}`,
      e.sampleUrl && `sample: ${e.sampleUrl}`,
      ...(Array.isArray(e.galleryFull) ? e.galleryFull.map((u: string) => `gallery: ${u}`) : []),
      ...(Array.isArray(e.sampleImages) ? e.sampleImages.map((u: string) => `sample: ${u}`) : []),
    ].filter(Boolean);
    if (imgs.length) secs.push(`**Images:**\n${imgs.join("\n")}`);
  }
  return secs.join("\n\n");
}

// /random returns movie-shaped records (not the search shape) — compact list.
export function fmtRandom(items: any[]): string {
  if (!Array.isArray(items) || !items.length) return "No random titles returned.";
  const lines = items.map((r, i) => {
    const bits = [
      names(r.actresses).join(", "),
      day(r.releaseDate),
      r.runtimeMins ? `${r.runtimeMins}min` : "",
      list(r.makers),
    ].filter(Boolean);
    const title = r.titleEn || r.titleJa || "(untitled)";
    return (
      `${i + 1}. **${r.dvdId || r.contentId || "?"}** — ${title}\n` +
      (bits.length ? `   ${bits.join(" · ")}\n` : "")
    );
  });
  return `${items.length} random title(s):\n\n${lines.join("")}`.trimEnd();
}

// --- server ---------------------------------------------------------------
// Shared: which upstream sources to try. fanza/dmm/javdatabase = metadata,
// javdb = magnet/download links + score, missav = HLS (.m3u8) streams.
const providersArg = (opts: readonly string[], note: string) =>
  z
    .union([z.enum(opts as [string, ...string[]]), z.array(z.enum(opts as [string, ...string[]]))])
    .optional()
    .describe(note);

// javdb download links come from javinfo-movie, not search (javdb is code-only).
const searchProvidersSchema = providersArg(
  SEARCH_PROVIDERS,
  'Restrict list-search providers (single or array). "fanza"/"dmm" (metadata + free-text), "missav" (m3u8), "javdatabase" (samples). javdb is NOT available here — use javinfo-movie for download links. Default: try all.',
);
const movieProvidersSchema = providersArg(
  MOVIE_PROVIDERS,
  'Restrict providers (single or array). "fanza"/"dmm" (metadata), "javdb" (download links + torrents), "missav" (m3u8 streams), "javdatabase" (description + samples). Default: try all.',
);

// /query filters (see the Filtering guide). All optional; values pass through to
// the winning provider verbatim (exact match; English vs Japanese genres vary by source).
const filterSchema = z
  .object({
    genre: z.string(),
    actress: z.string(),
    maker: z.string(),
    series: z.string(),
    director: z.string(),
    label: z.string(),
    actor: z.string(),
    censored: z.enum(["censored", "uncensored"]),
    runtimeMin: z.number().int(),
    runtimeMax: z.number().int(),
    releaseAfter: z.string(),
    releaseBefore: z.string(),
    availability: z.enum(["playable", "magnets", "subtitle", "single"]),
  })
  .partial()
  .describe(
    "Filter list-search; set only fields you need. fanza/dmm are censored-only; runtime range is fanza/dmm/missav; release range + Japanese genres are missav; availability is javdb. A PINNED provider that can't satisfy a filter returns 422.",
  );
const sortSchema = z
  .enum(["relevance", "release", "update", "rating"])
  .optional()
  .describe('Sort order (default relevance). "rating"/"update" are javdb-only; "release" is fanza/dmm/javdb.');

// External read-only, idempotent lookups — hint the client accordingly.
const READ_HINTS = { readOnlyHint: true, openWorldHint: true, destructiveHint: false, idempotentHint: true } as const;
// /random is read-only but non-idempotent (a fresh set each call).
const RANDOM_HINTS = { readOnlyHint: true, openWorldHint: true, destructiveHint: false, idempotentHint: false } as const;
// Local open: starts daemon / session / optional player — not read-only or idempotent.
const OPEN_HINTS = {
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: false,
  idempotentHint: false,
} as const;

export const openOutputShape = {
  q: z.string(),
  token: z.string(),
  play_url: z.string(),
  meta_url: z.string(),
  meta: z.record(z.string(), z.any()),
  with: z.string().optional(),
};

function createServer(key: string, baseUrl: string = DEFAULT_BASE_URL): McpServer {
  const server = new McpServer(
    { name: "javinfo", version: "0.4.0" },
    {
      instructions:
        "Search first with javinfo-search (supports filter/sort/pagination) to find the exact dvdId, then javinfo-movie for the full record. javinfo-random returns random DMM+FANZA titles. On hosts with the javinfo CLI installed, javinfo-open creates a local LAN HLS play URL (auto-starts serve daemon; optional with=vlc|mpv). Pin providers: javdb=download/torrent links, missav=m3u8 streams, fanza/dmm/javdatabase=metadata.",
    },
  );

  server.registerTool(
    "javinfo-search",
    {
      description:
        "Search javinfo for adult videos by DVD code, title, or actress, with optional filter/sort/pagination. Returns a compact list of matches. Call this FIRST to find the exact dvdId, then pass that dvdId to javinfo-movie for full details (context7-style resolve → detail). q is optional when a filter is set (browse a whole category). Pinning a provider that can't satisfy a filter/sort errors with 422.",
      annotations: { title: "javinfo: search titles", ...READ_HINTS },
      inputSchema: {
        q: z.string().min(1).optional().describe("code, title, or actress name, e.g. AVSA-210 (optional if filter set)"),
        providers: searchProvidersSchema,
        filter: filterSchema.optional(),
        sort: sortSchema,
        page: z.number().int().min(1).optional().describe("1-based page (default 1)"),
        num: z.number().int().min(1).max(50).optional().describe("results per page (default 10, max 50)"),
      },
      outputSchema: searchOutputShape,
    },
    async ({ q, providers, filter, sort, page, num }) => {
      const hasFilter = !!filter && Object.values(filter).some((v) => v !== undefined);
      if (!q && !hasFilter) {
        return {
          content: [{ type: "text", text: "Provide a search query (q) or at least one filter." }],
          isError: true,
        };
      }
      const body: Record<string, unknown> = {};
      if (q) body.q = q;
      const prov = normProviders(providers);
      if (prov) body.providers = prov;
      if (hasFilter) body.filter = filter;
      if (sort) body.sort = sort;
      if (page != null) body.page = page;
      if (num != null) body.num = num;
      try {
        const json = await postJavinfo(baseUrl, "query", body, key);
        if (!json) {
          const empty = { q: q ?? "", source: null, query: q ?? "", count: 0, results: [] };
          return { content: [{ type: "text", text: fmtSearch(empty) }], structuredContent: empty };
        }
        return { content: [{ type: "text", text: fmtSearch(json) }], structuredContent: json };
      } catch (err: any) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    },
  );

  server.registerTool(
    "javinfo-movie",
    {
      description:
        "Get the full record for one title by its exact DVD id (from javinfo-search). Use the providers arg to pin a source: javdb for download/torrent links, missav for m3u8 streams. Image URLs are omitted by default; set includeImages to append jacket, sample, and gallery URLs.",
      annotations: { title: "javinfo: movie details", ...READ_HINTS },
      inputSchema: {
        q: z.string().min(1).describe("exact DVD id, e.g. AVSA-210"),
        providers: movieProvidersSchema,
        includeImages: z.boolean().optional().describe("include image/gallery URLs (default false)"),
      },
      outputSchema: movieOutputShape,
    },
    async ({ q, providers, includeImages }) => {
      const body: Record<string, unknown> = { q };
      const prov = normProviders(providers);
      if (prov) body.providers = prov;
      try {
        const json = await postJavinfo(baseUrl, "movie", body, key);
        if (!json) {
          return {
            content: [{ type: "text", text: `No match for "${q}" — code likely not indexed.` }],
            structuredContent: { q, source: null, result: null },
          };
        }
        return {
          content: [{ type: "text", text: fmtMovie(json, includeImages) }],
          structuredContent: json,
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    },
  );

  server.registerTool(
    "javinfo-random",
    {
      description:
        "Get a batch of random DMM+FANZA titles (full records) — handy for landing pages or discovery. No query or provider pinning; just an optional count. Non-idempotent: a fresh set each call.",
      annotations: { title: "javinfo: random titles", ...RANDOM_HINTS },
      inputSchema: {
        num: z.number().int().min(1).max(50).optional().describe("how many titles (default 20, max 50)"),
      },
      outputSchema: randomOutputShape,
    },
    async ({ num }) => {
      const body: Record<string, unknown> = {};
      if (num != null) body.num = num;
      try {
        const items: any[] = (await postJavinfo(baseUrl, "random", body, key)) ?? [];
        const out = { count: items.length, results: items };
        return { content: [{ type: "text", text: fmtRandom(items) }], structuredContent: out };
      } catch (err: any) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    },
  );

  server.registerTool(
    "javinfo-open",
    {
      description:
        "Open a local LAN HLS play session for a DVD code via the javinfo CLI (required on PATH, or set JAVINFO_CLI). Auto-starts the serve daemon if needed; returns play_url / meta_url. Optional with launches a configured player (vlc, mpv, …). macOS/Linux only (CLI Unix sockets). Does not call the HTTP API from MCP — the CLI resolves streams.",
      annotations: { title: "javinfo: open local stream", ...OPEN_HINTS },
      inputSchema: {
        q: z.string().min(1).describe("exact DVD id, e.g. EBOD-391"),
        with: z
          .string()
          .min(1)
          .optional()
          .describe("local player id or path (vlc, mpv, …) — passed to `javinfo open --with`"),
        maxHeight: z
          .number()
          .int()
          .min(144)
          .max(4320)
          .optional()
          .describe("prefer HLS variants with height ≤ this (session override)"),
        ttl: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("optional session TTL in hours (default: no expiry)"),
      },
      outputSchema: openOutputShape,
    },
    async ({ q, with: withPlayer, maxHeight, ttl }) => {
      try {
        const opened = await runJavinfoOpen(q, {
          with: withPlayer,
          maxHeight,
          ttl,
        });
        const structured = {
          q,
          token: opened.token,
          play_url: opened.play_url,
          meta_url: opened.meta_url,
          meta: opened.meta,
          ...(withPlayer?.trim() ? { with: withPlayer.trim() } : {}),
        };
        return {
          content: [{ type: "text", text: fmtOpen(opened, q, withPlayer) }],
          structuredContent: structured,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: err?.message || String(err) }],
          isError: true,
        };
      }
    },
  );

  return server;
}

async function main() {
  // If env has a key and config.toml does not, seed so the CLI shares the same store.
  seedApiKeyFromEnv();
  const key = resolveApiKey();
  if (!key) {
    console.error(
      "javinfo-mcp: no API key — set JAVINFO_API_KEY or run `javinfo login` (writes ~/.config/javinfo/config.toml).",
    );
    process.exit(1);
  }
  const baseUrl = resolveBaseUrl();
  await createServer(key, baseUrl).connect(new StdioServerTransport());
}

// CLI/stdio server — autostart by default. Env-gated (not entry-point guarded:
// an import.meta/argv guard broke npx's symlinked cache dir) so tests can import
// the exported formatters without spawning the server.
if (!process.env.JAVINFO_MCP_NO_AUTOSTART) main();
