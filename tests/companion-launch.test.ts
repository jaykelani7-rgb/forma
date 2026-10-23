import assert from "node:assert/strict";
import test from "node:test";
import { afterCompanionReady, CompanionLaunchError, CompanionLauncher, isCompanionUnavailable, resolveCompanionLaunch, userDevelopmentLaunchPath, type LaunchFiles, type LaunchTarget } from "../packages/integrations/local-launch";
import { createLoginStartup } from "../apps/desktop/main/login-startup";

const unavailable = () => Object.assign(new Error("missing endpoint"), { code: "ENOENT" });
const target: LaunchTarget = { kind: "app", path: "/Applications/Forma Companion.app" };
const defer = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const signal = () => new AbortController().signal;

test("a running paired companion connects before resolving or launching anything", async () => {
  const credentials: string[] = [];
  const launcher = new CompanionLauncher({ connect: async credential => { credentials.push(credential); }, resolve: async () => { throw new Error("must not resolve"); }, launch: async () => { throw new Error("must not launch"); } });
  await launcher.ready("existing-pairing", signal());
  assert.deepEqual(credentials, ["existing-pairing"]);
});

test("missing/refused endpoints alone qualify for launch; permission, pairing, protocol and text never do", async () => {
  for (const error of [new Error("Pair this extension with Forma Companion again."), new Error("Invalid integration acknowledgement."), Object.assign(new Error("permission"), { code: "EACCES" }), Object.assign(new Error("unresponsive"), { code: "ETIMEDOUT" }), new Error("ENOENT in a server reply")]) {
    let launches = 0;
    const launcher = new CompanionLauncher({ connect: async () => { throw error; }, resolve: async () => target, launch: async () => { launches++; } });
    await assert.rejects(launcher.ready("same-token", signal()), reason => reason === error);
    assert.equal(launches, 0); assert.equal(isCompanionUnavailable(error), false);
  }
  assert.equal(isCompanionUnavailable({ code: "ECONNREFUSED" }), true);
  assert.equal(isCompanionUnavailable({ code: "ENOENT" }), true);
});

test("concurrent requests coalesce launch and retry the same pairing with bounded progress", async () => {
  const start = defer<void>(); let running = false, launches = 0, resolutions = 0;
  const credentials: string[] = [], messages: string[] = [];
  const launcher = new CompanionLauncher({ connect: async credential => { credentials.push(credential); if (!running) throw unavailable(); }, resolve: async () => { resolutions++; return target; }, launch: async () => { launches++; await start.promise; running = true; }, retryMs: 1 });
  const first = launcher.ready("kept-token", signal(), message => messages.push(message));
  const second = launcher.ready("kept-token", signal());
  await tick(); assert.equal(launches, 1); start.resolve();
  await Promise.all([first, second]);
  assert.equal(resolutions, 1); assert.ok(credentials.length >= 3); assert.ok(credentials.every(value => value === "kept-token"));
  assert.ok(messages.some(message => /ready/.test(message)));
});

test("startup pairing failure stops readiness without another launch or credential creation", async () => {
  let launched = false, launches = 0, attempts = 0;
  const pairing = new Error("Pair this extension with Forma Companion again.");
  const launcher = new CompanionLauncher({ connect: async credential => { assert.equal(credential, "stale-pairing"); attempts++; if (launched) throw pairing; throw unavailable(); }, resolve: async () => target, launch: async () => { launched = true; launches++; } });
  await assert.rejects(launcher.ready("stale-pairing", signal()), error => error === pairing);
  assert.equal(launches, 1); assert.equal(attempts, 2);
});

test("startup timeout and a stalled resolver have an absolute bounded deadline", async () => {
  let launches = 0, clock = 0;
  const launcher = new CompanionLauncher({ now: () => clock, connect: async () => { throw unavailable(); }, resolve: async () => target, launch: async () => { launches++; clock = 20000; }, deadlineMs: 20000, retryMs: 1 });
  await assert.rejects(launcher.ready("kept-token", signal()), error => error instanceof CompanionLaunchError && error.code === "timeout");
  assert.equal(launches, 1);
  const stalled = new CompanionLauncher({ connect: async () => { throw unavailable(); }, resolve: () => new Promise(() => {}), launch: async () => { launches++; }, deadlineMs: 15 });
  await assert.rejects(stalled.ready("kept-token", signal()), error => error instanceof CompanionLaunchError && error.code === "timeout");
  assert.equal(launches, 1);
});

