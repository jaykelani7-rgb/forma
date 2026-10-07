"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import {
  Data,
  Duration,
  Problem,
  Session,
  Theme,
  createDemo,
  elapsed,
  emptyData,
  localDate,
  uid,
  validateData,
} from "@/lib/model";
import {
  beginVisit,
  ensureDailyReflectionBatch,
  connectProfile,
  connectedProfile,
  disconnectProfile,
  mergeActivity,
  mergeProfileMetadata,
  withCodeforcesDemo,
} from "@/lib/codeforces";
import { PublicProfile, handleKey, validHandle } from "@/lib/codeforces-types";
import {
  SyncState,
  collectProfileActivity,
  idleSync,
  previewPublicProfile,
} from "@/lib/codeforces-client";
import {
  getBrowserAuth,
  readCloudAccount,
  CloudAccount,
} from "@/lib/cloud-client";
import {
  synchronizeAccount,
  accountTransport,
  SyncCheckpoint,
} from "@/lib/cloud-sync";
import { encodeBackup } from "@/lib/concurrency";
import {
  reconcileWorkspaceDay,
  nextDailyCheckDelay,
} from "@/lib/daily-workspace";
import { withPracticeSession } from "@/lib/practice-session";
import type { TrackContext } from "@/lib/tracks-types";
import {
  operationIsCurrent,
  readSettledWorkspace,
  UnsavedWorkspaceError,
} from "@/lib/workspace-lifecycle";
import { CodeforcesError } from "@/lib/codeforces-api";
import {
  Mode,
  WorkspaceKey,
  WorkspaceRevision,
  STORAGE_KEYS,
  loadWorkspace,
  commitWorkspace,
  syncMetadata,
} from "@/lib/storage";

