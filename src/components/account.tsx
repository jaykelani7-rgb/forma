"use client";
import { useState } from "react";
import { ArrowRight, Cloud, LogOut, RefreshCw } from "lucide-react";
import { getBrowserAuth } from "@/lib/cloud-client";
import { loadWorkspace } from "@/lib/storage";
import { Data } from "@/lib/model";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";

export function AccountSettings() {
  const {
    account,
    mode,
    cloudStatus,
    cloudError,
    openAccount,
    logoutAccount,
    syncAccount,
    migratePersonal,
    storagePending,
  } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [migration, setMigration] = useState<Data | null>(null);
  const auth = getBrowserAuth();
  async function signIn(form: HTMLFormElement, create = false) {
    if (!auth) return;
    const values = new FormData(form);
    const email = String(values.get("email"));
    const password = String(values.get("password"));
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = create
        ? await auth.auth.signUp({ email, password })
        : await auth.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (result.data.session) await openAccount();
      else
        setMessage(
          "Check your email to confirm the account, then sign in here. Your local notebook has not been uploaded.",
        );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The account could not be opened.",
      );
    } finally {
      setBusy(false);
      form.querySelector<HTMLInputElement>('input[name="password"]')!.value =
        "";
    }
  }
  return (
    <section className="settings-section account-panel" id="account">
      <div className="settings-section-heading">
        <span className="mono">06</span>
        <div>
          <h2>A notebook that lasts</h2>
          <p>Optional account storage, separate from your Codeforces handle.</p>
        </div>
      </div>
      <div className="settings-fields">
        {!auth ? (
          <>
            <p className="small muted">
              Account storage is not configured. Your local workspace, backups,
              and public Codeforces connection work independently.
            </p>
            <p className="tiny muted">
              To enable accounts, follow docs/cloud-setup.md, provision
              Supabase, apply the migration, and add the public URL and
              publishable key from .env.example. No cloud connection has been
              made.
            </p>
          </>
        ) : mode === "demo" ? (
          <p className="small muted">
            Return to your personal workspace before signing in. Sample records
            are excluded from account migration.
          </p>
        ) : account ? (
          <>
            <p className="small">
              <Cloud size={15} /> {account.email ?? "Application account"} ·{" "}
              <strong role="status">{cloudStatus}</strong>
            </p>
            <p className="tiny muted">
              Account data has its own device cache. Changes sync after local
              saving; failed writes stay recoverable. A public Codeforces handle
              never authorizes access.
            </p>
            <div className="backup-actions">
              <button
                className="button secondary"
                onClick={() => syncAccount()}
                disabled={storagePending || cloudStatus === "syncing"}
              >
                <RefreshCw size={16} />
                Sync now
              </button>
              <button
                className="text-link"
                onClick={async () => {
                  setError("");
                  try {
                    setMigration((await loadWorkspace("personal")).data);
                  } catch {
                    setError(
                      "The local personal notebook could not be read; its original copy is preserved.",
                    );
                  }
                }}
              >
                Migrate local personal records
                <ArrowRight size={15} />
              </button>
              <button
                className="text-link"
                onClick={async () => {
                  try {
                    await logoutAccount();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Sign out did not finish.",
                    );
                  }
                }}
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          </>
        ) : (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn(e.currentTarget);
            }}
          >
            <p className="small muted">
              Signing in opens a separate account workspace. Your personal
              records stay local until you explicitly migrate them.
            </p>
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            <div className="backup-actions">
              <button className="button primary" disabled={busy} type="submit">
                {busy ? "Opening account…" : "Sign in"}
                <ArrowRight size={16} />
              </button>
              <button
                className="button secondary"
                disabled={busy}
                type="button"
                onClick={(e) => {
                  const form = e.currentTarget.closest("form")!;
                  if (form.reportValidity()) void signIn(form, true);
                }}
              >
                Create account
              </button>
            </div>
          </form>
        )}
        {(error || cloudError) && (
          <p className="form-error" role="alert">
            {error || cloudError}
          </p>
        )}
        {message && (
          <p className="small" role="status">
            {message}
          </p>
        )}
        {migration && (
          <Modal
            title="Bring your practice along."
            onClose={() => setMigration(null)}
          >
            <div className="form-stack">
              <p>
                Your personal notebook contains {migration.problems.length}{" "}
                problems, {migration.attempts.length} timed sessions,{" "}
                {migration.codeforces.submissions.length} submissions, and{" "}
                {migration.codeforces.reflections.length} quick reflections
                {migration.session ? ", including an active session" : ""}.
              </p>
              <p className="small muted">
                Copy these to your empty account workspace with their IDs,
                notes, timestamps, and schedules. Demo records are excluded. The
                original personal notebook is kept. An account with existing
                history cannot be replaced through this action.
              </p>
              <div className="form-actions">
                <button
                  className="button secondary"
                  onClick={() => setMigration(null)}
                >
                  Keep records local
                </button>
                <button
                  className="button primary"
                  onClick={async () => {
                    try {
                      await migratePersonal();
                      setMigration(null);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Migration did not finish.",
                      );
                      setMigration(null);
                    }
                  }}
                >
                  Copy personal records
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </section>
  );
}