test("expired deadlines and cancellation never dispatch late socket or launch work", async () => {
  let clock = 0, connections = 0, resolutions = 0, launches = 0;
  const launcher = new CompanionLauncher({ now: () => clock, deadlineMs: 10,
    connect: async () => { connections++; clock = 10; throw unavailable(); },
    resolve: async () => { resolutions++; return target; }, launch: async () => { launches++; },
  });
  await assert.rejects(launcher.ready("kept-token", signal()), error => error instanceof CompanionLaunchError && error.code === "timeout");
  await tick(); assert.equal(connections, 1); assert.equal(resolutions, 0); assert.equal(launches, 0);
  const controller = new AbortController();
  const cancelledLauncher = new CompanionLauncher({ connect: async () => { connections++; throw unavailable(); }, resolve: async () => { resolutions++; return target; }, launch: async () => { launches++; } });
  const waiting = cancelledLauncher.ready("kept-token", controller.signal); controller.abort();
  await assert.rejects(waiting, error => error instanceof CompanionLaunchError && error.code === "cancelled");
  await tick(); assert.equal(connections, 1); assert.equal(resolutions, 0); assert.equal(launches, 0);
});

test("a launch failure is actionable and not retried", async () => {
  let attempts = 0;
  const failure = new CompanionLaunchError("startup-failed", "Open Fenn manually to inspect startup.");
  const launcher = new CompanionLauncher({ connect: async () => { throw unavailable(); }, resolve: async () => target, launch: async () => { attempts++; throw failure; } });
  await assert.rejects(launcher.ready("kept-token", signal()), error => error === failure); assert.equal(attempts, 1);
});

test("cancellation detaches one waiter without cancelling another pending action", async () => {
  const started = defer<void>(); const firstController = new AbortController(); let running = false, launches = 0;
  const launcher = new CompanionLauncher({ connect: async () => { if (!running) throw unavailable(); }, resolve: async () => target, launch: async () => { launches++; await started.promise; running = true; } });
  const first = launcher.ready("kept-token", firstController.signal), second = launcher.ready("kept-token", signal());
  await tick(); firstController.abort();
  await assert.rejects(first, error => error instanceof CompanionLaunchError && error.code === "cancelled");
  started.resolve(); await second; assert.equal(launches, 1);
});

test("cancelling the final waiter fences a late resolver before OS launch", async () => {
  const resolution = defer<LaunchTarget>(), controller = new AbortController(); let launches = 0;
  const launcher = new CompanionLauncher({ connect: async () => { throw unavailable(); }, resolve: () => resolution.promise, launch: async () => { launches++; } });
  const waiting = launcher.ready("kept-token", controller.signal); await tick(); controller.abort();
  await assert.rejects(waiting, error => error instanceof CompanionLaunchError && error.code === "cancelled");
  resolution.resolve(target); await tick(); assert.equal(launches, 0);
});

test("a changed pairing cannot join an in-flight launch with a different credential", async () => {
  const started = defer<void>(); let running = false;
  const launcher = new CompanionLauncher({ connect: async () => { if (!running) throw unavailable(); }, resolve: async () => target, launch: async () => { await started.promise; running = true; } });
  const first = launcher.ready("old-token", signal()); await tick();
  await assert.rejects(launcher.ready("new-token", signal()), error => error instanceof CompanionLaunchError && error.code === "pairing-changed");
  started.resolve(); await first;
});

test("pending actions revalidate the frozen editor/problem/permission after startup", async () => {
  const ready = defer<void>(); let current = "file:A/problem:A", acted = 0;
  const frozen = current;
  const waiting = afterCompanionReady({ ready: () => ready.promise, current: () => current === frozen, run: async () => { acted++; } });
  current = "file:B/problem:B"; ready.resolve();
  await assert.rejects(waiting, /changed while Fenn was opening/); assert.equal(acted, 0);
  await afterCompanionReady({ ready: async () => {}, current: () => true, run: async () => { acted++; } }); assert.equal(acted, 1);
});

