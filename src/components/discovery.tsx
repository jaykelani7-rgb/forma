"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Compass,
  Play,
  RefreshCw,
} from "lucide-react";
import {
  automaticPracticeEligible,
  Duration,
  localDate,
  Problem,
  reviewQueue,
  uid,
} from "@/lib/model";
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
import { useWorkspace } from "./provider";

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

export function FreshDiscovery({ duration }: { duration: Duration }) {
  const { data, update, startSession, notify } = useWorkspace();
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
        automaticPracticeEligible(problem) &&
        problem.reviewAt !== null &&
        problem.reviewAt <= localDate(),
    ) ?? null;
  const composition = composePractice(duration, due, fresh);
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

  const selectedKey = fresh?.problem.key;
  useEffect(() => {
    if (!selectedKey) return;
    const retained = retainFreshSelection(preferences, selectedKey);
    if (
      preferences.selectedKey === retained.selectedKey &&
      preferences.selectedOn === retained.selectedOn
    )
      return;
    update((current) => ({
      ...current,
      discovery: retainFreshSelection(
        current.discovery ?? defaultDiscovery(),
        selectedKey,
      ),
    }));
  }, [selectedKey, preferences, update]);

  function savePreferences(next: DiscoveryPreferences) {
    update((current) => ({ ...current, discovery: next }));
  }
  function applyPreferences(form: HTMLFormElement) {
    const values = new FormData(form);
    try {
      const next = validateDiscovery({
        ...preferences,
        minRating: Number(values.get("minRating")),
        maxRating: Number(values.get("maxRating")),
        topic: String(values.get("topic") ?? ""),
        selectedKey: null,
        selectedOn: null,
      });
      savePreferences(next);
      setFormError("");
      notify("Discovery preferences saved.");
    } catch {
      setFormError(
        "Choose a minimum and maximum from 0 to 10,000, with the minimum no higher than the maximum.",
      );
    }
  }
  function dismiss(reason: "another" | "difficult" | "not_today") {
    if (!fresh) return;
    savePreferences(
      dismissFreshSuggestion(preferences, fresh.problem.key, reason),
    );
    notify(
      reason === "not_today"
        ? "Skipped for today. It can return on another day."
        : reason === "difficult"
          ? "Kept out of suggestions for two weeks. Adjust your range whenever useful."
          : "A different problem, with the previous one set aside for a week.",
    );
  }
  function startFresh() {
    if (!fresh) return;
    const problem: Problem = catalogueProblemToSaved(fresh.problem, uid());
    update((current) => ({
      ...current,
      problems: [...current.problems, problem],
    }));
    startSession(problem, duration);
  }
  async function retry() {
    setLoading(true);
    setError("");
    try {
      setCatalogue(await getCatalogue());
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The catalogue could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className="cf-card discovery-card"
      aria-labelledby="discovery-title"
    >
      <div className="section-heading">
        <h2 id="discovery-title">
          <Compass size={17} /> Choose your next problem
        </h2>
        <span className="mono tiny">{duration} MIN</span>
      </div>
      <p className="small muted">{composition.explanation}</p>
      <details className="discovery-controls">
        <summary>Difficulty &amp; optional topic focus</summary>
        <form
          key={`${preferences.minRating}:${preferences.maxRating}:${preferences.topic}`}
          onSubmit={(event) => {
            event.preventDefault();
            applyPreferences(event.currentTarget);
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
                defaultValue={preferences.minRating}
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
                defaultValue={preferences.maxRating}
                required
              />
            </label>
          </div>
          <label className="field-label">
            Topic focus
            <select name="topic" defaultValue={preferences.topic}>
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
          <button className="button secondary" type="submit">
            Apply preferences
          </button>
        </form>
      </details>
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
      {duration === 15 && due ? (
        <div className="discovery-problem">
          <span className="eyebrow">A FAMILIAR REVISIT</span>
          <h3>{due.title}</h3>
          <p className="small muted">
            Your revisit is due. One familiar problem is enough for this short
            session.
          </p>
          <button
            className="button primary"
            onClick={() => startSession(due, duration)}
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
          <p className="small muted">{fresh.reason}</p>
          <details className="discovery-tags">
            <summary>Reveal topic tags</summary>
            <p className="small muted">
              {fresh.problem.tags.join(" · ") || "No published tags."}
            </p>
          </details>
          {duration === 60 && due && (
            <div className="discovery-plan">
              <span className="small">
                Suggested order: revisit <strong>{due.title}</strong>, then this
                fresh problem if time remains.
              </span>
              <button
                className="quiet-action"
                onClick={() => startSession(due, duration)}
              >
                Start with the revisit
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          <div className="discovery-actions">
            <button
              className="button primary"
              onClick={startFresh}
              disabled={!!data.session}
            >
              <Play size={14} />
              {duration === 60 && due
                ? "Start fresh instead"
                : "Start fresh practice"}
              <ArrowRight size={15} />
            </button>
            <button
              className="button secondary"
              onClick={() => dismiss("another")}
            >
              Another suggestion
            </button>
            <button
              className="quiet-action"
              onClick={() => dismiss("difficult")}
            >
              Too difficult
            </button>
            <button
              className="quiet-action"
              onClick={() => dismiss("not_today")}
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
            . It is reused for 24 hours. Selection uses your range and optional
            topic; explanations are generic. Known accepted problems, saved
            problems, and recent dismissals are excluded. Tags stay hidden until
            requested. A catalogue rating does not predict your solve time.
          </p>
        </details>
      )}
    </section>
  );
}
