import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { fmtSearch, fmtMovie, searchOutputShape, movieOutputShape } from "../dist/index.js";

const IMG = "pics.dmm.co.jp";
const searchOut = z.object(searchOutputShape);
const movieOut = z.object(movieOutputShape);

const searchJson = {
  q: "AVSA-210",
  source: "r18",
  results: [
    {
      dvdId: "AVSA-210",
      title: null,
      releaseDate: "2022-07-12",
      cover: `https://${IMG}/x-cover.jpg`,
      extra: {
        titleJa: "超密着接写",
        runtimeMins: 123,
        maker: "AVS collector's",
        series: "Colossal Tits",
        categories: ["Big Tits", "Cosplay"],
        actresses: [{ name: "Momo Minami", image: `https://${IMG}/act.jpg` }],
      },
    },
  ],
};

const movieJson = {
  q: "AVSA-210",
  source: "r18",
  result: {
    dvdId: "AVSA-210",
    titleJa: "超密着接写",
    runtimeMins: 123,
    releaseDate: "2022-07-12",
    makers: ["AVS collector's"],
    actresses: ["Momo Minami"],
    directors: ["Hikaru Jinguji"],
    jacketFullUrl: `https://${IMG}/jacket.jpg`,
    extra: {
      actressesRich: [{ name: "Momo Minami", image: `https://${IMG}/act.jpg` }],
      sampleUrl: `https://${IMG}/sample.mp4`,
      galleryFull: [`https://${IMG}/g1.jpg`, `https://${IMG}/g2.jpg`],
    },
  },
};

test("fmtSearch keeps text, strips image URLs", () => {
  const out = fmtSearch(searchJson);
  assert.match(out, /AVSA-210/);
  assert.match(out, /Momo Minami/);
  assert.doesNotMatch(out, new RegExp(IMG));
});

test("fmtSearch handles empty", () => {
  assert.match(fmtSearch({ q: "nope", results: [] }), /No results/);
});

test("fmtMovie strips images by default", () => {
  const out = fmtMovie(movieJson);
  assert.match(out, /AVSA-210/);
  assert.match(out, /Momo Minami/);
  assert.doesNotMatch(out, new RegExp(IMG));
});

test("fmtMovie includes images when asked", () => {
  const out = fmtMovie(movieJson, true);
  assert.match(out, new RegExp(IMG));
  assert.match(out, /jacket\.jpg/);
  assert.match(out, /g2\.jpg/);
});

test("fmtMovie renders javdb download links + score", () => {
  const out = fmtMovie({
    q: "CAWD-001",
    source: "javdb",
    result: {
      dvdId: "CAWD-001",
      extra: {
        score: 3.61,
        voteCount: 289,
        downloadLinks: [{ name: "HD-cawd-001", magnet: "magnet:?xt=urn:btih:abc", url: "https://keepshare/x", size: 2816, hd: true, filesCount: 4 }],
      },
    },
  });
  assert.match(out, /Downloads \(javdb\)/);
  assert.match(out, /magnet:\?xt=urn:btih:abc/);
  assert.match(out, /3\.61 \(289 votes\)/);
});

test("output schemas accept all provider shapes + empty miss", () => {
  // search list + empty
  assert.doesNotThrow(() => searchOut.parse(searchJson));
  assert.doesNotThrow(() => searchOut.parse({ q: "x", source: null, query: "x", count: 0, results: [] }));
  // movie: r18, javdb, missav, javdatabase, and null miss
  assert.doesNotThrow(() => movieOut.parse(movieJson));
  assert.doesNotThrow(() => movieOut.parse({ q: "x", source: null, result: null }));
  assert.doesNotThrow(() =>
    movieOut.parse({ q: "CAWD-001", source: "javdb", result: { dvdId: "CAWD-001", extra: { score: 3.6, voteCount: 9, downloadLinks: [{ name: "a", magnet: "m", size: 10, hd: true, filesCount: 2 }] } } }),
  );
  assert.doesNotThrow(() =>
    movieOut.parse({ q: "EBOD-391", source: "missav", result: { dvdId: "EBOD-391", extra: { pageUrl: "p", streams: { master: "m.m3u8", variants: ["v.m3u8"] } } } }),
  );
  assert.doesNotThrow(() =>
    movieOut.parse({ q: "SSIS-001", source: "javdatabase", result: { dvdId: "SSIS-001", extra: { description: "d", sampleImages: ["s.jpg"], trailerUrl: "t.mp4" } } }),
  );
});

test("output schema preserves unknown/provider extra keys (loose)", () => {
  const parsed = movieOut.parse({ q: "x", source: "javdb", result: { dvdId: "x", extra: { downloadLinks: [], newFutureField: 1 } } });
  assert.equal(parsed.result.extra.newFutureField, 1); // forward-compat: not stripped
});

test("fmtMovie renders missav m3u8 streams", () => {
  const out = fmtMovie({
    q: "EBOD-391",
    source: "missav",
    result: {
      dvdId: "EBOD-391",
      extra: { pageUrl: "https://missav.ws/en/ebod-391", streams: { master: "https://surrit.com/x/playlist.m3u8", variants: ["https://surrit.com/x/720/video.m3u8"] } },
    },
  });
  assert.match(out, /Streams \(missav\)/);
  assert.match(out, /master: https:\/\/surrit\.com\/x\/playlist\.m3u8/);
  assert.match(out, /720\/video\.m3u8/);
});