function files(options: { missing?: string[]; symlink?: boolean; escaped?: boolean; identifier?: string; directory?: boolean; executable?: boolean } = {}): LaunchFiles {
  return {
    stat: async file => { if (options.missing?.includes(file)) throw unavailable(); return { isSymbolicLink: () => options.symlink ?? false, isDirectory: () => options.directory ?? file.endsWith(".app"), isFile: () => !(options.directory ?? file.endsWith(".app")) }; },
    realpath: async file => options.escaped && file.endsWith("/MacOS/Forma Companion") ? "/outside/other" : file,
    executable: async () => { if (options.executable === false) throw Object.assign(new Error("not executable"), { code: "EACCES" }); },
    bundleIdentifier: async () => options.identifier ?? "app.forma.companion",
  };
}
test("installed app resolution is deterministic and supports only the actual macOS target", async () => {
  assert.deepEqual(await resolveCompanionLaunch({ platform: "darwin", home: "/Users/test", files: files() }), target);
  assert.deepEqual(await resolveCompanionLaunch({ platform: "darwin", home: "/Users/test", files: files({ missing: [target.path] }) }), { kind: "app", path: "/Users/test/Applications/Forma Companion.app" });
  await assert.rejects(resolveCompanionLaunch({ platform: "darwin", home: "/Users/test", files: files({ missing: [target.path, "/Users/test/Applications/Forma Companion.app"] }) }), error => error instanceof CompanionLaunchError && error.code === "not-installed");
  for (const platform of ["linux", "win32"] as const) await assert.rejects(resolveCompanionLaunch({ platform, files: files() }), error => error instanceof CompanionLaunchError && error.code === "unsupported");
});

test("development paths use only explicit user values, never workspace overrides or command parsing", async () => {
  const settings = { globalValue: "/trusted/Fenn", workspaceValue: "/workspace/untrusted", workspaceFolderValue: "/workspace/also-untrusted" };
  assert.equal(userDevelopmentLaunchPath(settings), "/trusted/Fenn");
  assert.equal(userDevelopmentLaunchPath({ globalValue: undefined }), undefined);
  assert.deepEqual(await resolveCompanionLaunch({ platform: "darwin", developmentPath: userDevelopmentLaunchPath(settings), files: files() }), { kind: "executable", path: "/trusted/Fenn" });
  // A semicolon is a literal filename character, not a shell separator.
  assert.deepEqual(await resolveCompanionLaunch({ platform: "darwin", developmentPath: "/trusted/fenn;touch surprise", files: files() }), { kind: "executable", path: "/trusted/fenn;touch surprise" });
  for (const value of ["relative/launcher", "/", "/trusted/../launcher", "/trusted/fenn\nmalicious"]) await assert.rejects(resolveCompanionLaunch({ platform: "darwin", developmentPath: value, files: files() }), error => error instanceof CompanionLaunchError && error.code === "invalid-target");
});

test("untrusted, incomplete and escaped app bundles fail closed without trying another target", async () => {
  for (const fixture of [files({ symlink: true }), files({ escaped: true }), files({ identifier: "other.app" }), files({ executable: false })]) await assert.rejects(resolveCompanionLaunch({ platform: "darwin", files: fixture }), error => error instanceof CompanionLaunchError && error.code === "invalid-target");
});

test("login startup reads actual OS state and never registers a login item by default", () => {
  let actual = false, changes = 0;
  const startup = createLoginStartup({ platform: "darwin", isPackaged: true, getLoginItemSettings: () => ({ openAtLogin: actual }), setLoginItemSettings: settings => { changes++; actual = settings.openAtLogin; } });
  assert.deepEqual(startup.read(), { supported: true, enabled: false, status: "ready" }); assert.equal(changes, 0);
  actual = true; assert.equal(startup.read().enabled, true); assert.equal(changes, 0);
  assert.equal(startup.set(false).enabled, false); assert.equal(changes, 1);
});

test("development and unsupported login settings are honest and do not call the OS", () => {
  for (const options of [{ platform: "darwin" as const, isPackaged: false }, { platform: "linux" as const, isPackaged: true }]) {
    const startup = createLoginStartup({ ...options, getLoginItemSettings: () => { throw new Error("must not read"); }, setLoginItemSettings: () => { throw new Error("must not mutate"); } });
    assert.equal(startup.read().supported, false); assert.equal(startup.read().status, "unavailable"); assert.throws(() => startup.set(true), /Development|packaged/);
  }
});

test("login approval and OS errors preserve actual state rather than claiming registration succeeded", () => {
  const startup = createLoginStartup({ platform: "darwin", isPackaged: true, getLoginItemSettings: () => ({ openAtLogin: false, status: "requires-approval" }), setLoginItemSettings: () => {} });
  assert.match(startup.read().detail!, /approval/); assert.equal(startup.set(true).enabled, false); assert.match(startup.set(true).detail!, /approval/);
  const unreadable = createLoginStartup({ platform: "darwin", isPackaged: true, getLoginItemSettings: () => { throw new Error("OS failure"); }, setLoginItemSettings: () => { throw new Error("must not set"); } });
  assert.equal(unreadable.read().status, "unavailable"); assert.throws(() => unreadable.set(true), /could not be read/);
});
