"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileUp,
  Layers3,
  Pencil,
  Share2,
  Sprout,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { Track, TrackEntry } from "@/lib/tracks-types";
import {
  nextTrackEntry,
  removeTrack,
  stageEntries,
  trackContextForEntry,
  trackDraft,
  trackEntryProgress,
  trackProblem,
  trackProgress,
} from "@/lib/tracks";
import { useWorkspace } from "./provider";
import { TrackImport, type TrackStudioEntryPoint } from "./track-import";
import { TrackShare } from "./track-share";
import { EmptyState, Modal, PageHeader } from "./ui";
import styles from "./tracks.module.css";

function trackUrl(id: string) {
  return `/tracks/${encodeURIComponent(id)}`;
}
function stageUrl(trackId: string, stageId: string) {
  return `${trackUrl(trackId)}/stages/${encodeURIComponent(stageId)}`;
}
function practiceTime(value: string) {
  return /^(?:suggested|practice time)\b/i.test(value)
    ? value
    : `Suggested practice: ${value}`;
}

function ProgressSummary({ track }: { track: Track }) {
  const { data } = useWorkspace();
  const progress = trackProgress(data, track.id);
  return (
    <>
      <progress
        className={styles.progress}
        max={Math.max(1, progress.total)}
        value={progress.independent}
        aria-label={`${progress.independent} of ${progress.total} reflected independently`}
      />
      <div className={styles.metrics}>
        <span>
          <strong>
            {progress.independent}/{progress.total}
          </strong>{" "}
          independent
        </span>
        <span>
          <strong>{progress.accepted}</strong> accepted on CF
        </span>
        <span>
          <strong>{progress.revisitDue}</strong> revisits due
        </span>
      </div>
    </>
  );
}

export function Tracks({
  trackId,
  stageId,
}: {
  trackId?: string;
  stageId?: string;
}) {
  const { workspaceKey, data } = useWorkspace();
  return (
    <TracksWorkspace
      key={`${workspaceKey}:${data.codeforces.connectedHandle?.toLowerCase() ?? ""}`}
      trackId={trackId}
      stageId={stageId}
    />
  );
}

