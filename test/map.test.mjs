import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMap, writeMap, loadUrls, parseList, pathOf, matchPaths } from "../dist/index.js";

const oldUrls = [
  "https://old.example/",
  "https://old.example/about-us.html",
  "https://old.example/blog/2021/05/how-to-plan-a-migration/",
  "https://old.example/services/web-design/",
  "https://old.example/services/retired-thing/",
  "https://old.example/team",
];
const newUrls = [
  "https://www.new.example/",
  "https://www.new.example/about/",
  "https://www.new.example/blog/how-to-plan-a-migration/",
  "https://www.new.example/services/",
  "https://www.new.example/services/website-design/",
  "https://www.new.example/team/",
];

test("matches by same path, slug, similar words and parent section", () => {
  const rows = matchPaths(oldUrls.map(pathOf), newUrls.map(pathOf));
  const to = Object.fromEntries(rows.map((r) => [r.from, [r.to, r.match]]));
  assert.deepEqual(to["/team"], ["/team/", "same"]);
  assert.deepEqual(to["/blog/2021/05/how-to-plan-a-migration/"], ["/blog/how-to-plan-a-migration/", "slug"]);
  assert.deepEqual(to["/services/web-design/"], ["/services/website-design/", "similar"]);
  assert.deepEqual(to["/services/retired-thing/"], ["/services/", "parent"]);
});

test("unchanged addresses need no redirect, and origins come from the lists", () => {
  const result = buildMap(oldUrls, newUrls);
  assert.equal(result.oldOrigin, "https://old.example");
  assert.equal(result.newOrigin, "https://www.new.example");
  assert.ok(result.rows.every((r) => r.from !== "/" || r.to !== "/"));
});

test("chains are resolved to their end and loops are flagged", async () => {
  const { checkRows } = await import("../dist/index.js");
  const rows = checkRows(
    [
      { from: "/a", to: "/b", match: "manual", score: 1 },
      { from: "/b", to: "/c", match: "manual", score: 1 },
      { from: "/x", to: "/y", match: "manual", score: 1 },
      { from: "/y", to: "/x", match: "manual", score: 1 },
    ],
    ["/c"],
  );
  const a = rows.find((r) => r.from === "/a");
  assert.equal(a.to, "/c");
  assert.ok(a.problems.includes("chain"));
  assert.ok(rows.find((r) => r.from === "/x").problems.includes("loop"));
});

test("writes Netlify, Nginx, Apache and Vercel formats with the right status", () => {
  const result = buildMap(["https://a.example/old-page/"], ["https://a.example/new-page/", "https://a.example/"], { threshold: 0.1 });
  assert.match(writeMap(result, "netlify", 301), /^\/old-page\/ \/new-page\/ 301$/m);
  assert.match(writeMap(result, "nginx", 308), /location = \/old-page\/ \{ return 308 \/new-page\/; \}/);
  assert.match(writeMap(result, "apache"), /RedirectMatch 301 \^\/old-page\/\?\$ \/new-page\//);
  const vercel = JSON.parse(writeMap(result, "vercel", 308));
  assert.deepEqual(vercel.redirects[0], { source: "/old-page/", destination: "/new-page/", permanent: true });
});

test("a domain change makes targets absolute", () => {
  const result = buildMap(["https://old.example/pricing"], ["https://new.example/pricing/"]);
  assert.match(writeMap(result, "netlify"), /^\/pricing https:\/\/new\.example\/pricing\/ 301$/m);
});

test("reads sitemaps and CSV crawl exports", async () => {
  assert.deepEqual(parseList("<urlset><url><loc>https://a.example/x?y=1&amp;z=2</loc></url></urlset>"), ["https://a.example/x?y=1&z=2"]);
  const dir = await mkdtemp(join(tmpdir(), "rmg-"));
  const csv = join(dir, "crawl.csv");
  await writeFile(csv, "Address,Status\nhttps://a.example/one,200\n/two,301\n");
  assert.deepEqual(await loadUrls(csv), ["https://a.example/one", "/two"]);
});
