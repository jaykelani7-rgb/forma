"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Leaf,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  Duration,
  Data,
  addDays,
  breakthroughs,
  localDate,
  shortDate,
  visibleProblems,
  weekActivity,
} from "@/lib/model";
import {
  continuePracticePlan,
  decidePlanItem,
  endPracticePlan,
  practicePlanView,
  practicePreferences,
  replacePlanItem,
  resolvePlanProblem,
  setPlanAvailability,
  setPlanTimebox,
} from "@/lib/practice-plan";
import type { PracticePlanItem } from "@/lib/practice-plan-types";
import { learningHistory } from "@/lib/learning";
import { memoryRecordAnchor } from "@/lib/learning-insights";
import { useWorkspace } from "./provider";
import { FreshDiscovery } from "./discovery";
import { TodayActivity } from "./codeforces";
import { PracticePlanPreferences } from "./practice-plan-preferences";
import styles from "./today-discovery.module.css";

function PracticeIllustration({ empty = false }: { empty?: boolean }) {
  return (
    <div
      className={`practice-art ${empty ? "empty-art" : ""}`}
      aria-hidden="true"
    >
      <svg width="170" height="190" viewBox="0 0 170 190" fill="none">
        <path
          d="M15 163C15 140 18 20 83 20C148 20 155 121 155 163H15Z"
          fill="currentColor"
          opacity=".06"
        />
        <path
          d="M35 149H135M35 123H135M35 97H135M35 71H135M35 45H135M35 45V149M61 45V149M87 45V149M113 45V149M135 45V149"
          stroke="currentColor"
          strokeWidth=".75"
          opacity=".17"
        />
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={38 + i * 25}
            y={126 - i * 26}
            width="20"
            height="20"
            rx="2"
            fill="currentColor"
            opacity={0.15 + i * 0.12}
          />
        ))}
        <path
          d="M42 157L142 57M131 57H142V68"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 4"
          opacity=".55"
        />
        <circle cx="32" cy="26" r="3" fill="currentColor" opacity=".35" />
        <path
          d="M144 30V40M139 35H149"
          stroke="currentColor"
          strokeWidth="1"
          opacity=".5"
        />
        <text
          x="85"
          y="184"
          textAnchor="middle"
          fill="currentColor"
          fontSize="12"
          fontFamily="monospace"
          letterSpacing="2"
          opacity=".6"
        >
          ONE STEP AT A TIME
        </text>
      </svg>
    </div>
  );
}
export function WeeklyRhythm() {
  const { data } = useWorkspace();
  const days = weekActivity(data);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const goal = data.settings.weeklyGoal;
  const start = days[0].date,
    end = addDays(start, 6);
  return (
    <section className="rhythm-panel" aria-labelledby="rhythm-title">
      <div className="section-heading">
        <h2 id="rhythm-title">Your weekly rhythm</h2>
        <span className="mono tiny">
          {shortDate(localDate(start))}–{end.getDate()}
        </span>
      </div>
      <p className="rhythm-count">
        <strong>
          {total}
          <span> / {goal}</span>
        </strong>
        <span>timed sessions this week</span>
      </p>
      <div
        className="rhythm-days"
        role="list"
        aria-label="Completed sessions Monday to Sunday"
      >
        {days.map((day) => (
          <div
            role="listitem"
            key={day.day}
            className={`rhythm-day ${day.count ? "completed" : ""} ${day.today ? "is-today" : ""} ${day.future ? "future" : ""}`}
            aria-label={`${day.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}: ${day.count} completed session${day.count === 1 ? "" : "s"}${day.today ? ", today" : ""}`}
          >
            <div className="day-stem">
              {day.count ? (
                <>
                  <span
                    className="day-fill"
                    style={{ height: `${Math.min(100, 35 + day.count * 25)}%` }}
                  />
                  <Check size={14} />
                </>
              ) : (
                <span className="day-dot" />
              )}
            </div>
            <span className="day-name">
              {day.date
                .toLocaleDateString("en-US", { weekday: "short" })
                .slice(0, 1)}
            </span>
            <span className="today-dot" />
          </div>
        ))}
      </div>
      <p className="rhythm-caption">
        {total === 0
          ? "An open week. Make room for a little practice."
          : total >= goal
            ? "You’ve made room for your practice. Anything more is a bonus."
            : `${goal - total} more ${goal - total === 1 ? "session" : "sessions"} to your flexible goal. There’s room to find your own rhythm.`}
      </p>
      <Link href="/progress" className="text-link">
        See your progress
        <ArrowUpRight size={15} />
      </Link>
    </section>
  );
}
function memoryHref(
  data: Data,
  item: PracticePlanItem,
  recordId?: string,
  source?: string,
) {
  let anchor = source === "schedule" ? "memory-revision" : "memory-history";
  if (recordId) {
    if (source === "revision" || (!source && item.activity !== "coding"))
      anchor = memoryRecordAnchor("revision", recordId);
    else {
      const record = learningHistory(data).find(
        (record) =>
          record.id === recordId ||
          record.timedAttemptId === recordId ||
          record.importedAttemptId === recordId,
      );
      if (record) anchor = memoryRecordAnchor("practice", record.id);
    }
  }
  return `/problems/${encodeURIComponent(item.problemId)}?from=%2F#${encodeURIComponent(anchor)}`;
}
function activityLabel(item: PracticePlanItem) {
  return item.activity === "coding"
    ? item.kind === "track"
      ? "Next in your track"
      : item.kind === "session"
        ? "Unfinished coding session"
        : "Coding practice"
    : item.activity === "complexity"
      ? "Written complexity recall"
      : "Written approach recall";
}
function AllocationEditor({
  item,
  disabled,
  onSave,
}: {
  item: PracticePlanItem;
  disabled: boolean;
  onSave: (minutes: number) => Promise<boolean>;
}) {
  const [value, setValue] = useState(String(item.timeboxMinutes));
  return (
    <form
      className={styles.allocationEditor}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(Number(value));
      }}
    >
      <label>
        Activity timebox
        <span className={styles.minuteInput}>
          <input
            type="number"
            min={5}
            max={180}
            step={1}
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled}
          />
          <span>minutes</span>
        </span>
      </label>
      <button type="submit" className="button secondary" disabled={disabled}>
        Save timebox
      </button>
      <p className="small muted">
        A time allocation you can edit. An unfinished attempt is still valid
        practice; this does not predict how long solving will take.
      </p>
    </form>
  );
}
export function Today() {
  const {
    data,
    savedData,
    mode,
    setMode,
    startPlanSession,
    setAddOpen,
    update,
    retryLocalSave,
    guardWorkspace,
    storagePending,
    storageError,
    localDay,
  } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [actionError, setActionError] = useState("");
  const [availabilityDraft, setAvailabilityDraft] = useState<string | null>(
    null,
  );
  const [deferUntil, setDeferUntil] = useState(
    localDate(addDays(new Date(), 1)),
  );
  const [restartDismissed, setRestartDismissed] = useState(false);
  // Completion belongs to committed records. A failed reflection remains a
  // recoverable preview until saving succeeds, rather than advancing this plan.
  const planData = storagePending || storageError ? savedData : data;
  const view = practicePlanView(planData);
  const { plan, primary } = view;
  const preferences = practicePreferences(data);
  const resolved = primary ? resolvePlanProblem(planData, primary) : null;
  const active = planData.session;
  const usualMinutes = preferences.dailyMinutes;
  const budget = plan?.budgetMinutes ?? usualMinutes;
  const availability = availabilityDraft ?? String(budget);
  const disabled = busy || storagePending || !!storageError;
  const breakthrough = breakthroughs(planData)[0];
  const now = new Date();
  const trackContext = primary?.trackContext;
  const stageHref =
    trackContext &&
    data.trackStages?.some(
      (stage) =>
        stage.id === trackContext.stageId &&
        stage.trackId === trackContext.trackId,
    )
      ? `/tracks/${encodeURIComponent(trackContext.trackId)}/stages/${encodeURIComponent(trackContext.stageId)}`
      : null;
  const sameProblemDue =
    primary &&
    (primary.activity === "coding"
      ? primary.relatedRecallAt
      : primary.relatedCodingAt);
  const alternativeCandidates = view.candidates.filter(
    (candidate) =>
      candidate.kind !== "session" &&
      candidate.key !== primary?.candidateKey &&
      !view.remaining.some((item) => item.identity === candidate.identity),
  );
  const sourceTimeSuggestion = view.candidates.find(
    (candidate) => candidate.key === primary?.candidateKey,
  )?.sourceTimeSuggestion;
  const hasEligibleExtra = view.candidates.some(
    (candidate) =>
      candidate.kind !== "session" &&
      !plan?.items.some(
        (item) =>
          item.status !== "stale" && item.identity === candidate.identity,
      ),
  );
  const discoveryDuration: Duration =
    budget <= 15 ? 15 : budget <= 30 ? 30 : 60;
  const overBudget =
    primary &&
    primary.timeboxMinutes >
      Math.max(
        0,
        budget -
          view.completed.reduce((sum, item) => sum + item.timeboxMinutes, 0),
      );
  const changed = plan?.items.filter((item) => item.status === "stale") ?? [];

  async function perform(operation: () => Promise<boolean>) {
    if (actionLock.current || storagePending) return false;
    const isCurrent = guardWorkspace();
    actionLock.current = true;
    setBusy(true);
    setActionError("");
    try {
      const saved = await operation();
      if (!isCurrent()) return false;
      if (!saved)
        setActionError(
          "This change was not committed. Your plan and edits remain recoverable in this tab. Retry saving before starting or continuing.",
        );
      return saved;
    } catch (failure) {
      if (isCurrent())
        setActionError(
          failure instanceof Error
            ? failure.message
            : "The plan could not be saved. Your edits remain here.",
        );
      return false;
    } finally {
      actionLock.current = false;
      if (isCurrent()) setBusy(false);
    }
  }
  async function changePlan(fn: (current: Data) => Data) {
    return perform(() => (storageError ? retryLocalSave(fn) : update(fn)));
  }
  async function saveAvailability(minutes = Number(availability)) {
    const saved = await changePlan((current) =>
      setPlanAvailability(current, minutes),
    );
    if (saved) setAvailabilityDraft(null);
    return saved;
  }
  async function start() {
    if (!primary || disabled) return;
    await perform(() => startPlanSession(primary.id));
  }
  const primaryAction = active ? (
    disabled ? (
      <button className="button primary" disabled>
        <Play size={15} fill="currentColor" />
        Continue session
        <ArrowRight size={17} />
      </button>
    ) : (
      <Link href="/session" className="button primary">
        <Play size={15} fill="currentColor" />
        Continue session
        <ArrowRight size={17} />
      </Link>
    )
  ) : primary && resolved ? (
    primary.activity === "coding" ? (
      <button
        className="button primary"
        onClick={() => void start()}
        disabled={disabled}
      >
        <Play size={15} fill="currentColor" />
        Start session
        <ArrowRight size={17} />
      </button>
    ) : disabled ? (
      <button className="button primary" disabled>
        Start recall check
        <ArrowRight size={17} />
      </button>
    ) : (
      <Link
        className="button primary"
        href={`/problems/${encodeURIComponent(primary.problemId)}?from=%2F&revision=${primary.activity}`}
      >
        Start recall check
        <ArrowRight size={17} />
      </Link>
    )
  ) : (plan?.status === "ended" &&
      (view.remaining.length > 0 || hasEligibleExtra)) ||
    ((plan?.items.length ?? 0) > 0 && hasEligibleExtra) ? (
    <button
      className="button primary"
      disabled={disabled}
      onClick={() =>
        void changePlan((current) => continuePracticePlan(current))
      }
    >
      Continue with an optional extra
      <ArrowRight size={17} />
    </button>
  ) : !view.preferredDay && view.candidates.length ? (
    <button
      className="button primary"
      disabled={disabled}
      onClick={() => void saveAvailability()}
    >
      Make room for practice today
      <ArrowRight size={17} />
    </button>
  ) : (
    <button
      className="button primary"
      onClick={() => setAddOpen(true)}
      disabled={busy || storagePending}
    >
      <Plus size={17} />
      {data.problems.length ? "Add a problem" : "Add my first problem"}
      <ArrowRight size={17} />
    </button>
  );

  return (
    <div className="today-page page-enter">
      <header
        className={`today-header ${data.problems.length ? "returning" : ""}`}
      >
        <div className="eyebrow">
          <span className="small-line" />
          {now
            .toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "2-digit",
            })
            .toUpperCase()}
        </div>
        {data.problems.length ? (
          <h1>
            {data.settings.displayName
              ? `Welcome back, ${data.settings.displayName}.`
              : "A little practice today."}
          </h1>
        ) : (
          <h1>
            A little sharper,
            <br />
            <em>every day.</em>
          </h1>
        )}
        <p>A small plan. One activity at a time.</p>
        <span className="header-side-note">
          THE ART OF
          <br />
          SHOWING UP<span>01 — DAILY PRACTICE</span>
        </span>
      </header>
      <div className="today-grid">
        <div className="today-primary">
          <section
            className={styles.availability}
            aria-label="Today's availability"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveAvailability();
              }}
            >
              <label>
                Today I have…
                <span className={styles.minuteInput}>
                  <input
                    name="availableMinutes"
                    type="number"
                    min={5}
                    max={180}
                    step={1}
                    required
                    value={availability}
                    onChange={(event) =>
                      setAvailabilityDraft(event.target.value)
                    }
                    disabled={busy || storagePending}
                  />
                  <span>minutes</span>
                </span>
              </label>
              <button
                type="submit"
                className="button secondary"
                disabled={busy || storagePending}
              >
                {busy ? "Saving…" : "Apply today’s time"}
              </button>
            </form>
            <div className={styles.availabilityNote}>
              <span>
                Usual budget: {usualMinutes} min
                {plan?.availabilityOverride ? " · today only" : ""}
              </span>
              {plan?.availabilityOverride && budget !== usualMinutes && (
                <button
                  className="text-link"
                  disabled={busy || storagePending}
                  onClick={() => void saveAvailability(usualMinutes)}
                >
                  Use usual time
                </button>
              )}
            </div>
            {!view.preferredDay && (
              <p className="small muted">
                Today is outside your preferred practice days. You can still
                choose a small session.
              </p>
            )}
            {view.timezoneChanged && (
              <p className="small muted">
                Your timezone changed. This local day’s selections stay in
                place; an active session continues.
              </p>
            )}
          </section>
          {view.restart && !restartDismissed && !active && (
            <section className={styles.restart} aria-label="A gentle return">
              <Leaf size={20} aria-hidden="true" />
              <div>
                <p>Welcome back. Start with one short session?</p>
                <span className="small muted">
                  Your last saved practice was{" "}
                  {shortDate(view.restart.lastPractisedAt)}. Your learning
                  history is kept as it is.
                </span>
                <div className={styles.restartActions}>
                  <button
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => void saveAvailability(15)}
                  >
                    Make today 15 minutes
                  </button>
                  <button
                    className="text-link"
                    onClick={() => setRestartDismissed(true)}
                    disabled={busy}
                  >
                    Continue normally
                  </button>
                </div>
              </div>
            </section>
          )}
          <section
            className={`session-card ${styles.primaryCard}`}
            aria-labelledby="session-card-title"
            data-practice-plan={plan?.id}
          >
            <div className="session-card-top">
              <span className="eyebrow">
                <span className="green-square" />
                {active ? "YOUR SESSION IS WAITING" : "MY PRACTICE PLAN"}
              </span>
              <span className="card-number mono">
                {plan?.status === "ended" ? "ENDED FOR TODAY" : "01 / NEXT"}
              </span>
            </div>
            <div className="session-card-content">
              <div>
                {primary && resolved ? (
                  <>
                    <div className="focus-kind">
                      <RotateCcw size={13} />
                      {activityLabel(primary).toUpperCase()}
                    </div>
                    <h2 id="session-card-title">
                      {active
                        ? "Continue "
                        : primary.activity !== "coding"
                          ? "Recall "
                          : primary.kind === "coding"
                            ? "Revisit "
                            : "Explore "}
                      <span>{resolved.problem.title}</span>
                    </h2>
                    <div className="problem-meta">
                      <span>{resolved.problem.platform}</span>
                      {resolved.problem.problemCode && (
                        <span className="mono">
                          #{resolved.problem.problemCode}
                        </span>
                      )}
                      {resolved.problem.rating !== null && (
                        <span className="mono">
                          {resolved.problem.rating} rating
                        </span>
                      )}
                    </div>
                    <p className="suggestion-reason">{primary.reason}</p>
                    <p className={styles.allocation}>
                      <Clock3 size={14} />
                      <span>
                        {active?.targetMinutes ?? primary.timeboxMinutes} min{" "}
                        {active ? "session timebox" : "planned timebox"}
                      </span>
                    </p>
                    <p className={`small muted ${styles.timeHonesty}`}>
                      An allocation for practice, rather than a prediction of
                      solving time.
                    </p>
                    {sourceTimeSuggestion && (
                      <p className={`small muted ${styles.timeHonesty}`}>
                        Source time suggestion: {sourceTimeSuggestion}. This is
                        guidance from your sheet; measured duration comes from
                        recorded timed sessions.
                      </p>
                    )}
                    {trackContext && (
                      <div className="today-track-context">
                        {stageHref ? (
                          <Link className="text-link" href={stageHref}>
                            {trackContext.trackTitle} ·{" "}
                            {trackContext.stageTitle}
                          </Link>
                        ) : (
                          <p className="small muted">
                            {trackContext.trackTitle} ·{" "}
                            {trackContext.stageTitle}
                          </p>
                        )}
                      </div>
                    )}
                    {sameProblemDue && sameProblemDue <= localDay && (
                      <p className={`small muted ${styles.relatedSchedule}`}>
                        {primary.activity === "coding"
                          ? "Written recall is also due for this problem. It keeps its separate schedule and is left in your backlog."
                          : "A coding reattempt is also due for this problem. It keeps its separate schedule and is left in your backlog."}
                      </p>
                    )}
                    <details className={styles.evidence}>
                      <summary>Why this activity?</summary>
                      <ul>
                        {primary.evidence.map((evidence, index) => (
                          <li
                            key={`${evidence.type}:${evidence.recordId ?? index}`}
                          >
                            {evidence.type === "track" && stageHref ? (
                              <Link href={stageHref}>
                                {evidence.label}
                                <ArrowUpRight size={13} />
                              </Link>
                            ) : resolved.fresh ? (
                              <span>{evidence.label}</span>
                            ) : (
                              <Link
                                href={memoryHref(
                                  planData,
                                  primary,
                                  evidence.recordId,
                                  evidence.type,
                                )}
                              >
                                {evidence.label}
                                <ArrowUpRight size={13} />
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                      {primary.relatedCodingAt && (
                        <p className="small muted">
                          Coding date: {shortDate(primary.relatedCodingAt)}
                        </p>
                      )}
                      {primary.relatedRecallAt && (
                        <p className="small muted">
                          Written recall date:{" "}
                          {shortDate(primary.relatedRecallAt)}
                        </p>
                      )}
                      {!resolved.fresh && (
                        <Link
                          className="text-link"
                          href={memoryHref(planData, primary)}
                        >
                          View Learning Memory
                          <ArrowUpRight size={14} />
                        </Link>
                      )}
                    </details>
                    {resolved.problem.tags.length > 0 && (
                      <details className={`discovery-tags ${styles.savedTags}`}>
                        <summary>Reveal topic tags</summary>
                        <p className="small muted">
                          {resolved.problem.tags.join(" · ")}
                        </p>
                      </details>
                    )}
                  </>
                ) : (
                  <>
                    <div className="focus-kind">
                      <Leaf size={14} />
                      {plan?.status === "ended" || view.completed.length
                        ? "ROOM TO REST, OR CONTINUE"
                        : "GOOD THINGS BEGIN SMALL"}
                    </div>
                    <h2 id="session-card-title">
                      {plan?.status === "ended" ? (
                        <>
                          Today’s plan is
                          <br />
                          <em>set aside.</em>
                        </>
                      ) : view.completed.length ? (
                        <>
                          You made room
                          <br />
                          <em>for practice.</em>
                        </>
                      ) : (
                        <>
                          Your next chapter
                          <br />
                          <em>starts here.</em>
                        </>
                      )}
                    </h2>
                    <p className="suggestion-reason">
                      {plan?.status === "ended"
                        ? "Ending a plan keeps your recorded activity and pending choices. It does not mark a problem solved or create a learning result."
                        : view.completed.length
                          ? "Your saved activity is recorded below. You can stop here or deliberately choose another activity."
                          : (plan?.items.length ?? 0) > 0
                            ? "Your previous choices are kept in this plan. Choose an optional extra when useful, or stop here. A new allocation stays editable before starting."
                            : !view.preferredDay
                              ? "An open day outside your usual rhythm. Choose today’s availability if you want to practise."
                              : "Add a problem, choose from your collection, or find a fresh alternative below. Your first plan starts from real practice."}
                    </p>
                  </>
                )}
              </div>
              <PracticeIllustration empty={!primary} />
            </div>
            {overBudget && !active && (
              <div className={styles.budgetNotice}>
                <p className="small">
                  This timebox exceeds the remaining planned budget. Choose a
                  shorter timebox below, or keep this longer allocation
                  deliberately. Completion is never promised within the budget.
                </p>
              </div>
            )}
            <div className="session-card-actions">
              {primaryAction}
              <Link href="/problems" className="quiet-action">
                {data.problems.length
                  ? "Choose my own problem"
                  : "Choose from my problems"}
                <ArrowUpRight size={15} />
              </Link>
            </div>
            {primary && !active && (
              <details className={styles.planOptions}>
                <summary>Adjust this suggestion</summary>
                <AllocationEditor
                  key={primary.id}
                  item={primary}
                  disabled={disabled}
                  onSave={(minutes) =>
                    changePlan((current) =>
                      setPlanTimebox(current, primary.id, minutes),
                    )
                  }
                />
                <div className={styles.choiceActions}>
                  <button
                    className="text-link"
                    disabled={disabled}
                    onClick={() =>
                      void changePlan((current) =>
                        decidePlanItem(current, primary.id, "skip"),
                      )
                    }
                  >
                    Skip today’s recommendation
                  </button>
                  <details>
                    <summary>Defer deliberately</summary>
                    <form
                      className={styles.deferForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void changePlan((current) =>
                          decidePlanItem(
                            current,
                            primary.id,
                            "defer",
                            deferUntil,
                          ),
                        );
                      }}
                    >
                      <label>
                        Try again on
                        <input
                          type="date"
                          min={localDate(addDays(new Date(), 1))}
                          required
                          value={deferUntil}
                          disabled={disabled}
                          onChange={(event) =>
                            setDeferUntil(event.target.value)
                          }
                        />
                      </label>
                      <button
                        type="submit"
                        className="button secondary"
                        disabled={disabled}
                      >
                        Save deferral
                      </button>
                    </form>
                  </details>
                </div>
                <details className={styles.replace}>
                  <summary>Replace with another eligible activity</summary>
                  <p className="small muted">
                    Choosing an alternative changes this pending suggestion.
                    Other recorded activity stays intact.
                  </p>
                  {alternativeCandidates.length ? (
                    <ul>
                      {alternativeCandidates.map((candidate) => (
                        <li key={candidate.key}>
                          <div>
                            <strong>{candidate.problem.title}</strong>
                            <span>
                              {candidate.activity === "coding"
                                ? "Coding"
                                : "Written recall"}{" "}
                              · {candidate.reason}
                            </span>
                          </div>
                          <button
                            className="button secondary"
                            disabled={disabled}
                            onClick={() =>
                              void changePlan((current) =>
                                replacePlanItem(
                                  current,
                                  primary.id,
                                  candidate.key,
                                ),
                              )
                            }
                            aria-label={`Choose for today: ${candidate.problem.title} (${candidate.activity === "coding" ? "coding" : "written recall"})`}
                          >
                            Choose for today
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="small muted">
                      No other eligible activities right now. You can choose a
                      problem manually.
                    </p>
                  )}
                </details>
              </details>
            )}
          </section>
          {(actionError || storageError) && (
            <div className={`form-error ${styles.actionError}`} role="alert">
              <p>
                {actionError ||
                  "This tab contains unsaved changes. Plan completion and the next action stay on the last saved records until saving succeeds."}
              </p>
              <div className={styles.choiceActions}>
                <button
                  className="button secondary"
                  onClick={() => void perform(() => retryLocalSave())}
                  disabled={busy || storagePending}
                >
                  Retry saving plan
                </button>
                <Link href="/settings" className="text-link">
                  Review saving &amp; recovery
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            </div>
          )}
          {plan?.status === "active" && (
            <div className={styles.planLifecycle}>
              <span className="small muted">
                {view.allocatedMinutes} of {budget} min allocated
                {view.completed.length
                  ? ` · ${view.completed.length} saved activit${view.completed.length === 1 ? "y" : "ies"}`
                  : ""}
              </span>
              <button
                className="text-link muted"
                onClick={() =>
                  void changePlan((current) => endPracticePlan(current))
                }
                disabled={disabled}
              >
                End today’s plan
              </button>
              {active && (
                <span className="small muted">
                  Ending this plan leaves your unfinished session available.
                  Midnight never interrupts it.
                </span>
              )}
            </div>
          )}
          {!!view.remaining.length && plan?.status === "active" && (
            <section
              className={styles.nextList}
              aria-labelledby="plan-next-title"
            >
              <div className="section-heading">
                <h2 id="plan-next-title">Then, if time remains</h2>
                <span className="mono tiny">
                  {view.remaining.length} OPTIONAL
                </span>
              </div>
              <ol>
                {view.remaining.map((item, index) => {
                  const itemProblem = resolvePlanProblem(planData, item);
                  return (
                    <li key={item.id}>
                      <span className="mono">0{index + 2}</span>
                      <div>
                        <strong>
                          {itemProblem?.problem.title ??
                            "Previously selected activity"}
                        </strong>
                        <span>
                          {activityLabel(item)} · {item.timeboxMinutes} min
                          allocated
                        </span>
                        <p>{item.reason}</p>
                        {!itemProblem?.fresh && (
                          <Link
                            href={memoryHref(planData, item)}
                            className="text-link"
                          >
                            View supporting history
                            <ArrowUpRight size={13} />
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          {!!view.completed.length && (
            <details className={styles.planHistory}>
              <summary>
                Saved activity in this plan · {view.completed.length}
              </summary>
              <ul>
                {view.completed.map((item) => {
                  const itemProblem = resolvePlanProblem(planData, item);
                  return (
                    <li key={item.id}>
                      <Check size={16} aria-hidden="true" />
                      <div>
                        <strong>
                          {itemProblem?.problem.title ?? "Recorded practice"}
                        </strong>
                        <p className="small muted">
                          {item.activity === "coding"
                            ? "Saved coding activity"
                            : "Saved written recall"}{" "}
                          ·{" "}
                          {item.completion
                            ? shortDate(item.completion.completedAt)
                            : ""}
                        </p>
                        <Link
                          className="text-link"
                          href={memoryHref(
                            planData,
                            item,
                            item.completion?.recordId,
                          )}
                        >
                          View saved record
                          <ArrowUpRight size={13} />
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="small muted">
                Participation is recorded from saved activity. Outcomes and
                measured timed duration remain in the original history.
              </p>
            </details>
          )}
          {(changed.length > 0 || !!plan?.messages.length) && (
            <details className={styles.planHistory}>
              <summary>Plan updates</summary>
              <ul>
                {[
                  ...(plan?.messages ?? []),
                  ...changed.map(
                    (item) =>
                      item.changeReason ??
                      "A pending activity changed and was revalidated.",
                  ),
                ].map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </details>
          )}
          <Link href="/revisit" className={`text-link ${styles.backlog}`}>
            <RotateCcw size={14} />
            Full revision backlog
            {view.backlogCount > 0
              ? ` · ${view.backlogCount} due problem${view.backlogCount === 1 ? "" : "s"}`
              : ""}
            <ArrowUpRight size={15} />
          </Link>
          <PracticePlanPreferences compact />
          <FreshDiscovery duration={discoveryDuration} secondary />
          {!data.problems.length && mode !== "demo" && (
            <button className="quiet-action" onClick={() => setMode("demo")}>
              Explore the demo
              <ArrowUpRight size={15} />
            </button>
          )}
          <TodayActivity />
        </div>
        <aside className={`today-support ${styles.support}`}>
          <WeeklyRhythm />
          <section className="breakthrough-section">
            <div className="section-heading">
              <h2>A small breakthrough</h2>
              <Sparkles size={16} strokeWidth={1.4} />
            </div>
            {breakthrough ? (
              <>
                <div className="breakthrough-icon">
                  <Leaf size={24} strokeWidth={1.3} />
                </div>
                <p className="breakthrough-copy">
                  You found your
                  <br />
                  <em>own way through.</em>
                </p>
                <strong className="breakthrough-problem">
                  {breakthrough.problem.title}
                </strong>
                <p className="small muted">
                  Solved independently after an earlier assisted or unfinished
                  attempt.
                </p>
                <div className="breakthrough-date">
                  <Check size={13} />
                  Independent solve ·{" "}
                  {shortDate(breakthrough.attempt.completedAt)}
                </div>
              </>
            ) : (
              <>
                <div className="breakthrough-icon">
                  <Leaf size={24} strokeWidth={1.3} />
                </div>
                <p className="breakthrough-copy">
                  Understanding
                  <br />
                  <em>takes a little time.</em>
                </p>
                <p className="small muted">
                  When a problem that once felt difficult starts to click, we’ll
                  keep that moment here.
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
      <div className="today-bottom">
        <span className="eyebrow">YOUR PRACTICE NOTEBOOK</span>
        <div>
          <span>
            <strong className="mono">
              {String(visibleProblems(data).length).padStart(2, "0")}
            </strong>{" "}
            problems collected
          </span>
          <span>
            <strong className="mono">
              {String(data.attempts.length).padStart(2, "0")}
            </strong>{" "}
            timed sessions reflected on
          </span>
          <span className="notebook-note">
            <span className="status-dot" />
            {mode === "demo"
              ? "Sample data · separate from your own"
              : "Yours, on this device"}
          </span>
        </div>
      </div>
    </div>
  );
}