function TracksWorkspace({
  trackId,
  stageId,
}: {
  trackId?: string;
  stageId?: string;
}) {
  const {
    data,
    update,
    notify,
    guardWorkspace,
    startSession,
    startFreshSession,
  } = useWorkspace();
  const router = useRouter();
  const [importing, setImporting] = useState<TrackStudioEntryPoint | null>(
    null,
  );
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const tracks = data.tracks ?? [];
  const track = tracks.find((value) => value.id === trackId);
  const stage = (data.trackStages ?? []).find(
    (value) => value.id === stageId && value.trackId === track?.id,
  );

  async function changeTrack(id: string | null) {
    if (busy.current) return;
    const isCurrent = guardWorkspace();
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await update((current) => ({
        ...current,
        activeTrackId: id,
      }));
      if (!isCurrent()) return;
      if (saved)
        notify(id ? "Active track chosen for Today." : "Active track cleared.");
      else
        setError(
          "This change was not committed. Review the storage message and recovery copies in Settings, then retry.",
        );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "This change could not be saved.",
        );
    } finally {
      busy.current = false;
      if (isCurrent()) setPending(false);
    }
  }

  async function start(entry: TrackEntry) {
    if (busy.current) return;
    const isCurrent = guardWorkspace();
    const { problem, fresh } = trackProblem(data, entry);
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const context = trackContextForEntry(data, entry.id);
      const saved = fresh
        ? await startFreshSession(problem, undefined, context ?? undefined)
        : await startSession(problem, undefined, context ?? undefined);
      if (!isCurrent()) return;
      if (!saved)
        setError(
          data.session
            ? "A session is already open. Continue it before starting another problem."
            : "Your session was not committed. Review the storage message in Settings, then retry.",
        );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Your practice session could not be saved. Review Settings and retry.",
        );
    } finally {
      busy.current = false;
      if (isCurrent()) setPending(false);
    }
  }

  async function confirmRemoval() {
    if (!track || busy.current) return;
    const isCurrent = guardWorkspace();
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await update((current) => removeTrack(current, track.id));
      if (!isCurrent()) return;
      if (!saved) {
        setError(
          "This removal was not committed. Your practice history is preserved. Review Settings and retry.",
        );
        return;
      }
      notify(
        "Track removed. Your problems and practice history are preserved.",
      );
      setRemoving(false);
      router.push("/tracks");
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "This track could not be removed.",
        );
    } finally {
      busy.current = false;
      if (isCurrent()) setPending(false);
    }
  }

  const next = track && nextTrackEntry(data, track.id, new Date(), stage?.id);
  const entries = stage ? stageEntries(data, stage.id) : [];
  const filtered = entries.filter((entry) => {
    const progress = trackEntryProgress(data, entry);
    return (
      `${entry.title} ${entry.code}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "untouched" && !progress.attempted && !progress.accepted) ||
        (filter === "assisted" && progress.assisted) ||
        (filter === "revisit" && !!progress.reviewAt))
    );
  });
  const takeaways = [
    ...new Set(
      entries.flatMap((entry) => trackEntryProgress(data, entry).takeaways),
    ),
  ];
  const editDraft = track && editing ? trackDraft(data, track.id) : null;

  return (
    <div className={`${styles.page} page-enter`}>
      {error && !removing && (
        <div role="alert" className={styles.error}>
          {error}{" "}
          <Link href="/settings" className="text-link">
            Settings and recovery copies
          </Link>
          {data.session && (
            <Link href="/session" className="text-link">
              Continue open session
            </Link>
          )}
        </div>
      )}
      {!trackId ? (
        <>
          <PageHeader
            eyebrow="STRUCTURE FOR YOUR PRACTICE"
            title="Your tracks."
            description="Turn practice sheets into a steady path. Work through stages, reflect on attempts, and return to ideas that need another try."
            action={
              <button
                className="button primary"
                onClick={() => setImporting("upload")}
              >
                <FileUp size={18} />
                Import practice sheet
              </button>
            }
          />
          <div className={styles.actions}>
            <button
              className="button secondary"
              onClick={() => setImporting("shared")}
            >
              Import shared track
            </button>
            <button
              className="button secondary"
              onClick={() => setImporting("paste")}
            >
              Paste Codeforces links or IDs
            </button>
            <button
              className="button secondary"
              onClick={() => setImporting("manual")}
            >
              Create manually
            </button>
          </div>
          {!tracks.length ? (
            <EmptyState
              title="A path you can make your own."
              description="Upload a DOCX, PDF or image, paste Codeforces links and IDs, or build your own track. Review its stages and problems before saving."
              icon={<Layers3 size={30} />}
              action={
                <button
                  className="button secondary"
                  onClick={() => setImporting("upload")}
                >
                  Choose a practice sheet
                </button>
              }
            />
          ) : (
            <div className={styles.cards}>
              {tracks.map((value) => (
                <article className={styles.card} key={value.id}>
                  {data.activeTrackId === value.id && (
                    <span className={styles.badge}>
                      <Check size={14} />
                      Active on Today
                    </span>
                  )}
                  <h2>
                    <Link href={trackUrl(value.id)}>{value.title}</Link>
                  </h2>
                  <p className={styles.source}>
                    {value.stageIds.length} stages · {value.sourceName}
                  </p>
                  <ProgressSummary track={value} />
                  <div className={styles.actions}>
                    <Link
                      className="button secondary"
                      href={trackUrl(value.id)}
                    >
                      Open track
                      <ArrowRight size={16} />
                    </Link>
                    <button
                      className="button ghost"
                      disabled={pending}
                      aria-label={`Share track: ${value.title}`}
                      onClick={() => setSharing(value.id)}
                    >
                      <Share2 size={16} />
                      Share track
                    </button>
                    <button
                      className="button ghost"
                      disabled={pending}
                      onClick={() =>
                        void changeTrack(
                          data.activeTrackId === value.id ? null : value.id,
                        )
                      }
                    >
                      {data.activeTrackId === value.id
                        ? "Clear active track"
                        : "Make active"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className={styles.notice}>
            Progress keeps Codeforces acceptance separate from your reflections.
            Pattern hints stay hidden until you choose to reveal them.
          </p>
        </>
      ) : !track || (stageId && !stage) ? (
        <EmptyState
          title="This track is not in this workspace."
          description="Choose one of your saved tracks. Track lists stay separate between workspaces and accounts."
          action={
            <Link href="/tracks" className="button secondary">
              Back to Tracks
            </Link>
          }
        />
      ) : (
        <>
          <Link
            className={`text-link ${styles.back}`}
            href={stage ? trackUrl(track.id) : "/tracks"}
          >
            <ArrowLeft size={16} />
            {stage ? track.title : "All tracks"}
          </Link>
          <PageHeader
            eyebrow={
              stage
                ? `${track.title} · STAGE ${track.stageIds.indexOf(stage.id) + 1}`
                : "A PRACTICE IN PROGRESS"
            }
            title={stage ? stage.title : track.title}
            description={
              stage
                ? stage.description ||
                  "Choose a problem, work in your own editor, and leave a reflection."
                : `From ${track.sourceName}. All stages are available at your own pace.`
            }
            action={
              !stage && (
                <div className={styles.actions}>
                  <button
                    className="button secondary"
                    disabled={pending}
                    onClick={() => setEditing(true)}
                  >
                    <Pencil size={16} />
                    Edit track
                  </button>
                  <button
                    className="button secondary"
                    disabled={pending}
                    onClick={() => setSharing(track.id)}
                  >
                    <Share2 size={16} />
                    Share track
                  </button>
                  <button
                    className="button ghost"
                    disabled={pending}
                    onClick={() => setRemoving(true)}
                  >
                    <Trash2 size={16} />
                    Remove track
                  </button>
                </div>
              )
            }
          />
          {!stage && track.shareDescription && (
            <p className={styles.curriculumText}>{track.shareDescription}</p>
          )}
          {stage ? (
            <p className={styles.source}>
              {stage.suggestedTime && `${practiceTime(stage.suggestedTime)} · `}
              {entries.length} ordered problems · Source ratings and titles
            </p>
          ) : (
            <>
              <ProgressSummary track={track} />
              <div className={styles.actions}>
                <button
                  className="button secondary"
                  disabled={pending}
                  onClick={() =>
                    void changeTrack(
                      data.activeTrackId === track.id ? null : track.id,
                    )
                  }
                >
                  {data.activeTrackId === track.id
                    ? "Active on Today · clear"
                    : "Make this my active track"}
                </button>
              </div>
              {trackProgress(data, track.id).lastPractised && (
                <p className={styles.notice}>
                  Last practised:{" "}
                  {trackProgress(data, track.id).lastPractised!.stage.title} ·{" "}
                  {trackProgress(data, track.id).lastPractised!.entry.title}
                </p>
              )}
            </>
          )}
          {data.session ? (
            <section className={styles.next} aria-label="Open practice session">
              <p>A session is already open.</p>
              <Link className="button primary" href="/session">
                Continue session
                <ArrowRight size={16} />
              </Link>
            </section>
          ) : next && (!stage || next.stage.id === stage.id) ? (
            <section
              className={styles.next}
              aria-label="Suggested next track problem"
            >
              <span className={styles.source}>
                {next.stage.title} · Problem{" "}
                {next.stage.entryIds.indexOf(next.entry.id) + 1} of{" "}
                {next.stage.entryIds.length}
              </span>
              <h2>{next.entry.title}</h2>
              <p>{next.reason}</p>
              <button
                className="button primary"
                disabled={pending}
                onClick={() => void start(next.entry)}
              >
                {next.revisit ? "Start revisit" : "Continue practice"}
                <ArrowRight size={16} />
              </button>
            </section>
          ) : (
            <p className={styles.notice}>
              {stage
                ? "Choose any problem below. Your next eligible recommendation may be in another stage."
                : "No track problem is eligible for automatic practice right now. You can open any stage and choose a problem yourself."}
            </p>
          )}
          {!stage ? (
            <ol className={styles.stageList}>
              {track.stageIds.map((id, index) => {
                const value = data.trackStages?.find(
                  (candidate) => candidate.id === id,
                );
                if (!value) return null;
                const progress = stageEntries(data, id).map((entry) =>
                  trackEntryProgress(data, entry),
                );
                return (
                  <li className={styles.stage} key={id}>
                    <span className={styles.motif} aria-hidden="true">
                      <Sprout size={21} strokeWidth={1.2 + index * 0.15} />
                    </span>
                    <div>
                      <h2>
                        {index + 1}. {value.title}
                      </h2>
                      <p>{value.description}</p>
                      {value.suggestedTime && (
                        <p className={styles.source}>
                          {practiceTime(value.suggestedTime)}
                        </p>
                      )}
                      <div className={styles.metrics}>
                        <span>
                          <strong>
                            {
                              progress.filter((entry) => entry.independent)
                                .length
                            }
                            /{progress.length}
                          </strong>{" "}
                          independent
                        </span>
                        <span>
                          <strong>
                            {progress.filter((entry) => entry.accepted).length}
                          </strong>{" "}
                          accepted on CF
                        </span>
                        <span>
                          <strong>
                            {
                              progress.filter((entry) => entry.revisitDue)
                                .length
                            }
                          </strong>{" "}
                          revisits due
                        </span>
                      </div>
                    </div>
                    <Link
                      className="button secondary"
                      href={stageUrl(track.id, id)}
                    >
                      Open stage
                      <ArrowRight size={16} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : (
            <>
              <div className={styles.toolbar}>
                <label>
                  Find a stage problem
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Problem name or Codeforces ID"
                  />
                </label>
                <label>
                  Filter stage problems
                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  >
                    <option value="all">All problems</option>
                    <option value="untouched">Untouched</option>
                    <option value="assisted">Assisted solves</option>
                    <option value="revisit">Scheduled revisits</option>
                  </select>
                </label>
              </div>
              <ol className={styles.problemList}>
                {filtered.map((entry) => {
                  const progress = trackEntryProgress(data, entry);
                  const problem = data.problems.find(
                    (value) => value.id === entry.problemId,
                  );
                  const differs =
                    problem &&
                    (problem.title !== entry.title ||
                      problem.rating !== entry.rating);
                  return (
                    <li className={styles.problem} key={entry.id}>
                      <span className={styles.position}>
                        {stage.entryIds.indexOf(entry.id) + 1}.
                      </span>
                      <div>
                        <h3>{entry.title}</h3>
                        <div className={styles.metadata}>
                          <span>{entry.code}</span>
                          <span>
                            {entry.rating === null
                              ? "Source rating not provided"
                              : `Source rating ${entry.rating}`}
                          </span>
                        </div>
                        <div
                          className={styles.statuses}
                          aria-label={`Progress for ${entry.title}`}
                        >
                          {!progress.attempted && !progress.accepted && (
                            <span>Not started</span>
                          )}
                          {progress.attempted && <span>Attempted</span>}
                          {progress.accepted && (
                            <span>Accepted on Codeforces</span>
                          )}
                          {progress.independent && (
                            <span>Reflected independently</span>
                          )}
                          {progress.assisted && (
                            <span>Reflected with assistance</span>
                          )}
                          {progress.unsolved && (
                            <span>Reflected · not solved yet</span>
                          )}
                          {progress.revisitDue ? (
                            <span className={styles.due}>Revisit due</span>
                          ) : (
                            progress.reviewAt && (
                              <span>Revisit {progress.reviewAt}</span>
                            )
                          )}
                        </div>
                        {!!differs && (
                          <p className={styles.source}>
                            Your saved problem uses {problem.title}
                            {problem.rating !== null
                              ? ` · rating ${problem.rating}`
                              : " · no saved rating"}
                            . The sheet’s metadata is shown above.
                          </p>
                        )}
                        <div className={styles.actions}>
                          <button
                            className="button secondary"
                            disabled={pending}
                            aria-label={`Start practice: ${entry.title}`}
                            onClick={() => void start(entry)}
                          >
                            Start practice
                            <ArrowRight size={16} />
                          </button>
                          <Link
                            className="text-link"
                            href={`/problems/${encodeURIComponent(trackProblem(data, entry).fresh ? entry.problemId : trackProblem(data, entry).problem.id)}?from=${encodeURIComponent(stageUrl(entry.trackId, entry.stageId))}`}
                          >
                            Learning Memory
                          </Link>
                          <a
                            className="text-link"
                            href={entry.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open on Codeforces
                            <ArrowUpRight size={16} />
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        </div>
                        {entry.pattern && (
                          <details className={styles.hint}>
                            <summary>Reveal source pattern hint</summary>
                            <p>{entry.pattern}</p>
                          </details>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {!filtered.length && (
                <p className={styles.empty}>
                  No problems match this filter. Choose All problems to see the
                  stage.
                </p>
              )}
              <section
                className={styles.takeaways}
                aria-label="Stage takeaways"
              >
                <h2>Your stage takeaways.</h2>
                {takeaways.length ? (
                  <ul>
                    {takeaways.map((takeaway) => (
                      <li key={takeaway}>{takeaway}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">
                    Your own reflections will appear here as you practise.
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
      {importing && (
        <TrackImport
          entryPoint={importing}
          onClose={() => setImporting(null)}
        />
      )}
      {editDraft && (
        <TrackImport
          initialDraft={editDraft}
          onClose={() => setEditing(false)}
        />
      )}
      {sharing && (
        <TrackShare trackId={sharing} onClose={() => setSharing(null)} />
      )}
      {removing && track && (
        <Modal
          title="Remove this track?"
          onClose={() => {
            if (!pending) setRemoving(false);
          }}
        >
          <div className="form-stack">
            <p>
              Remove {track.title} and its stage list. Your underlying problems,
              sessions, reflections, and revisit dates remain in Forma.
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() => setRemoving(false)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={pending}
                onClick={() => void confirmRemoval()}
              >
                {pending ? "Removing…" : "Remove track"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
