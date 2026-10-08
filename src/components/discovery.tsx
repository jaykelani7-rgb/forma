"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Compass,
  Play,
  RefreshCw,
} from "lucide-react";
import { Duration, localDate, Problem, reviewQueue, uid } from "@/lib/model";
import { sharedPracticeState } from "@/lib/practice-state";
import {
  catalogueProblemToSaved,
  catalogueTopics,
  composePractice,
  defaultDiscovery,
  dismissFreshSuggestion,
  DiscoveryPreferences,
  ProblemCatalogue,
  retainFreshSelection,
  selectFreshProblem,
  validateCatalogue,
  validateDiscovery,
} from "@/lib/discovery";
import Link from "next/link";
import { useWorkspace } from "./provider";
import styles from "./today-discovery.module.css";

// Public data only. Client navigations reuse the catalogue instead of refetching
// it on every Today visit; the server separately caches the upstream for 24h.
let cachedCatalogue: ProblemCatalogue | null = null;
let catalogueRequest: Promise<ProblemCatalogue> | null = null;
async function getCatalogue(): Promise<ProblemCatalogue> {
  if (
    cachedCatalogue &&
    Date.now() - Date.parse(cachedCatalogue.fetchedAt) < 24 * 60 * 60 * 1000
  )
    return cachedCatalogue;
  if (catalogueRequest) return catalogueRequest;
  catalogueRequest = (async () => {
    try {
      const response = await fetch("/api/catalogue", {
        signal: AbortSignal.timeout(30000),
        credentials: "omit",
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error("Unavailable catalogue");
      cachedCatalogue = validateCatalogue(body);
      return cachedCatalogue;
    } catch {
      throw new Error(
        "Fresh discovery is unavailable right now. Your saved problems and revisits are still available.",
      );
    }
  })();
  try {
    return await catalogueRequest;
  } finally {
    catalogueRequest = null;
  }
}

export function FreshDiscovery({
  duration,
  secondary = false,
}: {
  duration: Duration;
  secondary?: boolean;
}) {
  const {
    data,
    update,
    startSession,
    startFreshSession,
    notify,
    guardWorkspace,
  } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<
    "selection" | "preferences" | "dismiss" | "start" | null
  >(null);
  const actionLock = useRef(false);
  const selectionAttempt = useRef("");
  const [actionError, setActionError] = useState("");
  const [catalogue, setCatalogue] = useState<ProblemCatalogue | null>(
    cachedCatalogue,
  );
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(!cachedCatalogue);
  const preferences = useMemo(
    () => data.discovery ?? defaultDiscovery(),
    [data.discovery],
  );
  const selection = catalogue
    ? selectFreshProblem(catalogue, data, preferences)
    : null;
  const fresh = selection?.recommendation ?? null;
  const due =
    reviewQueue(data).find(
      (problem) =>
        sharedPracticeState(data, problem).eligible &&
        problem.reviewAt !== null &&
        problem.reviewAt <= localDate(),
    ) ?? null;
  const composition = composePractice(duration, secondary ? null : due, fresh);
  const topics = useMemo(
    () => (catalogue ? catalogueTopics(catalogue) : []),
    [catalogue],
  );

  useEffect(() => {
    let mounted = true;
    getCatalogue()
      .then((result) => {
        if (mounted) {
          setCatalogue(result);
          setError("");
        }
      })
      .catch((error) => {
        if (mounted)
          setError(
            error instanceof Error
              ? error.message
              : "The catalogue could not be loaded.",
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const [draft, setDraft] = useState(() => ({
    minRating: String(preferences.minRating),
    maxRating: String(preferences.maxRating),
    topic: preferences.topic,
  }));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setDraft({
      minRating: String(preferences.minRating),
      maxRating: String(preferences.maxRating),
      topic: preferences.topic,
    });
  }, [preferences.minRating, preferences.maxRating, preferences.topic, dirty]);

  const recoveryMessage =
    "This change could not be saved. Your draft is kept here. Review the storage message and recovery copies, or export this workspace before restoring saving.";
  const selectedKey = fresh?.problem.key;
  useEffect(() => {
    if (data.session || !selectedKey || pending || actionLock.current) return;
    const retained = retainFreshSelection(preferences, selectedKey);
    if (
      preferences.selectedKey === retained.selectedKey &&
      preferences.selectedOn === retained.selectedOn
    )
      return;
    // One attempt per selection and local day. A failed merge must not launch
    // an automatic retry loop or continually replace another tab's selection.
    const identity = `${retained.selectedOn}:${selectedKey}:${preferences.minRating}:${preferences.maxRating}:${preferences.topic}`;
    if (selectionAttempt.current === identity) return;
    selectionAttempt.current = identity;
    const isCurrent = guardWorkspace();
    actionLock.current = true;
    setPending("selection");
    void (async () => {
      try {
        const saved = await update((current) => ({
          ...current,
          discovery: retainFreshSelection(
            current.discovery ?? defaultDiscovery(),
            selectedKey,
          ),
        }));
        if (isCurrent() && !saved) setActionError(recoveryMessage);
      } catch {
        if (isCurrent()) setActionError(recoveryMessage);
      } finally {
        if (isCurrent()) {
          actionLock.current = false;
          setPending(null);
        }
      }
    })();
  }, [data.session, selectedKey, preferences, update, guardWorkspace, pending]);

  async function perform(
    kind: "preferences" | "dismiss" | "start",
    operation: () => Promise<boolean>,
    success?: string,
  ) {
    if (actionLock.current) return false;
    const isCurrent = guardWorkspace();
    actionLock.current = true;
    setPending(kind);
    setActionError("");
    try {
      const saved = await operation();
      if (!isCurrent()) return false;
      if (!saved) {
        setActionError(recoveryMessage);
        return false;
      }
      if (success) notify(success);
      return true;
    } catch {
      if (isCurrent()) setActionError(recoveryMessage);
      return false;
    } finally {
      if (isCurrent()) {
        actionLock.current = false;
        setPending(null);
      }
    }
  }
  async function applyPreferences() {
    let next: DiscoveryPreferences;
    try {
      next = validateDiscovery({
        ...preferences,
        minRating: Number(draft.minRating),
        maxRating: Number(draft.maxRating),
        topic: draft.topic,
        selectedKey: null,
        selectedOn: null,
      });
    } catch {
      setFormError(
        "Choose a minimum and maximum from 0 to 10,000, with the minimum no higher than the maximum.",
      );
      return;
    }
    setFormError("");
    const isCurrent = guardWorkspace();
    const saved = await perform(
      "preferences",
      () =>
        update((current) => ({
          ...current,
          discovery: {
            ...(current.discovery ?? defaultDiscovery()),
            minRating: next.minRating,
            maxRating: next.maxRating,
            topic: next.topic,
            selectedKey: null,
            selectedOn: null,
          },
        })),
      "Discovery preferences saved.",
    );
    if (saved && isCurrent()) setDirty(false);
  }
  async function dismiss(reason: "another" | "difficult" | "not_today") {
    if (!fresh) return;
    const key = fresh.problem.key;
    await perform(
      "dismiss",
      () =>
        update((current) => ({
          ...current,
          discovery: dismissFreshSuggestion(
            current.discovery ?? defaultDiscovery(),
            key,
            reason,
          ),
        })),
      reason === "not_today"
        ? "Skipped for today. It can return on another day."
        : reason === "difficult"
          ? "Kept out of suggestions for two weeks. Adjust your range whenever useful."
          : "A different problem, with the previous one set aside for a week.",
    );
  }
  async function startFresh() {
    if (!fresh) return;
    const problem: Problem = catalogueProblemToSaved(fresh.problem, uid());
    await perform("start", () => startFreshSession(problem, duration));
  }
  async function startRevisit() {
    if (due) await perform("start", () => startSession(due, duration));
  }
  async function retry() {
    if (loading) return;
    const isCurrent = guardWorkspace();
    setLoading(true);
    setError("");
    try {
      const result = await getCatalogue();
      if (isCurrent()) setCatalogue(result);
    } catch (error) {
      if (isCurrent())
        setError(
          error instanceof Error
            ? error.message
            : "The catalogue could not be loaded.",
        );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  return (
    <details
      className={`${styles.alternative} ${secondary ? styles.secondaryDiscovery : styles.primaryDiscovery}`}
      open={!secondary || expanded || !!actionError}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary hidden={!secondary} className={styles.alternativeSummary}>
        Fresh practice &amp; discovery filters
        <ArrowRight size={15} aria-hidden="true" />
      </summary>
      <section
        className={`cf-card discovery-card ${styles.discoveryCard}`}
        aria-labelledby="discovery-title"
      >
        <div className="section-heading">
          <h2 id="discovery-title">
            <Compass size={17} /> Choose your next problem
          </h2>
          <span className="mono tiny">{duration} MIN</span>
        </div>
        <p className="small muted">
          {secondary
            ? duration === 60 && due
              ? "A fresh alternative for after your revisit, if time remains."
              : "Prefer something fresh? Choose an alternative from your rating range."
            : composition.explanation}
        </p>
        <details className="discovery-controls">
          <summary>Difficulty &amp; optional topic focus</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void applyPreferences();
            }}
          >
            <div className="form-row">
              <label className="field-label">
                Minimum rating
                <input
                  type="number"
                  name="minRating"
                  min="0"
                  max="10000"
                  step="100"
                  value={draft.minRating}
                  disabled={pending === "preferences"}
                  onChange={(event) => {
                    setDirty(true);
                    setDraft({ ...draft, minRating: event.target.value });
                  }}
                  required
                />
              </label>
              <label className="field-label">
                Maximum rating
                <input
                  type="number"
                  name="maxRating"
                  min="0"
                  max="10000"
                  step="100"
                  value={draft.maxRating}
                  disabled={pending === "preferences"}
                  onChange={(event) => {
                    setDirty(true);
                    setDraft({ ...draft, maxRating: event.target.value });
                  }}
                  required
                />
              </label>
            </div>
            <label className="field-label">
              Topic focus
              <select
                name="topic"
                value={draft.topic}
                disabled={pending === "preferences"}
                onChange={(event) => {
                  setDirty(true);
                  setDraft({ ...draft, topic: event.target.value });
                }}
              >
                <option value="">Any topic</option>
                {[
                  ...new Set([
                    ...topics,
                    ...(preferences.topic ? [preferences.topic] : []),
                  ]),
                ]
                  .sort()
                  .map((topic) => (
                    <option key={topic} value={topic}>
                      {topic}
                    </option>
                  ))}
              </select>
            </label>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button
              className="button secondary"
              type="submit"
              disabled={!!pending}
            >
              {pending === "preferences"
                ? "Saving preferences…"
                : "Apply preferences"}
            </button>
          </form>
        </details>
        {pending && (
          <p className="small muted" role="status">
            {pending === "start"
              ? "Saving your problem and session…"
              : "Saving discovery changes…"}
          </p>
        )}
        {actionError && (
          <div className="form-error" role="alert">
            <p>{actionError}</p>
            <Link className="text-link" href="/settings">
              Review saving &amp; recovery
              <ArrowUpRight size={14} />
            </Link>
          </div>
        )}
        {loading && (
          <p className="small muted" role="status">
            Loading the cached public problem catalogue…
          </p>
        )}
        {error && (
          <div className="cf-error" role="status">
            <p>{error}</p>
            <button
              className="button secondary"
              onClick={retry}
              disabled={loading}
            >
              <RefreshCw size={14} />
              Try again
            </button>
          </div>
        )}
        {!secondary && duration === 15 && due ? (
          <div className="discovery-problem">
            <span className="eyebrow">A FAMILIAR REVISIT</span>
            <h3>{due.title}</h3>
            <p className="small muted">
              Your revisit is due. One familiar problem is enough for this short
              session.
            </p>
            <button
              className="button primary"
              onClick={() => void startRevisit()}
              disabled={!!pending}
            >
              <Play size={14} />
              Start this revisit
              <ArrowRight size={15} />
            </button>
          </div>
        ) : fresh ? (
          <div className="discovery-problem">
            <span className="eyebrow">FRESH CODEFORCES PRACTICE</span>
            <h3>{fresh.problem.title}</h3>
            <div className="problem-meta">
              <span className="mono">#{fresh.problem.code}</span>
              <span className="mono">{fresh.problem.rating} rating</span>
              <a
                href={fresh.problem.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link"
              >
                Open problem
                <ArrowUpRight size={13} />
              </a>
            </div>
            <p className="small muted">
              Within your {preferences.minRating}–{preferences.maxRating} rating
              range
              {preferences.topic ? " and chosen topic focus" : ""}.
            </p>
            <details className="discovery-tags">
              <summary>Reveal topic tags</summary>
              <p className="small muted">
                {fresh.problem.tags.join(" · ") || "No published tags."}
              </p>
            </details>
            {duration === 60 && due && (
              <div className="discovery-plan">
                <span className="small">
                  Suggested order: revisit <strong>{due.title}</strong>, then
                  this fresh problem if time remains.
                </span>
                <button
                  className="quiet-action"
                  onClick={() => void startRevisit()}
                  disabled={!!pending}
                >
                  Start with the revisit
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
            <div className="discovery-actions">
              <button
                className={`button ${secondary ? "secondary" : "primary"}`}
                onClick={() => void startFresh()}
                disabled={!!data.session || !!pending}
              >
                <Play size={14} />
                {duration === 60 && due
                  ? "Start fresh instead"
                  : "Start fresh practice"}
                <ArrowRight size={15} />
              </button>
              <button
                className="button secondary"
                onClick={() => void dismiss("another")}
                disabled={!!pending}
              >
                Another suggestion
              </button>
              <button
                className="quiet-action"
                onClick={() => void dismiss("difficult")}
                disabled={!!pending}
              >
                Too difficult
              </button>
              <button
                className="quiet-action"
                onClick={() => void dismiss("not_today")}
                disabled={!!pending}
              >
                Not today
              </button>
            </div>
          </div>
        ) : (
          catalogue && (
            <div className="quiet-empty">
              <Compass size={20} />
              <div>
                <strong>No suitable fresh problem right now.</strong>
                <p>
                  Change the difficulty range or topic, or choose from Problems.
                  Recently dismissed and saved problems stay out of fresh
                  discovery.
                </p>
                {selection && selection.unratedCount > 0 && (
                  <p>
                    {selection.unratedCount} matching unrated problem
                    {selection.unratedCount === 1 ? " is" : "s are"} excluded
                    because a rating range cannot be checked.
                  </p>
                )}
              </div>
            </div>
          )
        )}
        {selection && (
          <p className="section-footnote discovery-coverage">
            {selection.coverageNotice}
          </p>
        )}
        {catalogue && (
          <details className="discovery-help">
            <summary>How discovery works</summary>
            <p className="small muted">
              The public catalogue was fetched{" "}
              {new Date(catalogue.fetchedAt).toLocaleDateString()}
              {catalogue.stale
                ? " and is a saved copy because Codeforces could not refresh it"
                : ""}
              . It is reused for 24 hours. Selection uses your range and
              optional topic; explanations are generic. Known accepted problems,
              saved problems, and recent dismissals are excluded. Tags stay
              hidden until requested. A catalogue rating does not predict your
              solve time.
            </p>
          </details>
        )}
      </section>
    </details>
  );
}
