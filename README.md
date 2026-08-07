# @javinfo/mcp

An MCP server (stdio) for the [javinfo](https://javinfo.dev) API. Look up JAV
releases by DVD code, title, or actress, and get metadata, download links, or
stream URLs back. With the [javinfo CLI](https://github.com/javinfo/cli)
installed, you can also open a **local LAN HLS play session**.

## Tools

| Tool | Does |
|------|------|
| `javinfo-search` | Search by code, title, or actress — with optional filter, sort, and pagination. Returns a list of matches. |
| `javinfo-movie` | Fetch one release by exact DVD id. |
| `javinfo-random` | A batch of random DMM+FANZA titles (full records). |
| `javinfo-open` | Open a local play session via the **javinfo CLI** (auto-starts serve daemon; returns `play_url`). |
| `javinfo-serve` | Control the local serve daemon: `start` / `stop` / `status` (CLI required). |

Search first to find the code, then call `javinfo-movie` with it. On a machine
with the CLI, call `javinfo-open` for a LAN play URL (optional player launch),
or `javinfo-serve` to manage the daemon lifecycle.

`providers` picks where the data comes from:

- `fanza`, `dmm` — metadata (also do free-text search)
- `javdb` — download links and magnets (`javinfo-movie` only)
- `missav` — `.m3u8` streams
- `javdatabase` — description and sample images

Movie output skips image URLs unless you pass `includeImages: true`. Every
result also carries the raw record as `structuredContent`.

### Filtering search

`javinfo-search` also takes `filter`, `sort`, `page`, and `num` (page size,
default 10, max 50). `q` is optional when a `filter` is set — browse a whole
category with no keyword.

`filter` fields (all optional): `genre`, `actress`, `maker`, `series`,
`director`, `label`, `actor`, `censored` (`censored`/`uncensored`), `runtimeMin`,
`runtimeMax` (minutes), `releaseAfter`, `releaseBefore` (`YYYY-MM-DD`),
`availability` (`playable`/`magnets`/`subtitle`/`single`). `sort` is one of
`relevance` (default), `release`, `update`, `rating`.

Not every provider supports every filter — e.g. runtime range is fanza/dmm/missav,
release range and Japanese genres are missav, `availability` is javdb. Values
pass through **verbatim** (exact match; English vs Japanese genres vary by
source). Unpinned, the API skips a provider that can't satisfy a filter and
tries the next; **pin** a provider that can't and you get a `422` with the
reason.

### Local open (`javinfo-open`)

Requires the **javinfo CLI** on `PATH` (or set `JAVINFO_CLI` to an absolute
binary). Install:

```bash
curl -fsSL https://javinfo.dev/install.sh | bash
# until that URL is live:
# curl -fsSL https://raw.githubusercontent.com/javinfo/cli/main/install.sh | bash
```

| Arg | Required | Meaning |
|-----|----------|---------|
| `q` | yes | DVD code (e.g. `EBOD-391`) |
| `with` | no | Player id/path — prefer asking the user, then `vlc` (`javinfo open --with`) |
| `maxHeight` | no | Prefer variants ≤ this height |
| `ttl` | no | Session TTL in hours (default: no expiry) |

Returns `play_url` / `meta_url` (and launches a player when `with` is set).
Prefer asking the user to open with **VLC** (`with: "vlc"`).
The CLI auto-starts the serve daemon; the daemon keeps running after MCP exits.
**macOS / Linux** only for now (CLI control uses Unix sockets).

### Serve daemon (`javinfo-serve`)

| Arg | Required | Meaning |
|-----|----------|---------|
| `action` | yes | `start`, `stop`, or `status` |
| `port` | no | TCP port when starting (default `8787`) |
| `bind` | no | Bind address when starting (default `0.0.0.0`) |
| `maxHeight` | no | Daemon default max HLS height when starting |

`status` when the daemon is down returns `running: false` (not an error).

## Auth & config

API key resolution (same store as the CLI):

1. `JAVINFO_API_KEY` env
2. `api_key` in `$XDG_CONFIG_HOME/javinfo/config.toml` (fallback `~/.config/javinfo/config.toml`)
3. error if neither is set

API base URL:

1. `JAVINFO_BASE_URL` env
2. `base_url` in the same config file
3. default `https://api.javinfo.dev`

If the env key is set and the config file has no non-empty `api_key`, the server
**seeds** the key into that file (mode `0600`) so the CLI and MCP share one store.
An existing non-empty file key is never overwritten.

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

Or run `javinfo login` once and omit the env var from MCP config (key read from
config.toml). Optional: `JAVINFO_CLI` if the binary is not on `PATH`.

## Local

```bash
npm install
npm run build
npm test   # builds, then runs test/ (node:test)
JAVINFO_API_KEY=jvi_... npx @modelcontextprotocol/inspector node dist/index.js
```
