# @javinfo/mcp

An MCP server (stdio) for the [javinfo](https://javinfo.dev) API. Look up JAV
releases by DVD code, title, or actress, and get metadata, download links, or
stream URLs back.

## Tools

| Tool | Does |
|------|------|
| `javinfo-search` | Search by code, title, or actress. Returns a list of matches. |
| `javinfo-movie` | Fetch one release by exact DVD id. |

Search first to find the code, then call `javinfo-movie` with it.

`providers` picks where the data comes from:

- `r18` — metadata (also does free-text search)
- `javdb` — download links and magnets (`javinfo-movie` only)
- `missav` — `.m3u8` streams
- `javdatabase` — description and sample images

Movie output skips image URLs unless you pass `includeImages: true`. Every
result also carries the raw record as `structuredContent`.

## Setup

Needs a javinfo API key in the `JAVINFO_API_KEY` environment variable.
Get your free key at [javinfo.dev](https://javinfo.dev).

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

## Local

```bash
npm install
npm run build
JAVINFO_API_KEY=jvi_... npx @modelcontextprotocol/inspector node dist/index.js
```
