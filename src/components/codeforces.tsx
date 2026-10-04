"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Link2,
  RefreshCw,
  Unplug,
  AlertCircle,
  Clock3,
} from "lucide-react";
import { addDays, localDate, shortDate } from "@/lib/model";
import {
  ImportedAttempt,
  PublicProfile,
  handleKey,
} from "@/lib/codeforces-types";
import {
  connectedProfile,
  dailyReflectionBatch,
  dailyReflectionCounts,
  latestSubmission,
  profileActivity,
  profileStats,
  practiceReflectionFor,
  reflectionFor,
  relativeTime,
  verdictLabel,
} from "@/lib/codeforces";
import { useWorkspace } from "./provider";
import { PageHeader, ProblemLink, SectionHeading } from "./ui";
import { QUICK_OUTCOMES, QuickReflectionDialog } from "./quick-reflection";

function SyncNotice() {
  const { data, sync } = useWorkspace();
  const profile = connectedProfile(data);
  return (
    <div className="sync-notice" aria-live="polite" aria-atomic="true">
      {sync.busy ? (
        <p className="sync-status">
          <RefreshCw size={14} className="sync-spinner" />
          {sync.phase === "preview"
            ? "Checking the public profile…"
            : sync.phase === "older"
              ? "Loading older activity…"
              : "Importing recent activity…"}
        </p>
      ) : sync.error ? (
        <div className="sync-error" role="alert">
          <AlertCircle size={16} />
          <div>
            <strong>
              {sync.code === "invalid_handle" || sync.code === "invalid_request"
                ? "Check the handle"
                : sync.phase === "preview"
                  ? "Couldn’t read the public profile"
                  : profile?.lastSyncAt
                    ? "Refresh didn’t finish"
                    : "Couldn’t import activity"}
            </strong>
            <p>{sync.error}</p>
            {profile?.lastSyncAt && (
              <p>
                Showing saved activity from{" "}
                {new Date(profile.lastSyncAt).toLocaleString()}. Nothing was
                replaced.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
export function CodeforcesConnection() {
  const {
    data,
    mode,
    sync,
    previewHandle,
    connectHandle,
    syncActivity,
    disconnectHandle,
  } = useWorkspace();
  const profile = connectedProfile(data);
  const [changing, setChanging] = useState(false);
  const [handle, setHandle] = useState("");
  const [preview, setPreview] = useState<PublicProfile | null>(null);
  async function check(event: React.FormEvent) {
    event.preventDefault();
    setPreview(await previewHandle(handle));
  }
  return (
    <section className="settings-section" id="codeforces">
      <div className="settings-section-heading">
        <span className="mono">03</span>
        <div>
          <h2>Your Codeforces practice</h2>
          <p>A little less tracking. More room to understand.</p>
        </div>
      </div>
      <div className="settings-fields cf-connection">
        <p className="small muted">
          Read a public Codeforces profile and import its activity. This
          connects a handle; it isn’t authentication or proof of account
          ownership. No password needed.
        </p>
        {profile && (
          <div className="cf-profile">
            <span className="cf-profile-icon">
              <Link2 size={21} />
            </span>
            <div>
              <strong>
                {profile.handle}
                {mode === "demo" ? " · sample profile" : ""}
              </strong>
              <span>
                {profile.rating === null
                  ? "Unrated"
                  : `${profile.rating} rating${profile.rank ? ` · ${profile.rank}` : ""}`}
              </span>
              <small>
                {profile.profileUpdatedAt
                  ? `Profile checked · ${new Date(profile.profileUpdatedAt).toLocaleString()}. `
                  : "Rating freshness unknown. "}
                {profile.lastSyncAt
                  ? `Last successful import · ${new Date(profile.lastSyncAt).toLocaleString()}`
                  : "Ready for the first import"}
              </small>
            </div>
            <a
              className="icon-button"
              href={`https://codeforces.com/profile/${encodeURIComponent(profile.handle)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open Codeforces profile ${profile.handle} (new tab)`}
            >
              <ArrowUpRight size={18} />
            </a>
          </div>
        )}
        {mode === "demo" ? (
          <p className="field-help">
            This activity is sample data. Connect a real handle in your personal
            workspace.
          </p>
        ) : !profile || changing ? (
          <form onSubmit={check} className="form-stack cf-handle-form">
            <label>
              Codeforces handle
              <input
                autoComplete="off"
                spellCheck={false}
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value);
                  setPreview(null);
                }}
                maxLength={24}
                placeholder="Your public handle"
                required
                disabled={sync.busy}
              />
            </label>
            <div className="backup-actions">
              <button
                type="submit"
                className="button secondary"
                disabled={sync.busy || !handle.trim()}
              >
                Preview profile
                <ArrowRight size={15} />
              </button>
              {changing && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setChanging(false);
                    setPreview(null);
                  }}
                >
                  Keep current handle
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="backup-actions">
            <button
              className="button primary"
              disabled={sync.busy}
              onClick={() => syncActivity()}
            >
              <RefreshCw size={16} />
              {profile.lastSyncAt
                ? "Refresh activity"
                : "Import recent activity"}
            </button>
            <button
              className="text-link"
              disabled={sync.busy}
              onClick={() => {
                setChanging(true);
                setHandle("");
                setPreview(null);
              }}
            >
              Change handle
            </button>
            <button
              className="text-link muted"
              disabled={sync.busy}
              onClick={disconnectHandle}
            >
              <Unplug size={14} />
              Disconnect
            </button>
          </div>
        )}
        {preview && !sync.busy && (
          <div className="cf-preview">
            <span className="eyebrow">PUBLIC PROFILE PREVIEW</span>
            <h3>{preview.handle}</h3>
            <p>
              {preview.rating === null
                ? "Unrated"
                : `${preview.rating} rating${preview.rank ? ` · ${preview.rank}` : ""}`}
            </p>
            <p className="small muted">
              Import the latest 50 submissions. Older history stays available
              through “Load older activity.” Changing handles keeps the previous
              history.
            </p>
            <button
              className="button primary"
              onClick={async () => {
                setChanging(false);
                setPreview(null);
                await connectHandle(preview);
              }}
            >
              Connect and import
              <Check size={16} />
            </button>
          </div>
        )}
        <SyncNotice />
        {profile && <Coverage handle={profile.handle} />}
        {data.codeforces.profiles.length > 0 && (
          <Link href="/activity" className="text-link">
            View saved activity
            <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </section>
  );
}
export function Coverage({ handle }: { handle: string }) {
  const { data } = useWorkspace();
  const p = data.codeforces.profiles.find(
    (p) => handleKey(p.handle) === handleKey(handle),
  );
  if (!p?.lastSyncAt) return null;
  const submissions = data.codeforces.submissions.filter(
    (s) => handleKey(s.handle) === handleKey(handle),
  );
  const earliest = submissions.map((s) => s.submittedAt).sort()[0];
  return (
    <p className="cf-coverage tiny muted">
      {submissions.length} imported submission
      {submissions.length === 1 ? "" : "s"}
      {earliest ? ` · earliest imported ${shortDate(earliest)}` : ""}.{" "}
      {p.gapUntilId
        ? "A gap remains since your previous import. Load older activity to fill it. Statistics cover imported records only."
        : p.historyComplete
          ? "Reached the oldest available public activity. Statistics cover imported records; refresh checks recent activity."
          : "Bounded history; statistics cover imported records only. Load older activity for more."}
    </p>
  );
}
export function ActivityRows({
  attempts,
  details = false,
}: {
  attempts: ImportedAttempt[];
  details?: boolean;
}) {
  const { data } = useWorkspace();
  const [selected, setSelected] = useState<ImportedAttempt | null>(null);
  return (
    <>
      <div className="cf-activity-list">
        {attempts.map((a) => {
          const problem = data.problems.find((p) => p.id === a.problemId)!;
          const latest = latestSubmission(data, a);
          const reflection = reflectionFor(data, a.id);
          const linked = data.learningLinks?.some(
            (l) => l.importedAttemptId === a.id,
          );
          const effective = practiceReflectionFor(data, a.id);
          return (
            <article className="cf-activity-row" key={a.id}>
              <div className="cf-activity-main">
                <strong>{problem.title}</strong>
                <div className="problem-meta">
                  <span className="mono">#{problem.problemCode}</span>
                  {problem.rating !== null && (
                    <span className="mono">{problem.rating} rating</span>
                  )}
                  <time
                    dateTime={a.lastSubmittedAt}
                    title={new Date(a.lastSubmittedAt).toLocaleString()}
                  >
                    {relativeTime(a.lastSubmittedAt)}
                  </time>
                </div>
                <div className="cf-result">
                  <span
                    className={`platform-verdict ${latest?.verdict === "OK" ? "accepted" : !latest?.verdict || ["TESTING", "SUBMITTED"].includes(latest.verdict) ? "pending" : "other"}`}
                  >
                    <span className="status-dot" />
                    {verdictLabel(latest?.verdict ?? null)}
                  </span>
                  <span className="reflection-state">
                    {reflection
                      ? QUICK_OUTCOMES[reflection.outcome]
                      : linked
                        ? `Linked timed reflection · ${effective ? QUICK_OUTCOMES[effective.outcome] : "pending"}`
                        : a.skipped
                          ? "Reflection skipped · available later"
                          : "Reflection pending"}
                  </span>
                </div>
                {reflection?.takeaway && details && (
                  <p className="takeaway">“{reflection.takeaway}”</p>
                )}
                {details && (
                  <details className="cf-submissions">
                    <summary>
                      {a.submissionIds.length} platform submission
                      {a.submissionIds.length === 1 ? "" : "s"}
                    </summary>
                    <ul>
                      {data.codeforces.submissions
                        .filter(
                          (s) =>
                            handleKey(s.handle) === handleKey(a.handle) &&
                            a.submissionIds.includes(s.id),
                        )
                        .sort(
                          (x, y) =>
                            x.submittedAt.localeCompare(y.submittedAt) ||
                            x.id - y.id,
                        )
                        .map((s) => (
                          <li key={s.id}>
                            <span className="mono">#{s.id}</span>
                            <span>
                              {verdictLabel(s.verdict)} · {s.language}
                            </span>
                            <time dateTime={s.submittedAt}>
                              {new Date(s.submittedAt).toLocaleString()}
                            </time>
                          </li>
                        ))}
                    </ul>
                    <p className="tiny muted">
                      Submission timestamps are activity events. Solving time
                      wasn’t measured.
                    </p>
                  </details>
                )}
              </div>
              <div className="cf-row-actions">
                <button
                  className="button secondary"
                  aria-label={`${reflection ? "Edit reflection" : "Reflect"}: ${problem.title}`}
                  onClick={() => setSelected(a)}
                >
                  {reflection ? "Edit reflection" : "Reflect"}
                  <ArrowRight size={14} />
                </button>
                <ProblemLink problem={problem} />
              </div>
            </article>
          );
        })}
      </div>
      {selected && (
        <QuickReflectionDialog
          attempt={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
export function TodayActivity() {
  const { data, mode, sync, syncActivity } = useWorkspace();
  const profile = connectedProfile(data);
  if (!profile)
    return (
      <section className="cf-first-use">
        <Link2 size={20} />
        <div>
          <h2>Bring your Codeforces practice along.</h2>
          <p>Import public activity. Leave a quick reflection when it helps.</p>
        </div>
        <Link className="text-link" href="/settings#codeforces">
          Connect a handle
          <ArrowRight size={15} />
        </Link>
      </section>
    );
  const stats = profileStats(data, profile.handle, profile.sinceAt);
  const activity = profileActivity(data, profile.handle);
  const batch = dailyReflectionCounts(data, profile.handle);
  const recent = dailyReflectionBatch(data, profile.handle).slice(0, 5);
  return (
    <section className="cf-today">
      <SectionHeading
        title={
          profile.sinceAt ? "Since your last visit" : "Your recent activity"
        }
        link="/activity"
        label="View all activity"
      />
      <div className="cf-today-summary">
        <p>
          <strong>{stats.accepted}</strong> problem
          {stats.accepted === 1 ? "" : "s"} accepted <span>·</span>{" "}
          <strong>{batch.pending}</strong> of {batch.total} in today’s
          reflection batch
        </p>
        {mode !== "demo" && (
          <button
            className="text-link"
            disabled={sync.busy}
            onClick={() => syncActivity()}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        )}
      </div>
      <p className="tiny muted">
        {profile.handle}
        {profile.sinceAt
          ? ` · activity after ${new Date(profile.sinceAt).toLocaleString()}`
          : " · recent imported history"}
        . An accepted verdict doesn’t tell us how you solved it.
      </p>
      <SyncNotice />
      {recent.length ? (
        <ActivityRows attempts={recent} />
      ) : (
        <div className="quiet-empty">
          <Clock3 size={20} />
          <p>
            {profile.lastSyncAt
              ? activity.length
                ? "Today’s small reflection batch is clear. All earlier attempts stay in Activity."
                : "No public submissions returned yet. Your next attempt will have a place here."
              : "Your profile is connected. Import recent activity to get started."}
          </p>
        </div>
      )}
      <details className="help-details">
        <summary>
          Imported history coverage · {batch.unreflected} unreflected in full
          history
        </summary>
        <Coverage handle={profile.handle} />
      </details>
    </section>
  );
}
export function CodeforcesActivity() {
  const { data, mode, sync, syncActivity } = useWorkspace();
  const [selectedHandle, setSelectedHandle] = useState(
    data.codeforces.connectedHandle ??
      data.codeforces.profiles[0]?.handle ??
      "",
  );
  const [filter, setFilter] = useState("all");
  const profile = data.codeforces.profiles.find(
    (p) => p.handle === selectedHandle,
  );
  const stats = profileStats(data, selectedHandle);
  const activity = profileActivity(data, selectedHandle);
  const filtered = activity.filter(
    (a) =>
      filter === "all" ||
      (filter === "pending" && !practiceReflectionFor(data, a.id)) ||
      (filter === "reflected" && !!practiceReflectionFor(data, a.id)),
  );
  const connected =
    handleKey(selectedHandle) ===
    handleKey(data.codeforces.connectedHandle ?? "");
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="THE WORK YOU BRING WITH YOU"
        title="A little less to keep track of."
        description="Public submissions, honest reflections, and room for a fresh attempt."
        action={
          <Link className="text-link" href="/settings#codeforces">
            Connection settings
            <ArrowRight size={16} />
          </Link>
        }
      />
      {!profile ? (
        <div className="empty-state">
          <Link2 size={28} />
          <h2>Start with a public handle.</h2>
          <p>
            Your manual notebook is ready whenever you are. Connect Codeforces
            to bring activity here.
          </p>
          <Link className="button primary" href="/settings#codeforces">
            Connect a handle
            <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <>
          <div className="cf-activity-toolbar">
            <label>
              Activity profile
              <select
                value={selectedHandle}
                onChange={(e) => setSelectedHandle(e.target.value)}
              >
                {data.codeforces.profiles.map((p) => (
                  <option key={p.handle} value={p.handle}>
                    {p.handle}
                    {handleKey(p.handle) ===
                    handleKey(data.codeforces.connectedHandle ?? "")
                      ? " · connected"
                      : " · saved history"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Show attempts
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All attempts</option>
                <option value="pending">Unreflected</option>
                <option value="reflected">Reflected</option>
              </select>
            </label>
            {connected && mode !== "demo" && (
              <button
                className="button secondary"
                disabled={sync.busy}
                onClick={() => syncActivity()}
              >
                <RefreshCw size={16} />
                Refresh activity
              </button>
            )}
          </div>
          <div className="cf-metrics">
            <div>
              <strong className="mono">{stats.submissions}</strong>
              <span>submissions imported</span>
            </div>
            <div>
              <strong className="mono">{stats.accepted}</strong>
              <span>unique accepted problems</span>
            </div>
            <div>
              <strong className="mono">{stats.reflected}</strong>
              <span>reflected attempts</span>
            </div>
          </div>
          {connected && <SyncNotice />}
          <Coverage handle={selectedHandle} />
          {!connected && (
            <p className="small muted">
              Saved history for {selectedHandle}. Its revisits and statistics
              stay separate. Reconnect this handle in Settings to refresh it or
              include its revisit queue.
            </p>
          )}
          <details className="help-details">
            <summary>How imports and practice attempts work</summary>
            <p className="cf-grouping small muted">
              Related submissions for the same problem are grouped when they’re
              within two hours. Acceptance closes an attempt. Later attempts
              stay separate; saved groups stay stable if a verdict changes.
              Imported activity can be explicitly linked to a timed Forma
              session; related timestamps alone never establish a link.
            </p>
          </details>
          {filtered.length ? (
            <ActivityRows attempts={filtered} details />
          ) : (
            <div className="quiet-empty">
              <Clock3 size={21} />
              <p>
                {activity.length
                  ? "No attempts match this filter."
                  : "No public submissions returned. There’s room for your next attempt."}
              </p>
            </div>
          )}
          {connected && !profile.historyComplete && mode !== "demo" && (
            <div className="cf-load-more">
              <button
                className="button secondary"
                disabled={sync.busy}
                onClick={() => syncActivity(true)}
              >
                Load older activity
                <ArrowRight size={16} />
              </button>
              <p className="tiny muted">
                One page at a time, with overlap to avoid missing moving
                records. Older attempts don’t enter your daily reflection batch.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function CodeforcesProgress() {
  const { data } = useWorkspace();
  const [handle, setHandle] = useState(
    data.codeforces.connectedHandle ??
      data.codeforces.profiles[0]?.handle ??
      "",
  );
  if (!data.codeforces.profiles.length) return null;
  const stats = profileStats(data, handle);
  return (
    <section className="cf-progress">
      <SectionHeading
        title="Your Codeforces activity"
        link="/activity"
        label="View activity"
      />
      <label className="cf-progress-profile">
        Public profile
        <select value={handle} onChange={(e) => setHandle(e.target.value)}>
          {data.codeforces.profiles.map((p) => (
            <option key={p.handle}>{p.handle}</option>
          ))}
        </select>
      </label>
      <Coverage handle={handle} />
      <div className="cf-metrics cf-learning-metrics">
        {[
          [stats.submissions, "platform submissions"],
          [stats.accepted, "unique accepted problems"],
          [stats.reflected, "reflected practice attempts"],
          [stats.independent, "independently solved attempts"],
          [stats.assisted, "assisted attempts"],
          [stats.revisits, "successful independent revisits"],
        ].map(([count, label]) => (
          <div key={label}>
            <strong className="mono">{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="tiny muted">
        Acceptance is a platform verdict. Independent and assisted outcomes come
        only from reflections. Imported attempts add no timed sessions or
        focused minutes.
      </p>
    </section>
  );
}
export function RevisitDefaults() {
  const { data, update, notify } = useWorkspace();
  const [days, setDays] = useState(data.settings.reviewDays);
  const [error, setError] = useState("");
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <span className="mono">04</span>
        <div>
          <h2>A little space before the next try</h2>
          <p>Simple revisit defaults. Yours to adjust.</p>
        </div>
      </div>
      <form
        className="settings-fields"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !Object.values(days).every(
              (n) => Number.isInteger(n) && n >= 1 && n <= 90,
            )
          ) {
            setError("Choose whole numbers from 1 to 90 days.");
            return;
          }
          update((d) => ({
            ...d,
            settings: { ...d.settings, reviewDays: { ...days } },
          }));
          setError("");
          notify(
            "Revisit defaults saved. Existing dates stay as you chose them.",
          );
        }}
      >
        <div className="cf-rule-fields">
          {(
            [
              ["unsolved", "Still need to understand it"],
              ["editorial", "Used the editorial"],
              ["hint", "Used a hint"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <span className="cf-days-input">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={days[key]}
                  onChange={(e) =>
                    setDays({ ...days, [key]: Number(e.target.value) })
                  }
                  required
                />
                <span>days later</span>
              </span>
            </label>
          ))}
        </div>
        <p className="field-help">
          Scheduling defaults, not scientifically optimal intervals. Independent
          solves need no mandatory revisit; a successful revisit can be
          completed or reviewed later.
        </p>
        <p className="tiny muted">
          For example, tomorrow is{" "}
          {shortDate(localDate(addDays(new Date(), 1)))} in your local calendar.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button secondary" type="submit">
          Save revisit defaults
          <Check size={16} />
        </button>
      </form>
    </section>
  );
}
