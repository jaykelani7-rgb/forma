import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import manifest from "../src/app/manifest";
import { emptyData, validateData } from "../src/lib/model";
import {
  defaultReminder,
  dismissInAppReminder,
  inAppReminderDue,
} from "../src/lib/reminders";

type FetchEvent = {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
};
type WorkerEvent = {
  waitUntil: (promise: Promise<unknown>) => void;
  data?: { type: string };
};
type Listener = (event: FetchEvent & WorkerEvent) => void;

function worker(offline = false) {
  const handlers = new Map<string, Listener>();
  const stored = new Map<string, Response>([
    ["/offline.html", new Response("offline fallback")],
  ]);
  const requested: Request[] = [];
  const deleted: string[] = [];
  let activated = 0;
  let claimed = 0;
  const context = {
    URL,
    Response,
    Request: class extends Request {
      constructor(input: string | Request, init?: RequestInit) {
        super(
          typeof input === "string"
            ? new URL(input, "https://forma.test").href
            : input,
          init,
        );
      }
    },
    self: {
      location: { origin: "https://forma.test" },
      addEventListener: (name: string, callback: Listener) =>
        handlers.set(name, callback),
      skipWaiting: () => {
        activated++;
      },
      clients: {
        claim: async () => {
          claimed++;
        },
      },
    },
    caches: {
      open: async () => ({
        addAll: async (requests: Request[]) => {
          requested.push(...requests);
        },
      }),
      match: async (key: string) => stored.get(key)?.clone(),
      keys: async () => ["forma-public-v0", "forma-public-v1", "another-app"],
      delete: async (key: string) => {
        deleted.push(key);
      },
    },
    fetch: async () => {
      if (offline) throw new Error("offline");
      return new Response("network response");
    },
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), context);
  async function lifecycle(name: string, data?: WorkerEvent["data"]) {
    let completion: Promise<unknown> = Promise.resolve();
    handlers.get(name)!({
      data,
      waitUntil: (promise) => {
        completion = promise;
      },
    } as FetchEvent & WorkerEvent);
    await completion;
  }
  async function fetchEvent(
    path: string,
    options: { method?: string; mode?: string; authorization?: boolean } = {},
  ): Promise<Response | null> {
    let response: Promise<Response> | null = null;
    const request = {
      url: new URL(path, "https://forma.test").href,
      method: options.method ?? "GET",
      mode: options.mode ?? "cors",
      headers: new Headers(
        options.authorization ? { Authorization: "Bearer test-fixture" } : {},
      ),
    } as Request;
    handlers.get("fetch")!({
      request,
      respondWith: (promise) => {
        response = promise;
      },
    } as FetchEvent & WorkerEvent);
    return response ? await response : null;
  }
  return {
    lifecycle,
    fetchEvent,
    requested,
    deleted,
    activated: () => activated,
    claimed: () => claimed,
  };
}

test("the install manifest supplies usable standalone PNG icons including a maskable icon", () => {
  const result = manifest();
  assert.equal(result.display, "standalone");
  assert.equal(result.scope, "/");
  assert.equal(result.start_url, "/");
  assert.ok(result.icons?.some((icon) => icon.purpose === "maskable"));
  for (const icon of result.icons ?? []) {
    const png = readFileSync(`public${icon.src}`);
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    const size = Number(icon.sizes!.split("x")[0]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test("worker installation only caches public resources without credentials and waits for deliberate activation", async () => {
  const serviceWorker = worker();
  await serviceWorker.lifecycle("install");
  assert.ok(serviceWorker.requested.length > 3);
  assert.ok(
    serviceWorker.requested.every((request) => request.credentials === "omit"),
  );
  assert.ok(
    serviceWorker.requested.every((request) => {
      const path = new URL(request.url).pathname;
      return (
        path === "/offline.html" ||
        path.startsWith("/icons/") ||
        path.startsWith("/fonts/")
      );
    }),
  );
  assert.equal(serviceWorker.activated(), 0);
  await serviceWorker.lifecycle("message", { type: "UNKNOWN" });
  assert.equal(serviceWorker.activated(), 0);
  await serviceWorker.lifecycle("message", { type: "ACTIVATE_UPDATE" });
  assert.equal(serviceWorker.activated(), 1);
  await serviceWorker.lifecycle("activate");
  assert.deepEqual(serviceWorker.deleted, ["forma-public-v0"]);
  assert.equal(serviceWorker.claimed(), 1);
});

test("offline navigation receives a deliberate fallback while account APIs, credentials and mutations bypass the shared cache", async () => {
  const serviceWorker = worker(true);
  assert.equal(
    await (
      await serviceWorker.fetchEvent("/problems", { mode: "navigate" })
    )?.text(),
    "offline fallback",
  );
  assert.equal(
    await serviceWorker.fetchEvent("/api/workspace", { mode: "navigate" }),
    null,
  );
  assert.equal(
    await serviceWorker.fetchEvent("/api/codeforces?action=activity"),
    null,
  );
  assert.equal(
    await serviceWorker.fetchEvent("/api/account", { method: "POST" }),
    null,
  );
  assert.equal(
    await serviceWorker.fetchEvent("/problems", { authorization: true }),
    null,
  );
  assert.equal(
    await serviceWorker.fetchEvent("https://another.test/app.js"),
    null,
  );
  assert.equal(await serviceWorker.fetchEvent("/_next/static/app.js"), null);
  assert.equal(
    await serviceWorker.fetchEvent("/icons/forma-192.png?user=one"),
    null,
  );
});

test("in-app reminders are opt-in, follow local time, and stay quiet after dismissal or recorded practice", () => {
  const now = new Date(2026, 9, 4, 18, 15);
  const data = emptyData();
  assert.equal(inAppReminderDue(data, now), false);
  data.settings.reminder = { ...defaultReminder(), enabled: true };
  assert.equal(inAppReminderDue(data, new Date(2026, 9, 4, 17, 59)), false);
  assert.equal(inAppReminderDue(data, now), true);
  const dismissed = dismissInAppReminder(data, now);
  assert.equal(inAppReminderDue(dismissed, now), false);
  assert.equal(inAppReminderDue(dismissed, new Date(2026, 9, 5, 18, 15)), true);
  assert.equal(
    inAppReminderDue(
      { ...data, session: { id: "session" } } as typeof data,
      now,
    ),
    false,
  );
  const practiced = {
    ...data,
    attempts: [{ completedAt: now.toISOString() }],
  } as typeof data;
  assert.equal(inAppReminderDue(practiced, now), false);
  assert.deepEqual(validateData(dismissed), dismissed);
  assert.throws(
    () =>
      validateData({
        ...data,
        settings: {
          ...data.settings,
          reminder: { enabled: true, time: "27:00", dismissedOn: null },
        },
      }),
    /reminder/,
  );
  const previous = {
    ...data,
    settings: { ...data.settings, reminder: undefined },
  };
  assert.deepEqual(validateData(previous).settings.reminder, defaultReminder());
});
