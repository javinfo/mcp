import test from "node:test";
import assert from "node:assert/strict";

// Import the built server without spawning it (see index.ts autostart gate).
process.env.JAVINFO_MCP_NO_AUTOSTART = "1";
const { fmtRandom, fmtSearch } = await import("../dist/index.js");

test("fmtRandom lists movie-shaped records", () => {
  const out = fmtRandom([
    { dvdId: "SSIS-001", titleEn: "Title A", actresses: ["Ema Kisaki"], releaseDate: "2021-07-06T18:30:00.000Z", runtimeMins: 120 },
    { dvdId: "ABP-999", titleJa: "邦題", makers: ["S1"] },
  ]);
  assert.match(out, /2 random title\(s\)/);
  assert.match(out, /\*\*SSIS-001\*\* — Title A/);
  assert.match(out, /Ema Kisaki · 2021-07-06 · 120min/); // ISO datetime trimmed to date
  assert.match(out, /\*\*ABP-999\*\* — 邦題/); // falls back to titleJa
  assert.match(out, /S1/); // makers rendered
});

test("fmtRandom handles empty / non-array", () => {
  assert.equal(fmtRandom([]), "No random titles returned.");
  assert.equal(fmtRandom(undefined), "No random titles returned.");
});

test("fmtSearch still renders search-shaped results", () => {
  const out = fmtSearch({
    q: "SSIS",
    results: [{ dvdId: "SSIS-001", title: "T", releaseDate: "2021-07-06", extra: { actresses: ["A"] } }],
  });
  assert.match(out, /1 result\(s\) for "SSIS"/);
  assert.match(out, /\*\*SSIS-001\*\*/);
});
