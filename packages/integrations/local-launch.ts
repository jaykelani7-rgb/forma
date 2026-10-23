import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

export type CompanionLaunchErrorCode = "unsupported" | "not-installed" | "invalid-target" | "startup-failed" | "timeout" | "cancelled" | "pairing-changed";
export class CompanionLaunchError extends Error {
  constructor(readonly code: CompanionLaunchErrorCode, message: string, options?: ErrorOptions) { super(message, options); this.name = "CompanionLaunchError"; }
}
/** Only an actual socket error qualifies; text mentioning ENOENT is not sufficient. */
export function isCompanionUnavailable(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "ENOENT" || code === "ECONNREFUSED";
}
export type LaunchTarget = { kind: "app" | "executable"; path: string };
export type LaunchFiles = {
  realpath(file: string): Promise<string>;
  stat(file: string): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  executable(file: string): Promise<void>;
  bundleIdentifier(file: string): Promise<string>;
};
const nativeFiles: LaunchFiles = {
  realpath, stat: lstat, executable: file => access(file, constants.X_OK),
  bundleIdentifier: file => new Promise((resolve, reject) => {
    execFile("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", file], { timeout: 3000, maxBuffer: 4096, encoding: "utf8", shell: false }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }),
};
/** Callers pass ONLY inspect().globalValue from the machine-scoped VS Code setting. */
export function userDevelopmentLaunchPath(setting: { globalValue?: unknown } | undefined): string | undefined {
  if (setting?.globalValue === undefined || setting.globalValue === "") return undefined;
  if (typeof setting.globalValue !== "string") throw new CompanionLaunchError("invalid-target", "The user setting formaCompanion.developmentLaunchPath must contain an absolute app or executable path.");
  return setting.globalValue;
}
function absoluteTarget(value: string): string {
  if (!path.posix.isAbsolute(value) || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value) || value === "/" || path.posix.normalize(value) !== value)
    throw new CompanionLaunchError("invalid-target", "Use a normalized absolute path in your user setting formaCompanion.developmentLaunchPath. Paths, arguments and shell commands from a workspace are never used.");
  return value;
}
const inside = (file: string, directory: string) => { const relative = path.relative(directory, file); return !!relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative); };
export async function resolveCompanionLaunch(options: { platform?: NodeJS.Platform; home?: string; developmentPath?: string; files?: LaunchFiles } = {}): Promise<LaunchTarget> {
  if ((options.platform ?? process.platform) !== "darwin") throw new CompanionLaunchError("unsupported", "Automatic Fenn launch currently supports macOS. Start Forma Companion manually on this platform, then retry.");
  const files = options.files ?? nativeFiles;
  const configured = options.developmentPath;
  const candidates = configured ? [absoluteTarget(configured)] : ["/Applications/Forma Companion.app", path.join(options.home ?? homedir(), "Applications", "Forma Companion.app")];
  for (const candidate of candidates) {
    let found = false;
    try {
      const at = await files.stat(candidate);
      found = true;
      if (at.isSymbolicLink()) throw new CompanionLaunchError("invalid-target", "The launch target must be an actual app or executable, not a symbolic link.");
      const canonical = await files.realpath(candidate);
      if (canonical !== candidate) throw new CompanionLaunchError("invalid-target", "The launch target or one of its parent folders is a symbolic link. Choose its real absolute path in your user settings.");
      if (candidate.endsWith(".app") && at.isDirectory()) {
        const executable = path.join(canonical, "Contents", "MacOS", "Forma Companion");
        // Installed bundles have a fixed identity and executable. A deliberately configured
        // development app also uses this repository's packaged product, not Electron.app.
        if (await files.bundleIdentifier(path.join(canonical, "Contents", "Info.plist")) !== "app.forma.companion") throw new CompanionLaunchError("invalid-target", "This app is not a Forma Companion bundle. Build Forma with companion:package or choose the installed Forma Companion.app.");
        const actualExecutable = await files.realpath(executable);
        if (!inside(actualExecutable, canonical) || !(await files.stat(actualExecutable)).isFile()) throw new CompanionLaunchError("invalid-target", "The Forma app has an invalid executable. Rebuild or reinstall it.");
        await files.executable(actualExecutable);
        return { kind: "app", path: canonical };
      }
      if (configured && at.isFile()) { await files.executable(canonical); return { kind: "executable", path: canonical }; }
      throw new CompanionLaunchError("invalid-target", "The launch target must be a Forma Companion.app or a directly executable development launcher.");
    } catch (error) {
      if (!configured && !found && error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      if (error instanceof CompanionLaunchError) throw error;
      throw new CompanionLaunchError("invalid-target", "Fenn's launch target cannot be read or executed. Check its permissions, reinstall it, or correct the user setting formaCompanion.developmentLaunchPath.", { cause: error });
    }
  }
  throw new CompanionLaunchError("not-installed", "Forma Companion is not installed in /Applications or ~/Applications. Build with npm run companion:package and install the app, or set formaCompanion.developmentLaunchPath in VS Code User Settings to a trusted development app or executable.");
}
export async function launchCompanion(target: LaunchTarget, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw cancelled();
  if (process.platform !== "darwin") throw new CompanionLaunchError("unsupported", "Automatic Fenn launch currently supports macOS.");
  await new Promise<void>((resolve, reject) => {
    const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(target.kind === "app" ? "/usr/bin/open" : target.path, target.kind === "app" ? ["-a", target.path] : [], { shell: false, stdio: "ignore", detached: target.kind === "executable", env: environment });
    child.once("error", error => reject(new CompanionLaunchError("startup-failed", "Fenn could not start. Open the app manually to inspect the startup error, then retry.", { cause: error })));
    if (target.kind === "app") child.once("exit", code => code === 0 ? resolve() : reject(new CompanionLaunchError("startup-failed", "macOS could not open Fenn. Open Forma Companion manually, then retry.")));
    else child.once("spawn", () => { child.unref(); resolve(); });
  });
}
const cancelled = () => new CompanionLaunchError("cancelled", "Opening Fenn was cancelled. Your pending action was not performed.");
const timeout = () => new CompanionLaunchError("timeout", "Fenn did not become ready within 20 seconds. Open Forma Companion manually to inspect its startup error, then retry. Your pairing was kept.");
function bounded<T>(work: () => Promise<T>, signal: AbortSignal, deadline: number, now: () => number): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled());
  const remaining = deadline - now(); if (remaining <= 0) return Promise.reject(timeout());
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(cancelled()); };
    const timer = setTimeout(() => { cleanup(); reject(timeout()); }, remaining);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    signal.addEventListener("abort", abort, { once: true });
    // Dispatch only after checking the lease again. A caller can cancel between
    // creating the boundary and this microtask, and no rejected socket promise
    // should be orphaned when the deadline has already expired.
    Promise.resolve().then(() => {
      if (signal.aborted) throw cancelled();
      if (deadline <= now()) throw timeout();
      return work();
    }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export class CompanionLauncher {
  private starting?: { credential: string; controller: AbortController; promise: Promise<void>; listeners: Set<(message: string) => void>; waiters: number };
  constructor(private readonly options: {
    connect(credential: string, signal: AbortSignal): Promise<void>;
    resolve(): Promise<LaunchTarget>;
    launch(target: LaunchTarget, signal: AbortSignal): Promise<void>;
    deadlineMs?: number;
    retryMs?: number;
    now?: () => number;
  }) {}
  async ready(credential: string, signal: AbortSignal, progress: (message: string) => void = () => {}): Promise<void> {
    const now = this.options.now ?? Date.now;
    const deadline = now() + (this.options.deadlineMs ?? 20000);
    progress("Connecting to Fenn…");
    try { await bounded(() => this.options.connect(credential, signal), signal, deadline, now); return; }
    catch (error) { if (!isCompanionUnavailable(error)) throw error; }
    if (signal.aborted) throw cancelled();
    if (this.starting && this.starting.credential !== credential) throw new CompanionLaunchError("pairing-changed", "Pairing changed while Fenn was starting. Retry with the current pairing; no new credential was created.");
    if (!this.starting) {
      const controller = new AbortController(), listeners = new Set<(message: string) => void>();
      const starting = { credential, controller, listeners, waiters: 0, promise: Promise.resolve() };
      this.starting = starting;
      starting.promise = (async () => {
        const report = (message: string) => { for (const listener of listeners) listener(message); };
        report("Locating Forma Companion…");
        const target = await bounded(() => this.options.resolve(), controller.signal, deadline, now);
        if (controller.signal.aborted) throw cancelled();
        report("Starting Fenn…");
        await bounded(() => this.options.launch(target, controller.signal), controller.signal, deadline, now);
        report("Waiting for Fenn to be ready…");
        for (;;) {
          if (controller.signal.aborted) throw cancelled();
          try { await bounded(() => this.options.connect(credential, controller.signal), controller.signal, deadline, now); return; }
          catch (error) { if (!isCompanionUnavailable(error)) throw error; }
          await bounded(() => new Promise<void>(resolve => setTimeout(resolve, this.options.retryMs ?? 200)), controller.signal, deadline, now);
        }
      })().finally(() => { controller.abort(); if (this.starting === starting) this.starting = undefined; });
      // A cancelled caller must not leave an unobserved shared startup rejection.
      void starting.promise.catch(() => {});
    }
    const starting = this.starting;
    starting.waiters++; starting.listeners.add(progress);
    progress("Waiting for Fenn to be ready…");
    try { await bounded(() => starting.promise, signal, deadline, now); }
    finally { starting.listeners.delete(progress); if (--starting.waiters === 0) starting.controller.abort(); }
  }
  cancel() { this.starting?.controller.abort(); }
}

/** Recheck the frozen file/problem/permission fence after asynchronous startup. */
export async function afterCompanionReady<T>(options: { ready(): Promise<void>; current(): boolean | Promise<boolean>; run(): Promise<T> }): Promise<T> {
  await options.ready();
  if (!await options.current()) throw new Error("The editor, problem, pairing, or folder permission changed while Fenn was opening. Choose the intended file and invoke Forma again; the old action was not performed.");
  return options.run();
}
