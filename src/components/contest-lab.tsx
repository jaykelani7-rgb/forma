"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./provider";
import { Modal, PageHeader, ProblemLink } from "./ui";
import { ReflectionMemoryFields } from "./reflection-memory-fields";
import {
  useContestDraft,
  useContestAutosave,
  ContestDraftConflict,
  ContestDraftFeedback,
  type ContestDraftController,
  type ContestDraftPatch,
} from "./contest-drafts";
import { contestDraftScope } from "@/lib/contest-draft-store";
import {
  DIFFICULTIES,
  OUTCOMES,
  clockTime,
  uid,
  type Data,
  type Problem,
} from "@/lib/model";
import {
  activeContest,
  eligibleUpsolves,
  contestScope,
  contestHints,
  createContest,
  reviseContestSetup,
  editContest,
  endContest,
  generateContestProblems,
  queueUpsolve,
  reconcileContests,
  startContest,
  type ContestProblem,
  type ContestReflection,
  type PracticeContest,
} from "@/lib/contest-lab";
import {
  practiceIdentity,
  resolvedPracticeProblems,
} from "@/lib/practice-state";
import { trackProblem } from "@/lib/tracks";
import { validateCatalogue } from "@/lib/discovery";
import { withPracticeSession } from "@/lib/practice-session";
import { verdictLabel } from "@/lib/codeforces";
import styles from "./contest-lab.module.css";

