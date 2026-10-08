"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell, Check, Download, RefreshCw, WifiOff, X } from "lucide-react";
import {
  defaultReminder,
  dismissInAppReminder,
  inAppReminderDue,
  validateReminder,
} from "@/lib/reminders";
import { useWorkspace } from "./provider";
import styles from "./install.module.css";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallSupport() {
  const {
    data,
    ready,
    storagePending,
    storageError,
    sync,
    update,
    mode,
    cloudStatus,
    cloudError,
  } = useWorkspace();
  const pathname = usePathname();
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [activated, setActivated] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const connection = () => setOffline(!navigator.onLine);
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    const updateFound = () => {
      const installing = registration?.installing;
      installing?.addEventListener("statechange", () => {
        if (
          !cancelled &&
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        )
          setWaiting(registration?.waiting ?? null);
      });
    };
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((value) => {
          if (cancelled) return;
          registration = value;
          setWaiting(value.waiting);
          value.addEventListener("updatefound", updateFound);
        })
        .catch(() => {
          /* Local practice remains available if installation is blocked. */
        });
    }
    return () => {
      cancelled = true;
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      registration?.removeEventListener("updatefound", updateFound);
      window.clearInterval(timer);
    };
  }, []);

  const safeToActivate =
    ready &&
    !data.session &&
    !data.contests?.some((c) => c.state === "active") &&
    !storagePending &&
    !storageError &&
    !sync.busy &&
    ["local", "synced"].includes(cloudStatus) &&
    !cloudError;
  function activateUpdate() {
    if (!safeToActivate || !waiting) return;
    waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    setWaiting(null);
    setActivated(true);
    // Do not reload. Active pages, form drafts and unsynced account notes survive.
    // The new application code is loaded only when the user next opens the app.
  }
  const reminder =
    ready && mode !== "demo" && pathname === "/" && inAppReminderDue(data, now);
  if (!offline && !waiting && !activated && !reminder) return null;
  return (
    <aside className={styles.notices} aria-label="Daily access notices">
      {offline && (
        <div className={styles.notice} role="status">
          <WifiOff size={18} />
          <div>
            <strong>You’re offline.</strong>
            <p>
              Local practice can continue in this loaded tab. Imports, discovery
              and account sync wait for a connection.
            </p>
          </div>
        </div>
      )}
      {waiting && (
        <div className={styles.notice} role="status">
          <RefreshCw size={18} />
          <div>
            <strong>An update is ready.</strong>
            <p>
              {safeToActivate
                ? "Activate it when convenient. This page stays open; new app code loads next time."
                : "Finish your active session or contest and save or sync pending changes before activating it."}
            </p>
            <button
              className="text-link"
              disabled={!safeToActivate}
              onClick={activateUpdate}
            >
              Activate update
            </button>
          </div>
        </div>
      )}
      {activated && (
        <div className={styles.notice} role="status">
          <Check size={18} />
          <div>
            <strong>Update activated.</strong>
            <p>
              Your page stays open. Finish your work, then reopen Forma when
              convenient.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss update message"
            onClick={() => setActivated(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {reminder && (
        <div className={styles.notice}>
          <Bell size={18} />
          <div>
            <strong>A little practice, if you have room.</strong>
            <p>Your optional in-app reminder. There’s no streak to protect.</p>
            <Link className="text-link" href="/problems">
              Choose a problem
            </Link>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss practice reminder for today"
            onClick={() => update((data) => dismissInAppReminder(data))}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </aside>
  );
}

export function DailyAccessSettings() {
  const { data, update, notify, guardWorkspace } = useWorkspace();
  const reminder = data.settings.reminder ?? defaultReminder();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [time, setTime] = useState(reminder.time);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const [savingTime, setSavingTime] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(display-mode: standalone)");
    const installedState = () =>
      setInstalled(
        query.matches ||
          !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    const offerInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const didInstall = () => {
      setInstalled(true);
      setPrompt(null);
    };
    installedState();
    query.addEventListener("change", installedState);
    window.addEventListener("beforeinstallprompt", offerInstall);
    window.addEventListener("appinstalled", didInstall);
    return () => {
      query.removeEventListener("change", installedState);
      window.removeEventListener("beforeinstallprompt", offerInstall);
      window.removeEventListener("appinstalled", didInstall);
    };
  }, []);
  useEffect(() => setTime(reminder.time), [reminder.time]);
  async function install() {
    if (!prompt) return;
    try {
      await prompt.prompt();
      await prompt.userChoice;
      setPrompt(null);
    } catch {
      setError(
        "The browser could not open its installation prompt. Use its menu to add Forma instead.",
      );
    }
  }
  async function saveTime() {
    if (saving.current) return;
    const isCurrent = guardWorkspace();
    saving.current = true;
    setSavingTime(true);
    try {
      const preference = validateReminder({ ...reminder, time });
      const saved = await update((current) => ({
        ...current,
        settings: { ...current.settings, reminder: preference },
      }));
      if (!isCurrent()) return;
      if (!saved) {
        setError(
          "The reminder time could not be saved. Keep your chosen time and review saving and recovery in Settings before retrying.",
        );
        return;
      }
      setError(null);
      notify("In-app reminder time saved.");
    } catch {
      if (isCurrent()) setError("Choose a valid reminder time.");
    } finally {
      saving.current = false;
      if (isCurrent()) setSavingTime(false);
    }
  }
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <span className="mono">06</span>
        <div>
          <h2>A place in your day</h2>
          <p>Easy to open. Gentle to return to.</p>
        </div>
      </div>
      <div className="settings-fields">
        <h3 className={styles.subheading}>Install Forma</h3>
        {installed ? (
          <p className="small muted">Forma is open as an installed app.</p>
        ) : (
          <>
            {prompt && (
              <button className="button secondary" onClick={install}>
                <Download size={16} />
                Install Forma
              </button>
            )}
            <p className="small muted">
              Use your browser’s install option. On iPhone or iPad, open Forma
              in Safari, tap Share, then Add to Home Screen. On desktop, use the
              address bar or browser menu. Availability depends on the browser;
              installation requires HTTPS or localhost.
            </p>
          </>
        )}
        <details className="help-details">
          <summary>Offline access and safe updates</summary>
          <p className="small">
            An already loaded tab can keep local practice and notes saved on
            this device. A fresh offline launch shows a reconnect page. Imports,
            catalogue discovery and account sync need a connection. App updates
            never automatically reload this page. Finish your session and let
            local changes save before reopening. Keep regular backups.
          </p>
        </details>
        <h3 className={styles.subheading}>An optional in-app reminder</h3>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={reminder.enabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              update((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  reminder: {
                    ...(current.settings.reminder ?? defaultReminder()),
                    enabled,
                  },
                },
              }));
            }}
          />
          <span>Offer a gentle reminder on Today</span>
        </label>
        <div className="form-row">
          <label>
            Reminder time
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={!reminder.enabled || savingTime}
            />
          </label>
          <button
            className="button secondary"
            onClick={saveTime}
            disabled={!reminder.enabled || savingTime}
          >
            {savingTime ? "Saving reminder time…" : "Save reminder time"}
          </button>
        </div>
        <p className="field-help">
          Your device’s local time. Only while Forma is open on Today, and only
          if no practice has been recorded today. Dismiss it for the day or
          disable it here. This does not deliver notifications when the app is
          closed.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
