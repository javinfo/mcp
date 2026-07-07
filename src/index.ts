#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = "https://api.javinfo.dev";

// --- API call -------------------------------------------------------------
async function postJavinfo(
  path: "query" | "movie",
  q: string,
  key: string,
  providers?: string | string[],
) {
  const body: Record<string, unknown> = { q };
  // API accepts a comma-separated string or array; normalize to string.
  if (providers?.length) body.providers = Array.isArray(providers) ? providers.join(",") : providers;
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-javinfo-key": key,
      "user-agent": "javinfo-mcp/0.1",
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
const MOVIE_PROVIDERS = ["r18", "javdb", "missav", "javdatabase"] as const;
const SEARCH_PROVIDERS = ["r18", "missav", "javdatabase"] as const;
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

// --- token-lean formatters (exported for tests) ---------------------------
const list = (a?: unknown[]) => (Array.isArray(a) && a.length ? a.join(", ") : "");
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
      r.releaseDate,
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
    ["Released", r.releaseDate || ""],
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

  // images (r18 gallery, javdatabase sampleImages) — gated
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

// --- server ---------------------------------------------------------------
// Shared: which upstream sources to try. r18/javdatabase = metadata,
// javdb = magnet/download links + score, missav = HLS (.m3u8) streams.
const providersArg = (opts: readonly string[], note: string) =>
  z
    .union([z.enum(opts as [string, ...string[]]), z.array(z.enum(opts as [string, ...string[]]))])
    .optional()
    .describe(note);

// javdb download links come from javinfo-movie, not search (javdb is code-only).
const searchProvidersSchema = providersArg(
  SEARCH_PROVIDERS,
  'Restrict list-search providers (single or array). "r18" (metadata + free-text), "missav" (m3u8), "javdatabase" (samples). javdb is NOT available here — use javinfo-movie for download links. Default: try all.',
);
const movieProvidersSchema = providersArg(
  MOVIE_PROVIDERS,
  'Restrict providers (single or array). "r18" (metadata), "javdb" (download links + torrents), "missav" (m3u8 streams), "javdatabase" (description + samples). Default: try all.',
);

// External read-only, idempotent lookups — hint the client accordingly.
const READ_HINTS = { readOnlyHint: true, openWorldHint: true, destructiveHint: false, idempotentHint: true } as const;

function createServer(key: string): McpServer {
  const server = new McpServer(
    { name: "javinfo", version: "0.1.0" },
    {
      instructions:
        "Search first with javinfo-search to find the exact dvdId, then javinfo-movie for the full record. Pin providers: javdb=download/torrent links, missav=m3u8 streams, r18/javdatabase=metadata.",
    },
  );

  server.registerTool(
    "javinfo-search",
    {
      description:
        "Search javinfo for adult videos by DVD code, title, or actress. Returns a compact list of matches. Call this FIRST to find the exact dvdId, then pass that dvdId to javinfo-movie for full details (context7-style resolve → detail).",
      annotations: { title: "javinfo: search titles", ...READ_HINTS },
      inputSchema: {
        q: z.string().min(1).describe("code, title, or actress name, e.g. AVSA-210"),
        providers: searchProvidersSchema,
      },
      outputSchema: searchOutputShape,
    },
    async ({ q, providers }) => {
      try {
        const json = await postJavinfo("query", q, key, providers);
        if (!json) {
          const empty = { q, source: null, query: q, count: 0, results: [] };
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
      try {
        const json = await postJavinfo("movie", q, key, providers);
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

  return server;
}

async function main() {
  const key = process.env.JAVINFO_API_KEY;
  if (!key) {
    console.error("javinfo-mcp: JAVINFO_API_KEY env var is required.");
    process.exit(1);
  }
  await createServer(key).connect(new StdioServerTransport());
}

// This package is a CLI/stdio server — always run. (No import-only use; a
// prior entry-point guard broke launches via npx's cache-dir symlinks.)
main();