function ContestSaveRecovery() {
  const w = useWorkspace();
  return w.storageError ? (
    <div>
      <p role="alert">{w.storageError}</p>
      <button
        type="button"
        className="button secondary"
        disabled={w.storagePending}
        onClick={() => void w.retryLocalSave()}
      >
        Retry saving contest changes
      </button>
    </div>
  ) : null;
}
type Save = (fn: (d: Data) => Data) => Promise<boolean>;
type ScratchDraft = { notes: string };
export function ContestLab({ contestId }: { contestId?: string }) {
  const w = useWorkspace();
  if (!w.ready) return <p className="muted">Opening Contest Lab…</p>;
  return (
    <ContestWorkspace
      key={`${w.workspaceKey}:${w.data.codeforces.connectedHandle ?? "notebook"}:${contestId ?? "lab"}`}
      contestId={contestId}
    />
  );
}
function ContestWorkspace({ contestId }: { contestId?: string }) {
  const w = useWorkspace(),
    router = useRouter();
  const [create, setCreate] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const scopeGuard = w.guardWorkspace();
  const data = w.storagePending || w.storageError ? w.savedData : w.data;
  const contest = data.contests?.find((c) => c.id === contestId),
    active = activeContest(data);
  async function save(fn: (d: Data) => Data) {
    if (lock.current || !scopeGuard()) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    const guard = scopeGuard;
    try {
      const ok = await w.update(fn);
      if (guard() && !ok)
        setError(
          "This change is not saved. Restore saving before continuing. Your draft is kept in this tab.",
        );
      return ok && guard();
    } catch (e) {
      if (guard())
        setError(
          e instanceof Error ? e.message : "The change could not be saved.",
        );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (contestId && !contest)
    return (
      <div className={styles.page}>
        <Link href="/contests" className="text-link">
          Back to Contest Lab
        </Link>
        <h1>Contest unavailable</h1>
        <p>
          This contest belongs to another workspace or is no longer saved here.
        </p>
      </div>
    );
  return (
    <div className={styles.page}>
      {contest ? (
        <>
          <Link href="/contests" className="text-link">
            ← Contest Lab
          </Link>
          <ContestView
            onEditSetup={() => setCreate(true)}
            contest={contest}
            save={save}
            busy={busy || w.storagePending || !!w.storageError}
          />
        </>
      ) : (
        <>
          <PageHeader
            eyebrow="A PRACTICE CONTEST"
            title="Contest Lab"
            description="A chosen set, a little pressure, and room to learn afterwards."
            action={
              !active ? (
                <button
                  className="button primary"
                  disabled={busy || w.storagePending || !!w.storageError}
                  onClick={() => setCreate(true)}
                >
                  Create a contest
                </button>
              ) : undefined
            }
          />
          {active && (
            <section className={styles.card}>
              <span className="eyebrow">IN PROGRESS</span>
              <h2>{active.name}</h2>
              <p>
                {active.problems.length} problems · {active.durationMinutes}{" "}
                minutes · {active.handle ?? "Personal notebook"}
              </p>
              <Link className="button primary" href={`/contests/${active.id}`}>
                Resume contest
              </Link>
            </section>
          )}
          <section className={styles.card}>
            <h2>Upsolve queue</h2>
            <p className="small muted">
              Save a solved learning outcome in a real practice session to
              complete an upsolve. Opening a problem or reading an editorial
              does not complete it.
            </p>
            <UpsolveQueue
              data={data}
              save={save}
              busy={busy || w.storagePending || !!w.storageError}
            />
          </section>
          <section className={styles.card}>
            <h2>Your contests</h2>
            {!data.contests?.length ? (
              <p className="muted">
                Start with a set from your library or tracks, or generate one
                from the Codeforces catalogue.
              </p>
            ) : (
              <ul className={styles.list}>
                {[...data.contests].reverse().map((c) => (
                  <li key={c.id}>
                    <Link href={`/contests/${c.id}`}>{c.name}</Link>
                    <span>
                      {c.state === "draft"
                        ? "Ready to start"
                        : c.state === "active"
                          ? "In progress"
                          : c.endReason === "expired"
                            ? "Time ended"
                            : c.state === "abandoned"
                              ? "Abandoned"
                              : "Finished early"}{" "}
                      · {c.problems.length} problems · {c.handle ?? "Notebook"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="small muted">
            Practice contests have no official rank, score, or rating
            prediction. Statements and judging stay on the problem’s platform.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {w.storageError && (
        <button
          className="button secondary"
          disabled={w.storagePending}
          onClick={async () => {
            if (await w.retryLocalSave()) setError("");
          }}
        >
          Retry saving Contest Lab
        </button>
      )}
      {create && (
        <Setup
          initial={contest}
          onClose={() => setCreate(false)}
          onSave={async (id, name, duration, problems, reveal, source) => {
            if (
              await save((d) =>
                d.contests?.some((c) => c.id === id)
                  ? reviseContestSetup(
                      d,
                      id,
                      name,
                      duration,
                      problems,
                      reveal,
                      source,
                    )
                  : createContest(
                      d,
                      id,
                      name,
                      duration,
                      problems,
                      reveal,
                      source,
                    ),
              )
            ) {
              setCreate(false);
              router.push(`/contests/${id}`);
            }
          }}
          busy={busy}
        />
      )}
    </div>
  );
}
function Setup({
  initial,
  onClose,
  onSave,
  busy,
}: {
  initial?: PracticeContest;
  onClose: () => void;
  onSave: (
    id: string,
    name: string,
    duration: number,
    problems: Problem[],
    reveal: boolean,
    source: PracticeContest["source"],
  ) => Promise<void>;
  busy: boolean;
}) {
  const w = useWorkspace();
  const id = useRef(initial?.id ?? uid());
  const [name, setName] = useState(initial?.name ?? "Practice contest"),
    [duration, setDuration] = useState(initial?.durationMinutes ?? 90),
    [count, setCount] = useState(initial?.problems.length ?? 3),
    [source, setSource] = useState<"manual" | "catalogue">(
      initial?.source ?? "manual",
    ),
    [track, setTrack] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Problem[]>(
      initial?.problems.map((p) => ({
        ...w.data.problems.find((v) => v.id === p.problemId)!,
        ...p.snapshot,
      })) ?? [],
    ),
    [reveal, setReveal] = useState(initial?.revealHints ?? false),
    [min, setMin] = useState(""),
    [max, setMax] = useState(""),
    [accepted, setAccepted] = useState(true),
    [practiced, setPracticed] = useState(true),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [catalogueNote, setCatalogueNote] = useState("");
  let pool = resolvedPracticeProblems(w.data);
  if (track)
    pool = (w.data.trackEntries ?? [])
      .filter((e) => e.trackId === track)
      .map((e) => trackProblem(w.data, e).problem);
  const unique = [
    ...new Map(pool.map((p) => [practiceIdentity(p), p])).values(),
  ].filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));
  async function generate() {
    setLoading(true);
    setError("");
    const guard = w.guardWorkspace();
    try {
      const response = await fetch("/api/catalogue");
      if (!response.ok)
        throw new Error(
          "The catalogue is unavailable. Retry or choose saved problems manually.",
        );
      const catalogue = validateCatalogue(await response.json());
      if (!guard()) return;
      const chosen = generateContestProblems(
        w.data,
        catalogue.problems,
        count,
        min === "" ? null : Number(min),
        max === "" ? null : Number(max),
        accepted,
        practiced,
      );
      setSelected(
        chosen.map((p) => {
          const existing = resolvedPracticeProblems(w.data).find(
            (v) => practiceIdentity(v) === p.key,
          );
          return (
            existing ?? {
              id: uid(),
              title: p.title,
              platform: "Codeforces",
              url: p.url,
              problemCode: p.code,
              rating: p.rating,
              tags: p.tags,
              createdAt: new Date().toISOString(),
              reviewAt: null,
              reviewCount: 0,
            }
          );
        }),
      );
      setCatalogueNote(
        `${catalogue.stale ? "Cached" : "Catalogue"} snapshot from ${new Date(catalogue.fetchedAt).toLocaleString()}.`,
      );
    } catch (e) {
      if (guard()) {
        setSelected([]);
        setError(
          e instanceof Error ? e.message : "Could not generate this set.",
        );
      }
    } finally {
      if (guard()) setLoading(false);
    }
  }
  return (
    <Modal
      title="Create a practice contest"
      onClose={onClose}
      className={styles.setup}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave(id.current, name, duration, selected, reveal, source);
        }}
        className={styles.form}
      >
        <label>
          Contest name
          <input
            required
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className={styles.columns}>
          <label>
            Duration in minutes
            <input
              type="number"
              required
              min={5}
              max={360}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
          <label>
            Problem count
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => {
                setCount(Number(e.target.value));
                if (source === "catalogue") setSelected([]);
              }}
            />
          </label>
        </div>
        <label>
          Choose a set
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value as typeof source);
              setSelected([]);
            }}
          >
            <option value="manual">From library or tracks</option>
            <option value="catalogue">Generate from Codeforces</option>
          </select>
        </label>
        {source === "manual" ? (
          <>
            <label>
              Collection
              <select value={track} onChange={(e) => setTrack(e.target.value)}>
                <option value="">Saved problem library</option>
                {w.data.tracks?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Find a problem
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className={styles.choices}>
              {unique.slice(0, 100).map((p) => (
                <label key={practiceIdentity(p)}>
                  <input
                    type="checkbox"
                    checked={selected.some(
                      (v) => practiceIdentity(v) === practiceIdentity(p),
                    )}
                    disabled={
                      !selected.some(
                        (v) => practiceIdentity(v) === practiceIdentity(p),
                      ) && selected.length >= count
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, p]
                          : selected.filter(
                              (v) =>
                                practiceIdentity(v) !== practiceIdentity(p),
                            ),
                      )
                    }
                  />
                  <span>
                    {p.title} <small>{p.problemCode}</small>
                  </span>
                </label>
              ))}
              {!unique.length && (
                <p className="muted">
                  No matching saved problems. Add a problem or import a track
                  first.
                </p>
              )}
              {unique.length > 100 && (
                <p className="small muted">
                  Showing the first 100 matches. Narrow your search to find
                  others.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={styles.columns}>
              <label>
                Minimum rating (optional)
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={min}
                  onChange={(e) => {
                    setMin(e.target.value);
                    setSelected([]);
                  }}
                />
              </label>
              <label>
                Maximum rating (optional)
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={max}
                  onChange={(e) => {
                    setMax(e.target.value);
                    setSelected([]);
                  }}
                />
              </label>
            </div>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => {
                  setAccepted(e.target.checked);
                  setSelected([]);
                }}
              />
              Exclude recorded accepted problems
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={practiced}
                onChange={(e) => {
                  setPracticed(e.target.checked);
                  setSelected([]);
                }}
              />
              Exclude previously practiced problems
            </label>
            <p className="small muted">
              Uses personal practice and the connected profile (
              {w.data.codeforces.connectedHandle ?? "none"}). Exclusions only
              know saved history; incomplete imports may miss earlier solves.
              Deterministic selection: lowest known rating first, then canonical
              problem key; unknown ratings last, excluded when a rating bound is
              set.
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={loading}
              onClick={() => void generate()}
            >
              {loading ? "Finding problems…" : "Generate set"}
            </button>
            {catalogueNote && <p className="small muted">{catalogueNote}</p>}
          </>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
          />
          Reveal tags, ratings, patterns, and previous notes during this contest
        </label>
        <p className="small muted">
          By default hints, ratings, patterns, and previous notes stay hidden.
          The chosen set and duration lock when you start.
        </p>
        {selected.length > 0 && (
          <section className={styles.preview}>
            <h3>
              Review chosen set · {selected.length} / {count}
            </h3>
            <ol>
              {selected.map((p) => (
                <li key={p.id}>
                  {p.title} <span className="muted">{p.problemCode}</span>
                  {reveal && (
                    <small>
                      {p.rating ?? "Unrated"} · {p.tags.join(", ")}
                      <span className={styles.quote}>
                        {Object.values(contestHints(w.data, p))
                          .filter(Boolean)
                          .join("\n")}
                      </span>
                    </small>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <ContestSaveRecovery />
        <button
          className="button primary"
          disabled={
            busy ||
            loading ||
            selected.length !== count ||
            count < 1 ||
            count > 20
          }
        >
          Save contest setup
        </button>
      </form>
    </Modal>
  );
}
function ContestView({
  contest: c,
  save,
  busy,
  onEditSetup,
}: {
  onEditSetup: () => void;
  contest: PracticeContest;
  save: Save;
  busy: boolean;
}) {
  const w = useWorkspace();
  const [selectedRow, setSelectedRow] = useState(c.problems[0].id);
  const [now, setNow] = useState(() => Date.now()),
    [confirm, setConfirm] = useState<"early" | "abandoned" | null>(null),
    [reviewId, setReviewId] = useState<string | null>(null),
    [transitionError, setTransitionError] = useState("");
  const notesControllers = useRef(
    new Map<string, ContestDraftController<ScratchDraft>>(),
  );
  const review = c.problems.find((p) => p.id === reviewId);
  const scoped = contestScope(w.data, c),
    readonly = busy || !scoped;
  async function flushNotesAndTransition(
    transition?: (d: Data) => Data,
    onlyRow?: string,
  ) {
    const patches = new Map<string, ContestDraftPatch<ScratchDraft>>();
    let saved = false;
    setTransitionError("");
    try {
      for (const [id, controller] of notesControllers.current) {
        if (onlyRow && id !== onlyRow) continue;
        const patch = controller.prepare();
        if (patch) patches.set(id, patch);
      }
      if (!patches.size && !transition) return true;
      saved = await save((data) => {
        const withNotes = editContest(data, c.id, (contest) => {
          if (!contestScope(data, contest))
            throw new Error(
              "Switch back to this contest’s profile before saving its notes.",
            );
          return {
            ...contest,
            problems: contest.problems.map((p) => {
              const patch = patches.get(p.id);
              return patch ? { ...p, ...patch.apply({ notes: p.notes }) } : p;
            }),
          };
        });
        return transition ? transition(withNotes) : withNotes;
      });
      return saved;
    } catch (error) {
      setTransitionError(
        error instanceof Error
          ? error.message
          : "Your notes need review before saving.",
      );
      return false;
    } finally {
      for (const patch of patches.values()) patch.complete(saved);
    }
  }
  useEffect(() => {
    if (c.state !== "active") return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [c.state]);
  useEffect(() => {
    if (c.state === "active" && Date.parse(c.deadline!) <= now && !busy)
      void flushNotesAndTransition((d) => reconcileContests(d, new Date(now)));
  });
  const results = c.state === "finished" || c.state === "abandoned";
  return (
    <>
      {c.state === "active" ? (
        <header className={styles.activeHeader}>
          <h1>{c.name}</h1>
          <p className="small muted">
            {c.problems.length} problems · {c.durationMinutes} minutes ·{" "}
            {c.handle ?? "Personal notebook"}
          </p>
        </header>
      ) : (
        <PageHeader
          eyebrow={
            results
              ? "CONTEST REVIEW"
              : c.state === "draft"
                ? "YOUR CHOSEN SET"
                : "IN PROGRESS"
          }
          title={c.name}
          description={`${c.problems.length} problems · ${c.durationMinutes} minutes · ${c.handle ?? "Personal notebook"}`}
        />
      )}
      {!scoped && (
        <p className={styles.notice}>
          This contest belongs to {c.handle ?? "the personal notebook"}. Switch
          back to that profile to change it. Its evidence always uses the
          captured profile.
        </p>
      )}
      {c.state === "draft" ? (
        <section className={styles.card}>
          <p>
            The set and duration will lock when you start.{" "}
            {w.data.session
              ? "Finish or abandon your open timed practice session first."
              : activeContest(w.data)
                ? "Another contest is already active."
                : "The wall-clock timer continues while this tab is closed."}
          </p>
          <button
            className="button primary"
            disabled={readonly || !!w.data.session || !!activeContest(w.data)}
            onClick={() => void save((d) => startContest(d, c.id))}
          >
            Start contest
          </button>
          <button
            className="button secondary"
            disabled={readonly}
            onClick={onEditSetup}
          >
            Edit setup
          </button>
          {w.data.session && (
            <Link className="text-link" href="/session">
              Resume regular session
            </Link>
          )}
          <p className="small muted">
            Timing uses this device’s clock. Clock changes can affect the
            displayed remaining time.
          </p>
        </section>
      ) : c.state === "active" ? (
        <section className={styles.timer}>
          <div>
            <span className="eyebrow">REMAINING</span>
            <p role="timer" aria-live="off" aria-label="Contest time remaining">
              {clockTime(Math.max(0, Date.parse(c.deadline!) - now))}
            </p>
          </div>
          <div className={styles.actions}>
            <button
              className="text-link"
              disabled={readonly}
              onClick={() => setConfirm("early")}
            >
              Finish early
            </button>
            <button
              className="text-link"
              disabled={readonly}
              onClick={() => setConfirm("abandoned")}
            >
              Abandon contest
            </button>
          </div>
        </section>
      ) : (
        <section className={styles.card}>
          <h2>
            {c.state === "abandoned"
              ? "Abandoned"
              : c.endReason === "expired"
                ? "Time ended"
                : "Finished early"}
          </h2>
          <p>
            {Math.round(
              (Date.parse(c.endedAt!) - Date.parse(c.startedAt!)) / 6000,
            ) / 10}{" "}
            minutes of contest wall time ·{" "}
            {
              c.problems.filter((p) =>
                p.evidence.some((e) => e.verdict === "OK"),
              ).length
            }{" "}
            platform accepted ·{" "}
            {
              c.problems.filter(
                (p) =>
                  p.status === "marked-solved" &&
                  !p.evidence.some((e) => e.verdict === "OK"),
              ).length
            }{" "}
            marked solved awaiting confirmation ·{" "}
            {
              c.problems.filter(
                (p) =>
                  (p.status === "working" || p.evidence.length > 0) &&
                  p.status !== "marked-solved" &&
                  !p.evidence.some((e) => e.verdict === "OK"),
              ).length
            }{" "}
            attempted, unfinished
          </p>
          <p className="small muted">
            Original window: {new Date(c.startedAt!).toLocaleString()} –{" "}
            {new Date(c.endedAt!).toLocaleString()}. Later submissions are
            outside these results.
          </p>
          <p className="small muted">
            Per-problem duration is unknown. Personal reflections describe
            learning, independently of judging.
          </p>
        </section>
      )}
      {c.state === "active" && (
        <label className={styles.currentProblem}>
          Current problem
          <select
            value={selectedRow}
            onChange={(e) => {
              const previous = selectedRow;
              setSelectedRow(e.target.value);
              void flushNotesAndTransition(undefined, previous);
            }}
          >
            {c.problems.map((p, i) => (
              <option key={p.id} value={p.id}>
                {i + 1}. {p.snapshot.title} ·{" "}
                {p.status === "marked-solved"
                  ? "Marked solved (self-reported)"
                  : p.status === "working"
                    ? "Working"
                    : "Not started"}
              </option>
            ))}
          </select>
        </label>
      )}
      <ol className={styles.problems}>
        {c.problems.map((p) => (
          <ProblemCard
            key={p.id}
            contest={c}
            problem={p}
            index={c.problems.findIndex((v) => v.id === p.id)}
            save={save}
            readonly={readonly}
            hidden={c.state === "active" && p.id !== selectedRow}
            notesControllers={notesControllers}
            onReview={() => setReviewId(p.id)}
          />
        ))}
      </ol>
      {c.state !== "draft" && (
        <ContestSynchronization contest={c} busy={busy} />
      )}
      {results && (
        <OverallReview key={c.id} contest={c} save={save} readonly={readonly} />
      )}
      {confirm && (
        <Modal
          title={
            confirm === "early"
              ? "Finish this contest early?"
              : "Abandon this contest?"
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === "early"
              ? "The result window ends now. Later submissions count as later learning."
              : "Your notes and evidence stay saved with an abandoned end reason. This does not create practice attempts."}
          </p>
          {transitionError && <p role="alert">{transitionError}</p>}
          <div className={styles.actions}>
            <button
              className="button primary"
              disabled={readonly}
              onClick={async () => {
                const at = new Date();
                await flushNotesAndTransition((d) =>
                  endContest(d, c.id, confirm, at),
                );
                setConfirm(null);
              }}
            >
              {confirm === "early" ? "Finish contest" : "Abandon contest"}
            </button>
            <button
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              Keep practicing
            </button>
          </div>
        </Modal>
      )}
      {review && (
        <ReflectionDialog
          contestId={c.id}
          problem={review}
          onClose={() => setReviewId(null)}
          save={save}
          readonly={readonly}
        />
      )}
    </>
  );
}
function ContestSynchronization({
  contest: c,
  busy,
}: {
  contest: PracticeContest;
  busy: boolean;
}) {
  const w = useWorkspace();
  const profile = w.data.codeforces.profiles.find(
    (p) => p.handle.toLowerCase() === c.handle?.toLowerCase(),
  );
  return (
    <section className={styles.evidence} aria-label="Contest synchronization">
      <div className={styles.syncHeading}>
        <div>
          <h2>Codeforces evidence</h2>
          <p className="small muted">
            Last successful sync:{" "}
            {profile?.lastSyncAt
              ? new Date(profile.lastSyncAt).toLocaleString()
              : "No successful sync recorded"}
            {profile?.historyComplete
              ? " · History complete"
              : " · History incomplete"}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={
            !contestScope(w.data, c) ||
            !c.handle ||
            w.sync.phase !== null ||
            busy
          }
          onClick={() => void w.syncActivity()}
        >
          {w.sync.phase ? "Syncing contest evidence…" : "Sync contest evidence"}
        </button>
      </div>
      {w.sync.error && <p role="alert">{w.sync.error}</p>}
      <details>
        <summary>How timing and evidence work</summary>
        <p className="small muted">
          Matches submission time, canonical problem, and captured handle.
          Pending and rejudged verdicts may update results without changing
          reflections. Incomplete imported history cannot prove there was no
          solve.
        </p>
        <p className="small muted">
          Whole-contest wall time uses this device’s clock and continues while
          the tab is closed. Per-problem working time is unknown.
        </p>
      </details>
    </section>
  );
}
function ProblemCard({
  contest: c,
  problem: p,
  index,
  save,
  readonly,
  hidden,
  notesControllers,
  onReview,
}: {
  contest: PracticeContest;
  problem: ContestProblem;
  index: number;
  save: Save;
  readonly: boolean;
  hidden: boolean;
  notesControllers: RefObject<
    Map<string, ContestDraftController<ScratchDraft>>
  >;
  onReview: () => void;
}) {
  const workspace = useWorkspace();
  const notes = useContestDraft(
    { notes: p.notes },
    contestDraftScope(workspace.workspaceKey, c.handle, c.id, "scratch", p.id),
  );
  const [priority, setPriority] = useState<"normal" | "high">(
      p.upsolve?.priority ?? "normal",
    ),
    [date, setDate] = useState(p.upsolve?.dueAt ?? "");
  async function saveNotes() {
    return notes.save((apply) =>
      save((data) =>
        editContest(data, c.id, (contest) => {
          if (!contestScope(data, contest))
            throw new Error(
              "Switch back to this contest’s profile before saving its notes.",
            );
          return {
            ...contest,
            problems: contest.problems.map((row) =>
              row.id === p.id
                ? { ...row, ...apply({ notes: row.notes }) }
                : row,
            ),
          };
        }),
      ),
    );
  }
  useEffect(() => {
    const controllers = notesControllers.current;
    controllers.set(p.id, notes.controller);
    return () => {
      controllers.delete(p.id);
    };
  }, [notesControllers, notes.controller, p.id]);
  useContestAutosave(
    notes.draft,
    notes.dirty,
    readonly || !!notes.conflicts.length || c.state === "draft",
    saveNotes,
  );
  // An external tab/provider can expire or finish the contest before the normal
  // debounce. The still-mounted card retains and flushes its original note draft.
  useEffect(() => {
    if (c.endedAt && notes.dirty && !readonly && !notes.conflicts.length)
      void saveNotes();
  });
  const result = !!c.endedAt,
    accepted = p.evidence.some((e) => e.verdict === "OK");
  const canQueue =
    result &&
    (p.reflection ? p.reflection.outcome !== "independent" : !accepted);
  const snapshot = {
    ...p.snapshot,
    id: p.problemId,
    createdAt: c.createdAt,
    reviewAt: null,
    reviewCount: 0,
  };
  return (
    <li
      className={styles.card}
      hidden={hidden}
      style={hidden ? { display: "none" } : undefined}
    >
      <div className={styles.problemHeading}>
        <div>
          <span className="eyebrow">PROBLEM {index + 1}</span>
          <h2>{p.snapshot.title}</h2>
          <span className="small muted">
            {p.snapshot.platform} · {p.snapshot.problemCode}
          </span>
        </div>
        {c.state === "active" && snapshot.url ? (
          <a
            href={snapshot.url}
            target="_blank"
            rel="noopener noreferrer"
            className="button primary"
          >
            Open problem ↗<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <ProblemLink problem={snapshot} />
        )}
      </div>
      {(c.revealHints || result) && (
        <p className="small muted">
          {p.snapshot.rating ?? "Unrated"} ·{" "}
          {p.snapshot.tags.join(", ") || "No tags recorded"}
        </p>
      )}
      {(c.revealHints || result) && (p.hints?.pattern || p.hints?.notes) && (
        <details>
          <summary>Learning hints saved with this set</summary>
          {p.hints.pattern && <p className={styles.quote}>{p.hints.pattern}</p>}
          {p.hints.notes && <p className={styles.quote}>{p.hints.notes}</p>}
        </details>
      )}
      {c.state === "active" ? (
        <>
          <label>
            Your status
            <select
              value={p.status}
              aria-label="Your status"
              disabled={readonly}
              onChange={(e) => {
                const status = e.target.value as ContestProblem["status"];
                void save((d) =>
                  editContest(d, c.id, (c) => ({
                    ...c,
                    problems: c.problems.map((v) =>
                      v.id === p.id ? { ...v, status } : v,
                    ),
                  })),
                );
              }}
            >
              <option value="not-started">Not started</option>
              <option value="working">Working</option>
              <option value="marked-solved">
                Marked solved · self-reported
              </option>
            </select>
          </label>
        </>
      ) : result ? (
        <>
          <p className={styles.result}>
            {accepted
              ? "Platform accepted in contest window"
              : p.status === "marked-solved"
                ? "Personally marked solved · awaiting platform confirmation"
                : p.status === "working" || p.evidence.length > 0
                  ? "Attempted · unfinished"
                  : "Not started"}
          </p>
          {p.notes && (
            <details>
              <summary>Contest scratch notes</summary>
              <p className={styles.quote}>{p.notes}</p>
            </details>
          )}
          {p.evidence.length > 0 ? (
            <ul className={styles.list}>
              {p.evidence.map((e) => (
                <li key={e.id}>
                  <span>
                    <a
                      href={`https://codeforces.com/${p.identity.startsWith("gym:") ? "gym" : "contest"}/${p.identity.split(":")[1]}/submission/${e.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Submission #{e.id}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>{" "}
                    · {verdictLabel(e.verdict)}
                  </span>
                  <time dateTime={e.submittedAt}>
                    {new Date(e.submittedAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">No matching submissions imported yet.</p>
          )}
          {p.evidenceChanges.length > 0 && (
            <details>
              <summary>Evidence update history</summary>
              <ul className={styles.list}>
                {p.evidenceChanges.map((e) => (
                  <li key={e.id}>
                    #{e.submissionId}: {verdictLabel(e.before)} →{" "}
                    {verdictLabel(e.after)} · observed{" "}
                    {new Date(e.at).toLocaleString()}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {p.reflection && (
            <div>
              <p>{OUTCOMES[p.reflection.outcome]}</p>
              {p.reflection.difficulty && (
                <p>{DIFFICULTIES[p.reflection.difficulty]}</p>
              )}
              <p className={styles.quote}>{p.reflection.takeaway}</p>
              {p.reflection.approach && (
                <p className={styles.quote}>{p.reflection.approach}</p>
              )}
              {p.reflection.mistakeNote && (
                <p className={styles.quote}>{p.reflection.mistakeNote}</p>
              )}
            </div>
          )}
          <div className={styles.actions}>
            <button
              className="button secondary"
              disabled={readonly}
              onClick={onReview}
            >
              {p.reflection ? "Edit reflection" : "Reflect on this problem"}
            </button>
            <Link
              className="text-link"
              href={`/problems/${encodeURIComponent(p.problemId)}?from=${encodeURIComponent(`/contests/${c.id}`)}`}
            >
              Problem Memory
            </Link>
          </div>
          {canQueue && (
            <details>
              <summary>
                {p.upsolve ? "Upsolve scheduling" : "Add to upsolve queue"}
              </summary>
              <div className={styles.form}>
                <label>
                  Priority
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as typeof priority)
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Suggested coding date (optional)
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <p className="small muted">
                  Existing future coding dates, deferrals, skips, and archives
                  still apply. This adds a queue item without changing those
                  dates.
                </p>
                <button
                  className="button secondary"
                  disabled={readonly || !!p.upsolve?.completionId}
                  onClick={() =>
                    void save((d) =>
                      queueUpsolve(d, c.id, p.id, priority, date || null),
                    )
                  }
                >
                  {p.upsolve ? "Save upsolve schedule" : "Queue upsolve"}
                </button>
              </div>
            </details>
          )}
          {p.upsolve?.completionId && (
            <p className="small muted">
              Later practice saved · original contest result preserved.
            </p>
          )}
        </>
      ) : null}
      {(c.state === "active" || notes.dirty || notes.conflicts.length > 0) && (
        <>
          <label>
            Scratch notes
            <textarea
              aria-label="Scratch notes"
              rows={3}
              maxLength={10000}
              value={notes.draft.notes}
              onChange={(e) => notes.setDraft({ notes: e.target.value })}
              disabled={!contestScope(workspace.data, c)}
            />
          </label>
          <ContestDraftConflict
            label="scratch notes"
            conflicted={!!notes.conflicts.length}
            disabled={readonly}
            useSaved={notes.useSaved}
            keepDraft={notes.keepDraft}
          />
          <button
            className="button secondary"
            disabled={readonly || !notes.dirty || !!notes.conflicts.length}
            onClick={() => void saveNotes()}
          >
            Save scratch notes
          </button>
          <ContestDraftFeedback
            label="Scratch notes"
            status={notes.status}
            reloadProtected={notes.reloadProtected}
          />
        </>
      )}
    </li>
  );
}
function ReflectionDialog({
  contestId,
  problem: p,
  save,
  readonly,
  onClose,
}: {
  contestId: string;
  problem: ContestProblem;
  save: Save;
  readonly: boolean;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const [fallback] = useState<ContestReflection>(() => ({
    outcome: "unsolved",
    difficulty: null,
    takeaway: "",
    savedAt: new Date().toISOString(),
  }));
  const protectedDraft = useContestDraft(
    p.reflectionDraft ?? p.reflection ?? fallback,
    contestDraftScope(
      workspace.workspaceKey,
      workspace.data.contests?.find((c) => c.id === contestId)?.handle,
      contestId,
      "reflection",
      p.id,
    ),
  );
  const { draft, setDraft } = protectedDraft;
  async function saveDraft() {
    return protectedDraft.save((apply) =>
      save((data) =>
        editContest(data, contestId, (contest) => {
          if (!contestScope(data, contest))
            throw new Error(
              "Switch back to this contest’s profile before saving its reflection.",
            );
          return {
            ...contest,
            problems: contest.problems.map((row) =>
              row.id === p.id
                ? {
                    ...row,
                    reflectionDraft: apply(
                      row.reflectionDraft ?? row.reflection ?? fallback,
                    ),
                  }
                : row,
            ),
          };
        }),
      ),
    );
  }
  useContestAutosave(
    draft,
    protectedDraft.dirty,
    readonly || !!protectedDraft.conflicts.length,
    saveDraft,
  );
  return (
    <Modal
      title={`Reflect · ${p.snapshot.title}`}
      onClose={() => {
        void saveDraft().then((ok) => {
          if (ok) onClose();
        });
      }}
    >
      <form
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault();
          let patch: ContestDraftPatch<ContestReflection> | null = null;
          let saved = false;
          try {
            patch = protectedDraft.controller.prepare();
            saved = await save((data) =>
              editContest(data, contestId, (contest) => {
                if (!contestScope(data, contest))
                  throw new Error(
                    "Switch back to this contest’s profile before saving its reflection.",
                  );
                return {
                  ...contest,
                  problems: contest.problems.map((row) => {
                    if (row.id !== p.id) return row;
                    const source =
                      row.reflectionDraft ?? row.reflection ?? fallback;
                    const reflection = {
                      ...(patch ? patch.apply(source) : source),
                      savedAt: new Date().toISOString(),
                    };
                    return { ...row, reflection, reflectionDraft: reflection };
                  }),
                };
              }),
            );
            if (saved) onClose();
          } catch {
            // The protected draft displays its divergence and remains open.
          } finally {
            patch?.complete(saved);
          }
        }}
      >
        <label>
          Learning outcome
          <select
            value={draft.outcome}
            onChange={(e) =>
              setDraft({
                ...draft,
                outcome: e.target.value as ContestReflection["outcome"],
              })
            }
          >
            {Object.entries(OUTCOMES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Main difficulty
          <select
            value={draft.difficulty ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                difficulty:
                  (e.target.value as ContestReflection["difficulty"]) || null,
              })
            }
          >
            <option value="">No difficulty selected</option>
            {Object.entries(DIFFICULTIES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Takeaway
          <textarea
            aria-label="Takeaway"
            maxLength={2000}
            rows={3}
            value={draft.takeaway}
            onChange={(e) => setDraft({ ...draft, takeaway: e.target.value })}
          />
        </label>
        <ReflectionMemoryFields
          value={draft}
          onChange={(memory) => setDraft({ ...draft, ...memory })}
          disabled={readonly}
        />
        <p className="small muted">
          This reflection stays attached to the original contest. Later practice
          has its own record. Platform acceptance does not choose your learning
          outcome.
        </p>
        <ContestSaveRecovery />
        <ContestDraftConflict
          label="reflection draft"
          conflicted={!!protectedDraft.conflicts.length}
          disabled={readonly}
          useSaved={protectedDraft.useSaved}
          keepDraft={protectedDraft.keepDraft}
        />
        <ContestDraftFeedback
          label="Reflection draft"
          status={protectedDraft.status}
          reloadProtected={protectedDraft.reloadProtected}
        />
        <button
          className="button primary"
          disabled={readonly || !!protectedDraft.conflicts.length}
        >
          Save contest reflection
        </button>
      </form>
    </Modal>
  );
}
function OverallReview({
  contest: c,
  save,
  readonly,
}: {
  contest: PracticeContest;
  save: Save;
  readonly: boolean;
}) {
  const workspace = useWorkspace();
  const protectedDraft = useContestDraft(
    c.review,
    contestDraftScope(workspace.workspaceKey, c.handle, c.id, "overall"),
  );
  const { draft, setDraft } = protectedDraft;
  async function saveReview() {
    return protectedDraft.save((apply) =>
      save((data) =>
        editContest(data, c.id, (contest) => {
          if (!contestScope(data, contest))
            throw new Error(
              "Switch back to this contest’s profile before saving its review.",
            );
          return { ...contest, review: apply(contest.review) };
        }),
      ),
    );
  }
  useContestAutosave(
    draft,
    protectedDraft.dirty,
    readonly || !!protectedDraft.conflicts.length,
    saveReview,
  );
  return (
    <section className={styles.card}>
      <h2>Next time</h2>
      <p className="small muted">
        Optional. You can return to this review later.
      </p>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void saveReview();
        }}
      >
        {(["wentWell", "lostTime", "nextChange"] as const).map((key, i) => (
          <label key={key}>
            {
              [
                "What went well?",
                "Where did time go?",
                "What will you change next time?",
              ][i]
            }
            <textarea
              rows={2}
              maxLength={2000}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <ContestDraftConflict
          label="overall review"
          conflicted={!!protectedDraft.conflicts.length}
          disabled={readonly}
          useSaved={protectedDraft.useSaved}
          keepDraft={protectedDraft.keepDraft}
        />
        <ContestDraftFeedback
          label="Overall review"
          status={protectedDraft.status}
          reloadProtected={protectedDraft.reloadProtected}
        />
        <button
          className="button secondary"
          disabled={readonly || !!protectedDraft.conflicts.length}
        >
          Save overall review
        </button>
      </form>
    </section>
  );
}
function UpsolveQueue({
  data,
  save,
  busy,
}: {
  data: Data;
  save: Save;
  busy: boolean;
}) {
  const router = useRouter();
  const w = useWorkspace();
  const rows = (data.contests ?? [])
    .filter((c) => contestScope(data, c))
    .flatMap((c) =>
      c.problems.filter((p) => !!p.upsolve).map((p) => ({ c, p })),
    );
  if (!rows.length)
    return (
      <p className="muted">
        Unfinished and assisted contest problems can become your next deliberate
        practice.
      </p>
    );
  return (
    <ul className={styles.queue}>
      {rows.map(({ c, p }) => {
        const u = p.upsolve!,
          problem = data.problems.find((v) => v.id === p.problemId);
        return (
          <li key={p.id}>
            <div>
              <h3>{p.snapshot.title}</h3>
              <p className="small muted">
                {c.name} · {u.priority} priority ·{" "}
                {u.dueAt ?? "No suggested date"} ·{" "}
                {u.completionId
                  ? "Later practice recorded"
                  : u.state === "removed"
                    ? "Removed administratively"
                    : "Queued"}
              </p>
              <Link className="text-link" href={`/contests/${c.id}`}>
                Original contest review
              </Link>
              {" · "}
              <Link
                className="text-link"
                href={`/problems/${encodeURIComponent(p.problemId)}`}
              >
                Memory
              </Link>
            </div>
            {u.state === "queued" && !u.completionId && (
              <div className={styles.actions}>
                <button
                  className="button secondary"
                  disabled={
                    busy ||
                    !!activeContest(data) ||
                    !!data.session ||
                    !problem ||
                    !eligibleUpsolves(data).some((v) => v.row.id === p.id)
                  }
                  onClick={async () => {
                    const sessionId = uid(),
                      at = Date.now(),
                      guard = w.guardWorkspace();
                    if (
                      (await save((d) => {
                        let next = withPracticeSession(
                          d,
                          problem!,
                          d.settings.defaultDuration,
                          at,
                          sessionId,
                          false,
                          undefined,
                          p.id,
                        );
                        next = editContest(next, c.id, (c) => ({
                          ...c,
                          problems: c.problems.map((v) =>
                            v.id === p.id
                              ? { ...v, upsolve: { ...v.upsolve!, sessionId } }
                              : v,
                          ),
                        }));
                        return next;
                      })) &&
                      guard()
                    )
                      router.push("/session");
                  }}
                >
                  Start upsolve
                </button>
                <button
                  className="text-link"
                  disabled={busy || data.session?.id === u.sessionId}
                  onClick={() =>
                    void save((d) =>
                      editContest(d, c.id, (c) => ({
                        ...c,
                        problems: c.problems.map((v) =>
                          v.id === p.id
                            ? {
                                ...v,
                                upsolve: {
                                  ...v.upsolve!,
                                  state: "removed",
                                  removedAt: new Date().toISOString(),
                                },
                              }
                            : v,
                        ),
                      })),
                    )
                  }
                >
                  Remove from queue
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
