import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/catalogue/route";
import {
  catalogueCache,
  createCatalogueCache,
  CATALOGUE_TTL_MS,
  CATALOGUE_RETRY_MS,
} from "../src/lib/catalogue";
import { CodeforcesError } from "../src/lib/codeforces-api";

const upstream = {
  problems: [
    {
      contestId: 1,
      index: "A",
      name: "Public route fixture",
      type: "PROGRAMMING",
      rating: 1000,
      tags: ["implementation"],
    },
  ],
  problemStatistics: [],
};
const request = () => new Request("http://localhost/api/catalogue");

// Exercise the exported production GET handler with its real catalogue cache.
// Only the upstream loader and clock are substituted, so these checks include
// route validation, parser, single-flight, TTL/backoff and response headers.
async function withCache(
  cache: ReturnType<typeof createCatalogueCache>,
  run: () => Promise<void>,
) {
  const original = catalogueCache.get;
  catalogueCache.get = cache.get;
  try {
    await run();
  } finally {
    catalogueCache.get = original;
  }
}

test("the actual catalogue GET returns parsed public data and serves its fresh cache", async () => {
  let calls = 0;
  let clock = Date.parse("2026-10-07T00:00:00Z");
  const cache = createCatalogueCache({
    now: () => clock,
    load: async () => {
      calls++;
      return upstream;
    },
  });
  await withCache(cache, async () => {
    const first = await GET(request());
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "public, max-age=3600");
    assert.equal(first.headers.get("x-content-type-options"), "nosniff");
    const body = await first.json();
    assert.equal(body.stale, false);
    assert.equal(body.problems[0].key, "contest:1:A");
    assert.equal(
      body.problems[0].url,
      "https://codeforces.com/problemset/problem/1/A",
    );
    clock += CATALOGUE_TTL_MS - 1;
    const cached = await GET(request());
    assert.deepEqual(await cached.json(), body);
    assert.equal(calls, 1);
  });
});

test("simultaneous actual catalogue requests share one upstream fetch", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = createCatalogueCache({
    load: async () => {
      calls++;
      await gate;
      return upstream;
    },
  });
  await withCache(cache, async () => {
    const first = GET(request());
    const second = GET(request());
    assert.equal(calls, 1);
    release();
    const responses = await Promise.all([first, second]);
    assert.equal(responses[0].status, 200);
    assert.deepEqual(await responses[0].json(), await responses[1].json());
    assert.equal(calls, 1);
  });
});

test("the actual catalogue route marks stale fallback and respects failure backoff", async () => {
  let calls = 0;
  let clock = Date.parse("2026-10-07T00:00:00Z");
  const cache = createCatalogueCache({
    now: () => clock,
    load: async () => {
      calls++;
      if (calls === 2)
        throw new CodeforcesError("Upstream offline", "temporary");
      return upstream;
    },
  });
  await withCache(cache, async () => {
    const original = await (await GET(request())).json();
    clock += CATALOGUE_TTL_MS;
    const fallback = await GET(request());
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get("cache-control"), "public, max-age=60");
    const stale = await fallback.json();
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, original.fetchedAt);
    assert.deepEqual(stale.problems, original.problems);
    clock += CATALOGUE_RETRY_MS - 1;
    assert.equal((await (await GET(request())).json()).stale, true);
    assert.equal(calls, 2);
    clock++;
    const refreshed = await (await GET(request())).json();
    assert.equal(refreshed.stale, false);
    assert.notEqual(refreshed.fetchedAt, original.fetchedAt);
    assert.equal(calls, 3);
  });
});

test("the actual catalogue route returns a safe uncached error when no fallback exists", async () => {
  for (const failure of [
    new CodeforcesError("Upstream rate-limit internals", "temporary", 429),
    new Error("Untrusted raw network diagnostic"),
  ]) {
    let calls = 0;
    const cache = createCatalogueCache({
      load: async () => {
        calls++;
        throw failure;
      },
    });
    await withCache(cache, async () => {
      const response = await GET(request());
      assert.equal(
        response.status,
        failure instanceof CodeforcesError ? 429 : 503,
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error:
          "Fresh discovery is unavailable right now. Your saved problems and revisits are still available.",
      });
      await GET(request());
      assert.equal(calls, 1);
    });
  }
});

test("the actual catalogue route rejects query parameters before touching the upstream", async () => {
  let calls = 0;
  await withCache(
    createCatalogueCache({
      load: async () => {
        calls++;
        return upstream;
      },
    }),
    async () => {
      const response = await GET(
        new Request("http://localhost/api/catalogue?handle=real_person"),
      );
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(calls, 0);
    },
  );
});