interface Workspace {
  data: Data;
  ready: boolean;
  mode: Mode;
  theme: Theme;
  resolvedTheme: "light" | "dark";
  storageError: string | null;
  storagePending: boolean;
  workspaceKey: WorkspaceKey;
  update: (fn: (data: Data) => Data) => Promise<boolean>;
  retryLocalSave: (fn?: (data: Data) => Data) => Promise<boolean>;
  setTheme: (theme: Theme) => void;
  setMode: (mode: Mode) => void;
  notify: (message: string) => void;
  startSession: (
    problem: Problem,
    duration?: Duration,
    context?: TrackContext,
  ) => Promise<boolean>;
  startFreshSession: (
    problem: Problem,
    duration?: Duration,
    context?: TrackContext,
  ) => Promise<boolean>;
  guardWorkspace: () => () => boolean;
  localDay: string;
  replaceData: (data: Data) => Promise<boolean>;
  sync: SyncState;
  previewHandle: (handle: string) => Promise<PublicProfile | null>;
  connectHandle: (profile: PublicProfile) => Promise<boolean>;
  syncActivity: (older?: boolean) => Promise<void>;
  disconnectHandle: () => Promise<boolean>;
  account: CloudAccount | null;
  cloudStatus:
    | "local"
    | "pending"
    | "synced"
    | "offline"
    | "failed"
    | "syncing";
  cloudError: string | null;
  openAccount: () => Promise<void>;
  logoutAccount: () => Promise<void>;
  syncAccount: () => Promise<void>;
  migratePersonal: () => Promise<void>;
  addOpen: boolean;
  setAddOpen: (value: boolean) => void;
}
const Context = createContext<Workspace | null>(null);
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace provider is missing.");
  return value;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<{
    data: Data;
    mode: Mode;
    ready: boolean;
  }>({ data: emptyData(), mode: "personal", ready: false });
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [cloudStatus, setCloudStatus] =
    useState<Workspace["cloudStatus"]>("local");
  const [cloudError, setCloudError] = useState<string | null>(null);
  const cloudLock = useRef(false);
  const cloudAbort = useRef<AbortController | null>(null);
  const cloudVersion = useRef(0);
  const [theme, setThemeState] = useState<Theme>("light");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [storageError, setStorageError] = useState<string | null>(null);
  const persistBlocked = useRef(false);
  const volatile = useRef(
    new Map<WorkspaceKey, { data: Data; error: string }>(),
  );
  const activationVersion = useRef(0);
  const record = useRef<WorkspaceRevision | null>(null);
  const current = useRef(bundle);
  const queue = useRef(Promise.resolve());
  const pendingWrites = useRef(0);
  const editVersion = useRef(0);
  const [storagePending, setStoragePending] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const [workspaceKey, setWorkspaceKey] = useState<WorkspaceKey>("personal");
  const [localDay, setLocalDay] = useState("");
  useEffect(() => {
    document.documentElement.dataset.textSize =
      bundle.data.settings.textSize ?? "comfortable";
  }, [bundle.data.settings.textSize]);
  const practiceLock = useRef(false);
  const keyRef = useRef<WorkspaceKey>("personal");
  function captureOperation() {
    return {
      key: keyRef.current,
      generation: cloudVersion.current,
      activation: activationVersion.current,
    };
  }
  function operationState() {
    return {
      ...captureOperation(),
      blocked: persistBlocked.current,
      saving: pendingWrites.current > 0,
      editVersion: editVersion.current,
    };
  }
  function guardWorkspace() {
    const expected = captureOperation();
    return () =>
      current.current.ready && operationIsCurrent(expected, captureOperation());
  }
  async function reconcileCurrentDay(now = new Date()) {
    setLocalDay(localDate(now));
    if (!current.current.ready || persistBlocked.current) return;
    const next = reconcileWorkspaceDay(current.current.data, now);
    if (next !== current.current.data) await persist(next);
  }
  function invalidateCloud() {
    cloudVersion.current++;
    cloudAbort.current?.abort();
    cloudAbort.current = null;
    cloudLock.current = false;
  }
  function showBundle(value: typeof bundle) {
    current.current = value;
    setBundle(value);
  }
  function persist(proposed: Data, replace = false, baseline?: Data) {
    const isCurrent = guardWorkspace();
    editVersion.current++;
    const base = record.current;
    const key = keyRef.current;
    const mode = current.current.mode;
    const before = baseline ?? current.current.data;
    showBundle({ ...current.current, data: proposed });
    if (key.startsWith("account:"))
      setCloudStatus(navigator.onLine ? "pending" : "offline");
    if (!base || persistBlocked.current) return Promise.resolve(false);
    pendingWrites.current++;
    setStoragePending(true);
    const write = queue.current.then(async () => {
      try {
        if (persistBlocked.current && keyRef.current === key) return false;
        const result = await commitWorkspace(
          key,
          { ...base, data: before },
          proposed,
          replace,
        );
        if (keyRef.current !== key) return false;
        record.current = result.record;
        if (result.conflicts.length) {
          setStorageError(
            "Another tab changed the same records. The newer workspace is kept; your proposed changes are saved as a recovery copy in Settings. Review both before restoring.",
          );
        }
        if (pendingWrites.current === 1 && isCurrent())
          showBundle({ data: result.record.data, mode, ready: true });
        channel.current?.postMessage({ key, revision: result.record.revision });
        return result.conflicts.length === 0 && isCurrent();
      } catch {
        if (keyRef.current === key) {
          persistBlocked.current = true;
          setStorageError(
            "Storage is unavailable, full, or beyond the 64 MB capacity. Unsaved changes remain in this tab; export them before closing it. Original saved records are preserved.",
          );
        }
        return false;
      } finally {
        pendingWrites.current--;
        setStoragePending(pendingWrites.current > 0);
      }
    });
    queue.current = write.then(() => undefined);
    return write;
  }
  const [toast, setToast] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>(idleSync);
  const syncLock = useRef(false);
  const operationVersion = useRef(0);
  const syncAbort = useRef<AbortController | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const retryLock = useRef(false);
  async function retryLocalSave(fn?: (data: Data) => Data) {
    if (retryLock.current || !current.current.ready) return false;
    const isCurrent = guardWorkspace();
    retryLock.current = true;
    try {
      await queue.current;
      if (!isCurrent() || !record.current) return false;
      const proposed = fn ? fn(current.current.data) : current.current.data;
      if (!persistBlocked.current) return await update(() => proposed);
      // Retry the entire unsaved proposal against its last durable revision.
      // Normal CAS merging still rejects conflicts and retains recovery copies.
      const baseline = record.current.data;
      persistBlocked.current = false;
      setStorageError(null);
      const saved = await persist(proposed, false, baseline);
      if (saved && isCurrent()) {
        volatile.current.delete(keyRef.current);
        if (keyRef.current.startsWith("account:")) setCloudError(null);
      }
      return saved && isCurrent();
    } finally {
      retryLock.current = false;
    }
  }
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const check = () => {
      if (disposed) return;
      const now = new Date();
      void reconcileCurrentDay(now);
      clearTimeout(timer);
      timer = setTimeout(check, nextDailyCheckDelay(now));
    };
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
    };
    // Live refs keep calendar checks scoped to the active workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let cancelled = false;
    let mode: Mode = "personal";
    try {
      mode =
        localStorage.getItem(STORAGE_KEYS.mode) === "demo"
          ? "demo"
          : "personal";
      const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
      if (["light", "dark", "system"].includes(savedTheme ?? ""))
        setThemeState(savedTheme as Theme);
    } catch {
      /* migration below reports unavailable storage */
    }
    keyRef.current = mode;
    setWorkspaceKey(mode);
    loadWorkspace(
      mode,
      mode === "demo" ? withCodeforcesDemo(createDemo()) : emptyData(),
    )
      .then(async (saved) => {
        if (cancelled) return;
        record.current = saved;
        showBundle({ data: saved.data, mode, ready: true });
        const visited = beginVisit(
          mode === "demo" ? withCodeforcesDemo(saved.data) : saved.data,
        );
        if (JSON.stringify(visited) !== JSON.stringify(saved.data))
          await persist(visited);
        await reconcileCurrentDay();
      })
      .catch(() => {
        if (cancelled) return;
        persistBlocked.current = true;
        setStorageError(
          "Saved records could not be migrated or read. Original storage is preserved. New changes stay in this tab; export a backup before closing it.",
        );
        let recovered =
          mode === "demo" ? withCodeforcesDemo(createDemo()) : emptyData();
        try {
          const raw = localStorage.getItem(STORAGE_KEYS[mode]);
          if (raw) recovered = validateData(JSON.parse(raw));
        } catch {
          /* preserve malformed source */
        }
        showBundle({ data: recovered, mode, ready: true });
      });
    return () => {
      cancelled = true;
    };
    // The initial migration runs once; later switches use activateWorkspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const updates = new BroadcastChannel("forma-revisions");
    channel.current = updates;
    async function refresh() {
      if (
        !current.current.ready ||
        pendingWrites.current ||
        persistBlocked.current
      )
        return;
      const key = keyRef.current;
      const operation = captureOperation();
      try {
        const latest = await loadWorkspace(key);
        if (
          !operationIsCurrent(operation, captureOperation()) ||
          persistBlocked.current ||
          pendingWrites.current ||
          latest.revision === record.current?.revision
        )
          return;
        record.current = latest;
        showBundle({ ...current.current, data: latest.data });
        await reconcileCurrentDay();
      } catch {
        /* keep the readable copy */
      }
    }
    updates.onmessage = refresh;
    window.addEventListener("focus", refresh);
    return () => {
      updates.close();
      window.removeEventListener("focus", refresh);
    };
    // Refs let other tabs refresh the latest active workspace without stale closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (
        pendingWrites.current ||
        persistBlocked.current ||
        volatile.current.size
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      setResolvedTheme(resolved);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  function update(fn: (data: Data) => Data) {
    return persist(fn(current.current.data));
  }
  function setTheme(value: Theme) {
    setThemeState(value);
    try {
      localStorage.setItem(STORAGE_KEYS.theme, value);
    } catch {
      notify(
        "Theme changed for this tab. Your browser could not save the preference.",
      );
    }
  }
  async function activateWorkspace(key: WorkspaceKey, mode: Mode) {
    operationVersion.current++;
    invalidateCloud();
    syncAbort.current?.abort();
    syncLock.current = false;
    setSync(idleSync);
    const activation = ++activationVersion.current;
    showBundle({ ...current.current, ready: false });
    await queue.current;
    if (activation !== activationVersion.current) return;
    if (persistBlocked.current)
      volatile.current.set(keyRef.current, {
        data: current.current.data,
        error:
          storageError ??
          "Unsaved changes are kept in this tab. Export before closing it.",
      });
    if (activation !== activationVersion.current) return;
    keyRef.current = key;
    setWorkspaceKey(key);
    record.current = null;
    persistBlocked.current = false;
    setStorageError(null);
    try {
      const saved = await loadWorkspace(
        key,
        mode === "demo" ? withCodeforcesDemo(createDemo()) : emptyData(),
      );
      if (activation !== activationVersion.current) return;
      record.current = saved;
      const unsaved = volatile.current.get(key);
      persistBlocked.current = !!unsaved;
      setStorageError(unsaved?.error ?? null);
      showBundle({ data: unsaved?.data ?? saved.data, mode, ready: true });
      await reconcileCurrentDay();
    } catch {
      if (activation !== activationVersion.current) return;
      const unsaved = volatile.current.get(key);
      persistBlocked.current = true;
      setStorageError(
        unsaved?.error ??
          "This workspace could not be read. Its original records are preserved.",
      );
      showBundle({ data: unsaved?.data ?? emptyData(), mode, ready: true });
    }
  }
  function setMode(mode: Mode) {
    if (mode === current.current.mode) return;
    void activateWorkspace(
      mode === "personal" && account ? `account:${account.id}` : mode,
      mode,
    );
    try {
      localStorage.setItem(STORAGE_KEYS.mode, mode);
    } catch {
      /* local workspace remains usable */
    }
    router.push("/");
    notify(
      mode === "demo"
        ? "Sample data is separate from your personal workspace."
        : "Welcome back to your own practice.",
    );
  }
  async function syncAccount() {
    if (
      !keyRef.current.startsWith("account:") ||
      cloudLock.current ||
      current.current.mode === "demo"
    )
      return;
    if (persistBlocked.current) {
      setCloudStatus("failed");
      setCloudError(
        "Unsaved account changes are kept in this tab. Export a backup and restore saving before syncing.",
      );
      return;
    }
    const key = keyRef.current;
    const operation = captureOperation();
    cloudLock.current = true;
    const cloudController = new AbortController();
    cloudAbort.current = cloudController;
    setCloudStatus("syncing");
    setCloudError(null);
    try {
      await queue.current;
      if (
        !operationIsCurrent(
          operation,
          captureOperation(),
          cloudController.signal,
        )
      )
        return;
      if (persistBlocked.current) throw new UnsavedWorkspaceError();
      const auth = getBrowserAuth();
      const session = await auth?.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token)
        throw new Error(
          "Sign in again to sync. Your unsynced local account data is preserved.",
        );
      const verified = await readCloudAccount(token, cloudController.signal);
      if (key !== `account:${verified.id}`)
        throw new Error(
          "Account changed. Sign out before switching accounts; cached records remain separate.",
        );
      const acknowledgement = await synchronizeAccount(
        key,
        accountTransport(token, cloudController.signal),
        cloudController.signal,
      );
      const saved = await readSettledWorkspace(
        operation,
        operationState,
        () => queue.current,
        () => loadWorkspace(key),
        cloudController.signal,
      );
      if (!saved) {
        if (
          operationIsCurrent(
            operation,
            captureOperation(),
            cloudController.signal,
          )
        )
          setCloudStatus(navigator.onLine ? "pending" : "offline");
        return;
      }
      record.current = saved;
      showBundle({ ...current.current, data: saved.data });
      await reconcileCurrentDay();
      if (
        !operationIsCurrent(
          operation,
          captureOperation(),
          cloudController.signal,
        )
      )
        return;
      if (persistBlocked.current) throw new UnsavedWorkspaceError();
      setCloudStatus(
        acknowledgement.data &&
          encodeBackup(current.current.data) ===
            encodeBackup(acknowledgement.data)
          ? "synced"
          : "pending",
      );
      channel.current?.postMessage({ key, revision: saved.revision });
    } catch (error) {
      if (
        operationIsCurrent(
          operation,
          captureOperation(),
          cloudController.signal,
        )
      ) {
        setCloudError(
          error instanceof Error
            ? error.message
            : "Sync failed; local changes remain recoverable.",
        );
        setCloudStatus(navigator.onLine ? "failed" : "offline");
      }
    } finally {
      if (cloudAbort.current === cloudController) {
        cloudLock.current = false;
        cloudAbort.current = null;
      }
    }
  }
  async function openAccount() {
    if (current.current.mode === "demo")
      throw new Error(
        "Leave the demo before signing in. Demo records never migrate.",
      );
    const operation = captureOperation();
    const auth = getBrowserAuth();
    const session = await auth?.auth.getSession();
    if (!operationIsCurrent(operation, captureOperation())) return;
    const token = session?.data.session?.access_token;
    if (!token) throw new Error("No application account session is available.");
    const verified = await readCloudAccount(token);
    if (!operationIsCurrent(operation, captureOperation())) return;
    invalidateCloud();
    setAccount(verified);
    setCloudError(null);
    const activation = activationVersion.current + 1;
    await activateWorkspace(`account:${verified.id}`, "personal");
    if (
      activation !== activationVersion.current ||
      keyRef.current !== `account:${verified.id}`
    )
      return;
    setCloudStatus("pending");
    await syncAccount();
  }
  async function logoutAccount() {
    invalidateCloud();
    const operation = captureOperation();
    const auth = getBrowserAuth();
    const result = await auth?.auth.signOut({ scope: "local" });
    if (result?.error) throw result.error;
    if (!operationIsCurrent(operation, captureOperation())) return;
    setAccount(null);
    setCloudStatus("local");
    setCloudError(null);
    await activateWorkspace("personal", "personal");
    notify(
      "Signed out. Account records and unsynced changes are kept in their separate device cache.",
    );
  }
  async function migratePersonal() {
    if (
      !keyRef.current.startsWith("account:") ||
      current.current.mode === "demo"
    )
      throw new Error("Sign in to migrate your personal notebook.");
    const operation = captureOperation();
    await queue.current;
    if (!operationIsCurrent(operation, captureOperation()))
      throw new Error(
        "The active workspace changed. Migration was cancelled; personal records are preserved.",
      );
    const target = current.current.data;
    if (
      target.problems.length ||
      target.attempts.length ||
      target.codeforces.submissions.length ||
      target.session
    )
      throw new Error(
        "This account already has history. Export both notebooks and reconcile them before replacing either.",
      );
    const personal = await loadWorkspace("personal");
    if (!operationIsCurrent(operation, captureOperation()))
      throw new Error(
        "The active workspace changed. Migration was cancelled; personal records are preserved.",
      );
    const latest = current.current.data;
    if (
      latest.problems.length ||
      latest.attempts.length ||
      latest.codeforces.submissions.length ||
      latest.session
    )
      throw new Error(
        "This account gained history while migration was pending. Export both notebooks before replacing either.",
      );
    if (!(await persist(personal.data, true)))
      throw new Error(
        "Migration was not committed. Your personal original and proposed account data remain recoverable.",
      );
    await queue.current;
    notify(
      "Personal records copied with their IDs and provenance. The original local notebook is preserved. Sync when ready.",
    );
  }
  useEffect(() => {
    if (!bundle.ready || bundle.mode === "demo") return;
    let cancelled = false;
    const auth = getBrowserAuth();
    if (!auth) return;
    void auth.auth.getSession().then(async (result) => {
      if (
        cancelled ||
        !result.data.session ||
        account ||
        keyRef.current.startsWith("account:")
      )
        return;
      try {
        await openAccount();
      } catch (error) {
        if (!cancelled)
          setCloudError(
            error instanceof Error
              ? error.message
              : "Account could not be verified.",
          );
      }
    });
    return () => {
      cancelled = true;
    };
    // Startup auth restoration uses the same verified server boundary as sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.ready]);
  useEffect(() => {
    if (
      !workspaceKey.startsWith("account:") ||
      !bundle.ready ||
      storagePending ||
      persistBlocked.current ||
      cloudStatus === "syncing"
    )
      return;
    let cancelled = false;
    void syncMetadata<SyncCheckpoint>(workspaceKey)
      .then((checkpoint) => {
        if (
          !cancelled &&
          !cloudError &&
          !checkpoint?.pending &&
          checkpoint?.base.data &&
          encodeBackup(bundle.data) === encodeBackup(checkpoint.base.data)
        )
          setCloudStatus("synced");
        else if (!cancelled && !cloudError)
          setCloudStatus(navigator.onLine ? "pending" : "offline");
      })
      .catch(() => {
        if (cancelled) return;
        setCloudStatus("failed");
        setCloudError(
          "Sync metadata could not be read. Your notebook remains on this device; export a backup before closing it.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    bundle.data,
    bundle.ready,
    workspaceKey,
    cloudError,
    cloudStatus,
    storagePending,
  ]);
  useEffect(() => {
    if (
      !workspaceKey.startsWith("account:") ||
      storagePending ||
      cloudStatus !== "pending" ||
      cloudError
    )
      return;
    const timer = setTimeout(() => void syncAccount(), 1500);
    return () => clearTimeout(timer);
    // Pending local revisions trigger a debounced, idempotent sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey, storagePending, cloudStatus, cloudError, bundle.data]);
  useEffect(() => {
    const offline = () => {
      if (keyRef.current.startsWith("account:")) setCloudStatus("offline");
    };
    const online = () => {
      if (keyRef.current.startsWith("account:")) {
        setCloudError(null);
        setCloudStatus("pending");
      }
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    const auth = getBrowserAuth();
    const subscription = auth?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        invalidateCloud();
        setAccount(null);
        setCloudStatus("local");
        setCloudError(null);
        if (keyRef.current.startsWith("account:"))
          void activateWorkspace("personal", "personal");
      }
    }).data.subscription;
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      subscription?.unsubscribe();
    };
    // Auth changes invalidate the active account cache without discarding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function startPractice(
    problem: Problem,
    duration = current.current.data.settings.defaultDuration,
    fresh = false,
    context?: TrackContext,
  ) {
    if (practiceLock.current || !current.current.ready) return false;
    const isCurrent = guardWorkspace();
    if (current.current.data.session) {
      if (current.current.data.session.problemId !== problem.id) {
        notify(
          "A session is already open. Finish or discard it before starting another.",
        );
        return false;
      }
      if (persistBlocked.current || pendingWrites.current) return false;
      router.push("/session");
      return true;
    }
    practiceLock.current = true;
    try {
      await queue.current;
      if (!isCurrent() || persistBlocked.current) return false;
      const saved = await update((data) =>
        withPracticeSession(
          data,
          problem,
          duration,
          Date.now(),
          uid(),
          fresh,
          context,
        ),
      );
      if (!saved || !isCurrent()) return false;
      router.push("/session");
      return true;
    } catch (error) {
      if (isCurrent())
        notify(
          error instanceof Error
            ? error.message
            : "Practice could not start. Retry after reviewing Settings recovery.",
        );
      return false;
    } finally {
      practiceLock.current = false;
    }
  }
  async function startSession(
    problem: Problem,
    duration?: Duration,
    context?: TrackContext,
  ) {
    return startPractice(problem, duration, false, context);
  }
  async function startFreshSession(
    problem: Problem,
    duration?: Duration,
    context?: TrackContext,
  ) {
    return startPractice(problem, duration, true, context);
  }
  async function replaceData(data: Data) {
    operationVersion.current++;
    invalidateCloud();
    syncAbort.current?.abort();
    syncLock.current = false;
    setSync(idleSync);
    const operation = captureOperation();
    await queue.current;
    if (!operationIsCurrent(operation, captureOperation())) return false;
    persistBlocked.current = false;
    setStorageError(null);
    const key = keyRef.current;
    // When initial storage access failed, a missing baseline may only create a
    // new workspace. The transaction rejects replacement if any revision exists.
    record.current ??= {
      key,
      revision: 0,
      data: emptyData(),
      savedAt: new Date().toISOString(),
    };
    const saved = await persist(ensureDailyReflectionBatch(data), true);
    if (saved) volatile.current.delete(key);
    if (saved) notify("Your data has been restored.");
    return saved;
  }
  async function previewHandle(raw: string): Promise<PublicProfile | null> {
    if (
      syncLock.current ||
      !current.current.ready ||
      current.current.mode === "demo"
    )
      return null;
    const isCurrent = guardWorkspace();
    const handle = raw.trim();
    if (!validHandle(handle)) {
      setSync({
        ...idleSync,
        error: "Use 3–24 letters, numbers, dots, underscores or hyphens.",
        code: "invalid_request",
      });
      return null;
    }
    syncLock.current = true;
    const version = operationVersion.current;
    const controller = new AbortController();
    syncAbort.current = controller;
    setSync({ ...idleSync, busy: true, phase: "preview" });
    try {
      const profile = await previewPublicProfile(handle, controller.signal);
      if (version !== operationVersion.current || !isCurrent()) return null;
      setSync(idleSync);
      return profile;
    } catch (e) {
      if (version === operationVersion.current && isCurrent())
        setSync({
          ...idleSync,
          phase: "preview",
          error: e instanceof Error ? e.message : "Profile could not be read.",
          code: e instanceof CodeforcesError ? e.code : "temporary",
        });
      return null;
    } finally {
      if (version === operationVersion.current) {
        syncLock.current = false;
        setSync((state) => (state.busy ? idleSync : state));
      }
    }
  }
  async function performSync(snapshot: Data, older = false) {
    if (
      syncLock.current ||
      !current.current.ready ||
      current.current.mode === "demo"
    )
      return false;
    const profile = connectedProfile(snapshot);
    if (!profile) return false;
    const isCurrent = guardWorkspace();
    syncLock.current = true;
    const version = operationVersion.current;
    const controller = new AbortController();
    syncAbort.current = controller;
    setSync({ ...idleSync, busy: true, phase: older ? "older" : "refresh" });
    try {
      const newest = Math.max(
        0,
        ...snapshot.codeforces.submissions
          .filter((s) => handleKey(s.handle) === handleKey(profile.handle))
          .map((s) => s.id),
      );
      const transaction = await collectProfileActivity(
        profile,
        newest,
        older,
        controller.signal,
      );
      if (
        version !== operationVersion.current ||
        !isCurrent() ||
        controller.signal.aborted
      )
        return false;
      if (
        handleKey(current.current.data.codeforces.connectedHandle ?? "") !==
        handleKey(profile.handle)
      )
        return false;
      const saved = await update((data) => {
        const imported = mergeActivity(
          data,
          profile.handle,
          transaction.pages,
          older ? "older" : "refresh",
        );
        return transaction.profile
          ? mergeProfileMetadata(imported, transaction.profile)
          : imported;
      });
      if (
        version !== operationVersion.current ||
        !isCurrent() ||
        controller.signal.aborted ||
        handleKey(current.current.data.codeforces.connectedHandle ?? "") !==
          handleKey(profile.handle)
      )
        return false;
      if (!saved) {
        setSync({
          ...idleSync,
          phase: older ? "older" : "refresh",
          code: "storage",
          error:
            "Activity could not be saved. Your proposed import remains recoverable in this tab or Settings. Export a backup, review recovery copies and restore saving before retrying the import.",
        });
        return false;
      }
      setSync(idleSync);
      if (transaction.profileWarning) notify(transaction.profileWarning);
      else
        notify(
          older
            ? "Older activity imported. Reflect on it whenever useful."
            : "Recent activity imported. Acceptance and understanding stay separate.",
        );
      return true;
    } catch (e) {
      if (version === operationVersion.current && isCurrent())
        setSync({
          ...idleSync,
          error:
            e instanceof Error ? e.message : "Activity could not be imported.",
          code: e instanceof CodeforcesError ? e.code : "temporary",
        });
      return false;
    } finally {
      if (version === operationVersion.current) {
        syncLock.current = false;
        setSync((state) => (state.busy ? idleSync : state));
      }
    }
  }
  async function connectHandle(profile: PublicProfile) {
    if (
      syncLock.current ||
      !current.current.ready ||
      current.current.mode === "demo"
    )
      return false;
    const isCurrent = guardWorkspace();
    const version = operationVersion.current;
    syncLock.current = true;
    setSync({ ...idleSync, busy: true, phase: "refresh" });
    try {
      const saved = await update((d) => connectProfile(d, profile));
      if (version !== operationVersion.current || !isCurrent()) return false;
      if (!saved) {
        setSync({
          ...idleSync,
          code: "storage",
          error:
            "The profile connection could not be saved. Keep this handle, export a backup and review Settings recovery before retrying.",
        });
        return false;
      }
    } finally {
      if (version === operationVersion.current) syncLock.current = false;
    }
    if (!isCurrent()) return false;
    return performSync(current.current.data);
  }
  async function syncActivity(older = false) {
    await performSync(current.current.data, older);
  }
  async function disconnectHandle() {
    if (syncLock.current || !current.current.ready) return false;
    operationVersion.current++;
    invalidateCloud();
    syncAbort.current?.abort();
    const isCurrent = guardWorkspace();
    const version = operationVersion.current;
    syncLock.current = true;
    setSync({ ...idleSync, busy: true });
    try {
      const saved = await update(disconnectProfile);
      if (version !== operationVersion.current || !isCurrent()) return false;
      if (!saved) {
        setSync({
          ...idleSync,
          code: "storage",
          error:
            "The disconnection could not be saved. Imported history is preserved; review Settings recovery and restore saving before retrying.",
        });
        return false;
      }
      setSync(idleSync);
      notify(
        "Public profile disconnected. All imported history and reflections are kept.",
      );
      return true;
    } finally {
      if (version === operationVersion.current) syncLock.current = false;
    }
  }
  return (
    <Context.Provider
      value={{
        ...bundle,
        theme,
        resolvedTheme,
        storageError,
        storagePending,
        workspaceKey,
        account,
        cloudStatus,
        cloudError,
        openAccount,
        logoutAccount,
        syncAccount,
        migratePersonal,
        update,
        retryLocalSave,
        setTheme,
        setMode,
        notify,
        startSession,
        startFreshSession,
        guardWorkspace,
        localDay,
        replaceData,
        sync,
        previewHandle,
        connectHandle,
        syncActivity,
        disconnectHandle,
        addOpen,
        setAddOpen,
      }}
    >
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toast && (
          <div className="toast">
            <span className="toast-check">
              <Check size={16} />
            </span>
            <span>{toast}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
export function pauseSession(session: Session): Session {
  return { ...session, elapsedMs: elapsed(session), runningSince: null };
}
