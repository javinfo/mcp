# @javinfo/mcp

MCP (stdio) server for the [javinfo](https://javinfo.dev) API. Gives an LLM two
tools, in the context7 resolve → detail shape:

- **`javinfo-search`** — search by DVD code, title, or actress. Returns a compact list of matches.
- **`javinfo-movie`** — full record for one title by exact DVD id. Image URLs omitted by default (`includeImages: true` to include them).

Both accept a `providers` arg (`r18`, `javdb`, `missav`, `javdatabase`) to pin the source: `javdb` for download/torrent links, `missav` for m3u8 streams, `r18`/`javdatabase` for metadata.

Text output is token-lean markdown; each result also carries the full record as MCP `structuredContent` for programmatic clients.

## Setup

Requires a javinfo API key in the `JAVINFO_API_KEY` env var.

```json
{
  "mcpServers": {
    "javinfo": {
      "command": "npx",
      "args": ["-y", "@javinfo/mcp"],
      "env": { "JAVINFO_API_KEY": "jvi_..." }
    }
  }
}
```

## Develop

```bash
npm install
npm run build     # tsc -> dist/
npm test          # formatter self-check
JAVINFO_API_KEY=jvi_... npx @modelcontextprotocol/inspector node dist/index.js
```
