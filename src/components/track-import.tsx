"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  importPracticeDocument,
  DOCUMENT_IMPORT_LIMITS,
} from "@/lib/document-import";
import { findDuplicateTracks, importTrack, updateTrack } from "@/lib/tracks";
import {
  addPastedEntries,
  createManualEntry,
  createManualStage,
  createManualTrackDraft,
  entryNeedsReview,
  parsePastedProblems,
  trackDraftReview,
  trackEntryIdentity,
} from "@/lib/track-studio";
import type {
  TrackImportDraft,
  TrackImportEntry,
  TrackImportStage,
} from "@/lib/tracks-types";
import { normalizeCodeforcesIdentity } from "@/lib/codeforces-identity";
import {
  findEquivalentSharedTracks,
  readSharedTrackFile,
  sharedTrackPreview,
  SHARED_TRACK_LIMITS,
} from "@/lib/shared-tracks";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";
import styles from "./tracks.module.css";

export type TrackStudioEntryPoint = "upload" | "paste" | "manual" | "shared";

function move<T>(values: T[], index: number, direction: number): T[] {
  const next = [...values];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function identityFromCode(code: string, originalUrl: string) {
  const identity = normalizeCodeforcesIdentity({ code });
  if (!identity) return null;
  // An ID does not specify contest versus Gym. Keep the source namespace.
  if (/^https?:\/\/(?:www\.)?codeforces\.com\/gym\//i.test(originalUrl)) {
    const match = identity.code.match(/^(\d+)([A-Z]\d*)$/);
    if (match)
      return {
        ...identity,
        url: `https://codeforces.com/gym/${match[1]}/problem/${match[2]}`,
      };
  }
  return identity;
}

export function TrackImport({
  onClose,
  initialDraft,
  entryPoint = "upload",
}: {
  onClose: () => void;
  initialDraft?: TrackImportDraft;
  entryPoint?: TrackStudioEntryPoint;
}) {
  const { data, savedData, update, notify, guardWorkspace, retryLocalSave } =
    useWorkspace();
  const router = useRouter();
  const [mode, setMode] = useState<TrackStudioEntryPoint>(entryPoint);
  const [draft, setDraft] = useState<TrackImportDraft | null>(
    () =>
      initialDraft ??
      (entryPoint === "manual" ? createManualTrackDraft() : null),
  );
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{
    phase: string;
    percent: number;
    page?: number;
    pages?: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [copy, setCopy] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [forceOCR, setForceOCR] = useState(false);
  const [pasted, setPasted] = useState("");
  const [batchStage, setBatchStage] = useState<string | null>(null);
  const [batch, setBatch] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [openStages, setOpenStages] = useState<Set<string>>(
    () => new Set(initialDraft?.stages[0] ? [initialDraft.stages[0].id] : []),
  );
  const [dirty, setDirty] = useState(entryPoint === "manual" && !initialDraft);
  const [discarding, setDiscarding] = useState(false);
  const [discardTarget, setDiscardTarget] = useState("close");
  const fieldId = useId();
  const busy = useRef(false);
  const namespaces = useRef(new Map<string, string>());
  const controller = useRef<AbortController | null>(null);
  const owner = useRef(guardWorkspace());
  const profileOwner = useRef(
    data.codeforces.connectedHandle?.toLowerCase() ?? "",
  );
  const mounted = useRef(true);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const discardRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (
      !owner.current() ||
      profileOwner.current !==
        (data.codeforces.connectedHandle?.toLowerCase() ?? "")
    ) {
      controller.current?.abort();
      onClose();
    }
  }, [data, onClose]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!dirty && !pasted.trim() && !batch.trim()) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty, pasted, batch]);
  useEffect(() => {
    if (discarding) discardRef.current?.focus();
  }, [discarding]);

  function changeDraft(
    change: TrackImportDraft | ((value: TrackImportDraft) => TrackImportDraft),
  ) {
    setDraft(
      (current) =>
        current && (typeof change === "function" ? change(current) : change),
    );
    setDirty(true);
    setDiscarding(false);
  }
  function cancelProcessing() {
    controller.current?.abort();
    setProgress(
      (current) =>
        current && {
          ...current,
          phase: "Stopping processing and releasing workers",
        },
    );
  }
  function cancel() {
    if (pending) return;
    if (progress) {
      cancelProcessing();
      return;
    }
    if (dirty || pasted.trim() || batch.trim()) {
      setDiscardTarget("close");
      setDiscarding(true);
      return;
    }
    onClose();
  }
  async function select(file: File) {
    if (busy.current || !owner.current()) return;
    const workspaceCurrent = guardWorkspace();
    const isCurrent = () =>
      mounted.current && owner.current() && workspaceCurrent();
    const abort = new AbortController();
    controller.current = abort;
    busy.current = true;
    setError("");
    setProgress({
      phase:
        mode === "shared"
          ? "Reading shared track file"
          : "Reading practice sheet",
      percent: 0,
    });
    try {
      const parsed =
        mode === "shared"
          ? await readSharedTrackFile(file, { signal: abort.signal })
          : await importPracticeDocument(file, {
              signal: abort.signal,
              forceOCR,
              onProgress: (value) => {
                if (isCurrent() && !abort.signal.aborted) setProgress(value);
              },
            });
      if (!isCurrent() || abort.signal.aborted) return;
      setDraft(parsed);
      setOpenStages(new Set(parsed.stages[0] ? [parsed.stages[0].id] : []));
      setDirty(true);
      setCopy(false);
    } catch (failure) {
      if (isCurrent() && !abort.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "This file could not be read. Choose a supported document or image, then retry.",
        );
    } finally {
      busy.current = false;
      controller.current = null;
      if (isCurrent()) setProgress(null);
    }
  }
  function previewPaste() {
    if (!pasted.trim()) {
      setError("Paste at least one Codeforces link or explicit problem ID.");
      return;
    }
    try {
      const parsed = parsePastedProblems(pasted);
      setDraft(parsed);
      setOpenStages(new Set(parsed.stages[0] ? [parsed.stages[0].id] : []));
      setDirty(true);
      setPasted("");
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "This batch could not be read. Your text is still here.",
      );
    }
  }
  async function save() {
    if (!draft || busy.current || !owner.current()) return;
    const workspaceCurrent = guardWorkspace();
    const isCurrent = () =>
      mounted.current && owner.current() && workspaceCurrent();
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const change = (current: typeof data) => {
        if (
          !isCurrent() ||
          profileOwner.current !==
            (current.codeforces.connectedHandle?.toLowerCase() ?? "")
        )
          throw new Error(
            "The workspace or Codeforces profile changed. Open a new preview in the current workspace before saving.",
          );
        return initialDraft
          ? updateTrack(current, draft)
          : importTrack(current, draft, {
              duplicates: copy ? "copy" : "reject",
            });
      };
      const saved = await (writeFailed
        ? retryLocalSave(change)
        : update(change));
      if (!isCurrent()) return;
      if (!saved) {
        setWriteFailed(true);
        setError(
          `Your preview is still here. This ${initialDraft ? "edit" : "track"} was not committed. Review the storage message and recovery copies in Settings, then retry.`,
        );
        return;
      }
      notify(
        initialDraft
          ? "Track updated. Your practice history is preserved."
          : "Track saved. Choose a stage and make it your own.",
      );
      onClose();
      router.push(`/tracks/${encodeURIComponent(draft.id)}`);
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "The track could not be saved. Your draft is still here for retry.",
        );
    } finally {
      busy.current = false;
      if (isCurrent()) setPending(false);
    }
  }

  const counts = draft && trackDraftReview(draft);
  const duplicates =
    draft && !initialDraft
      ? (mode === "shared"
          ? findEquivalentSharedTracks(data, draft)
          : findDuplicateTracks(data, draft)
        ).filter((track) => track.id !== draft.id)
      : [];
  const sharedPreview =
    draft && mode === "shared" && !initialDraft
      ? sharedTrackPreview({ ...savedData, codeforces: data.codeforces }, draft)
      : null;
  const alreadyPresent = new Set(sharedPreview?.alreadyPresentIdentities ?? []);
  const unresolved = new Set(counts?.unresolved.map((entry) => entry.id));
  const repeated = new Set(counts?.duplicates.map((entry) => entry.id));
  function entryEdit(
    stageId: string,
    entryId: string,
    changes: Partial<TrackImportEntry>,
  ) {
    changeDraft((current) => ({
      ...current,
      stages: current.stages.map((stage) =>
        stage.id === stageId
          ? {
              ...stage,
              entries: stage.entries.map((entry) =>
                entry.id === entryId ? { ...entry, ...changes } : entry,
              ),
            }
          : stage,
      ),
    }));
  }
  function stageEdit(stageId: string, changes: Partial<TrackImportStage>) {
    changeDraft((current) => ({
      ...current,
      stages: current.stages.map((stage) =>
        stage.id === stageId ? { ...stage, ...changes } : stage,
      ),
    }));
  }
  function relocate(stageId: string, entryId: string, target: string) {
    changeDraft((current) => {
      if (stageId === target) return current;
      const entry = current.stages
        .find((stage) => stage.id === stageId)
        ?.entries.find((value) => value.id === entryId);
      if (!entry) return current;
      return {
        ...current,
        stages: current.stages.map((stage) => ({
          ...stage,
          entries:
            stage.id === stageId
              ? stage.entries.filter((value) => value.id !== entryId)
              : stage.id === target
                ? [...stage.entries, entry]
                : stage.entries,
        })),
      };
    });
    setOpenStages((current) => new Set([...current, target]));
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-studio-entry="${CSS.escape(entryId)}"] > summary`,
        )
        ?.focus(),
    );
  }
  function removeStage(stageId: string) {
    if (batchStage === stageId && batch.trim()) {
      setError(
        "Add or clear this stage’s pasted batch before removing the stage. Your text is still here.",
      );
      return;
    }
    if (batchStage === stageId) setBatchStage(null);
    changeDraft((current) => {
      const removed = current.stages.find((stage) => stage.id === stageId);
      const stages = current.stages.filter((stage) => stage.id !== stageId);
      if (!removed?.entries.length) return { ...current, stages };
      const existing = stages.find(
        (stage) => stage.title.toLowerCase() === "ungrouped",
      );
      if (existing)
        return {
          ...current,
          stages: stages.map((stage) =>
            stage.id === existing.id
              ? { ...stage, entries: [...stage.entries, ...removed.entries] }
              : stage,
          ),
        };
      return {
        ...current,
        stages: [
          ...stages,
          { ...createManualStage("Ungrouped"), entries: removed.entries },
        ],
      };
    });
  }
  function addEntry(stageId: string) {
    const entry = createManualEntry();
    changeDraft((current) => ({
      ...current,
      stages: current.stages.map((stage) =>
        stage.id === stageId
          ? { ...stage, entries: [...stage.entries, entry] }
          : stage,
      ),
    }));
    setExpanded((current) => new Set([...current, entry.id]));
    setSearch("");
    setFilter("all");
  }
  function commitBatch() {
    if (!draft || !batchStage || !batch.trim()) {
      setError(
        "Paste at least one Codeforces link or explicit ID into the batch.",
      );
      return;
    }
    try {
      changeDraft(addPastedEntries(draft, batchStage, batch));
      setBatch("");
      setBatchStage(null);
      setSearch("");
      setFilter("all");
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The batch could not be added. Your text is still here.",
      );
    }
  }
  function matches(entry: TrackImportEntry) {
    const text =
      `${entry.title} ${entry.code} ${entry.url} ${entry.pattern} ${entry.source?.text ?? ""}`.toLowerCase();
    return (
      text.includes(search.toLowerCase().trim()) &&
      (filter === "all" ||
        (filter === "unresolved" && unresolved.has(entry.id)) ||
        (filter === "review" && entryNeedsReview(entry)) ||
        (filter === "duplicates" && repeated.has(entry.id)) ||
        (filter === "excluded" && entry.excluded))
    );
  }

  return (
    <Modal
      title={
        initialDraft
          ? "Edit your track."
          : draft
            ? mode === "shared"
              ? "Make this track your own."
              : "Make this sheet your own."
            : mode === "shared"
              ? "Import shared track."
              : "Import a practice sheet."
      }
      onClose={cancel}
      className={styles.modal}
    >
      <div className={styles.scroll}>
        {discarding && (
          <section
            role="alert"
            className={styles.notice}
            aria-label="Discard unsaved track edits"
          >
            <h3>Discard this draft?</h3>
            <p>
              Your unsaved edits will be lost. Saved practice and learning
              history will remain.
            </p>
            <div className={styles.actions}>
              <button
                ref={discardRef}
                type="button"
                className="button secondary"
                onClick={() => setDiscarding(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  if (
                    discardTarget === "manual" ||
                    discardTarget === "shared"
                  ) {
                    setPasted("");
                    setMode(discardTarget);
                    setDraft(
                      discardTarget === "manual"
                        ? createManualTrackDraft()
                        : null,
                    );
                    setDirty(discardTarget === "manual");
                    setError("");
                    setDiscarding(false);
                    return;
                  }
                  onClose();
                  if (discardTarget !== "close") router.push(discardTarget);
                }}
              >
                Discard draft
              </button>
            </div>
          </section>
        )}
        {error && (
          <div className={styles.error} role="alert">
            {error}
            {!pending && writeFailed && (
              <>
                <br />
                <Link className="text-link" href="/settings">
                  Open Settings and recovery copies
                </Link>
              </>
            )}
          </div>
        )}
        {!draft ? (
          <div className={styles.upload}>
            <p>
              Track Studio turns a practice sheet, a pasted batch, or your own
              plan into one editable preview. Nothing is saved until you
              confirm.
            </p>
            <div
              className={styles.entryPoints}
              role="group"
              aria-label="Choose how to create a track"
            >
              <button
                type="button"
                className={`button ${mode === "upload" ? "secondary" : "ghost"}`}
                aria-pressed={mode === "upload"}
                disabled={!!progress}
                onClick={() => {
                  setMode("upload");
                  setError("");
                }}
              >
                Upload a practice sheet
              </button>
              <button
                type="button"
                className={`button ${mode === "paste" ? "secondary" : "ghost"}`}
                aria-pressed={mode === "paste"}
                disabled={!!progress}
                onClick={() => {
                  setMode("paste");
                  setError("");
                }}
              >
                Paste Codeforces links or IDs
              </button>
              <button
                type="button"
                className={`button ${mode === "shared" ? "secondary" : "ghost"}`}
                aria-pressed={mode === "shared"}
                disabled={!!progress}
                onClick={() => {
                  if (pasted.trim()) {
                    setDiscardTarget("shared");
                    setDiscarding(true);
                    return;
                  }
                  setMode("shared");
                  setError("");
                }}
              >
                Import shared track
              </button>
              <button
                type="button"
                className="button ghost"
                disabled={!!progress}
                onClick={() => {
                  if (pasted.trim()) {
                    setDiscardTarget("manual");
                    setDiscarding(true);
                    return;
                  }
                  setMode("manual");
                  setDraft(createManualTrackDraft());
                  setDirty(true);
                  setError("");
                }}
              >
                Create manually
              </button>
            </div>
            {mode === "upload" ? (
              <>
                <label>
                  Practice sheet (DOCX, PDF, PNG or JPEG)
                  <input
                    type="file"
                    accept=".docx,.pdf,.png,.jpg,.jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,image/png,image/jpeg"
                    disabled={!!progress}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void select(file);
                    }}
                  />
                </label>
                <p>
                  DOCX up to 8 MB; PDF and images up to{" "}
                  {DOCUMENT_IMPORT_LIMITS.maxFileBytes / (1024 * 1024)} MB. PDFs
                  up to {DOCUMENT_IMPORT_LIMITS.maxPages} pages. Images up to{" "}
                  {DOCUMENT_IMPORT_LIMITS.maxImagePixels / 1000000} million
                  pixels and{" "}
                  {DOCUMENT_IMPORT_LIMITS.maxImageDimension.toLocaleString()}{" "}
                  pixels per side.
                </p>
                <label className={styles.copyChoice}>
                  <input
                    type="checkbox"
                    checked={forceOCR}
                    disabled={!!progress}
                    onChange={(event) => setForceOCR(event.target.checked)}
                  />
                  Use OCR for all PDF pages
                </label>
                <p>
                  PDF text and links are read first; scanned pages and images
                  use OCR. Processing stays on this device. The first OCR use
                  downloads a worker, recognition engine, and English language
                  assets from Forma. A clear printed image works best; OCR can
                  misread letters and digits. You can cancel processing or retry
                  a failed download.
                </p>
                <FileUp size={30} aria-hidden="true" className="muted" />
              </>
            ) : mode === "shared" ? (
              <>
                <label>
                  Shared track file (.forma-track.json)
                  <input
                    type="file"
                    accept=".forma-track.json,.json,application/json"
                    disabled={!!progress}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void select(file);
                    }}
                  />
                </label>
                <p>
                  Choose a Forma track file, up to{" "}
                  {SHARED_TRACK_LIMITS.maxFileBytes / (1024 * 1024)} MB. Review
                  its stages and problems before saving. The sender’s progress
                  and personal notes are excluded. Your own history may apply to
                  matching problems in this workspace.
                </p>
                <p>
                  No track is made active and no session starts when you import
                  a shared file.
                </p>
              </>
            ) : (
              <>
                <label>
                  <span id={`${fieldId}-paste`}>Codeforces links or IDs</span>
                  <textarea
                    aria-labelledby={`${fieldId}-paste`}
                    value={pasted}
                    disabled={!!progress}
                    rows={8}
                    placeholder={
                      "381A — Sereja and Dima\nhttps://codeforces.com/contest/1358/problem/C1"
                    }
                    onChange={(event) => setPasted(event.target.value)}
                    maxLength={DOCUMENT_IMPORT_LIMITS.maxCharacters}
                  />
                </label>
                <p>
                  Paste one problem per line, or a batch of links and explicit
                  IDs. Titles alone remain visible for you to complete. A
                  recognized ID format does not verify that the problem exists.
                </p>
                <button
                  type="button"
                  className="button primary"
                  onClick={previewPaste}
                >
                  Preview pasted problems
                </button>
              </>
            )}
            {progress && (
              <div role="status" aria-live="polite">
                <p>
                  {progress.phase}
                  {progress.page && progress.pages
                    ? ` · page ${progress.page} of ${progress.pages}`
                    : ""}{" "}
                  · {Math.round(progress.percent)}%
                </p>
                <progress
                  className={styles.progress}
                  max={100}
                  value={progress.percent}
                  aria-label="Import progress"
                />
              </div>
            )}
          </div>
        ) : (
          <div className={styles.editor}>
            <label>
              Track title
              <input
                value={draft.title}
                disabled={pending}
                onChange={(event) =>
                  changeDraft({ ...draft, title: event.target.value })
                }
                maxLength={240}
              />
            </label>
            <label>
              Share description
              <textarea
                value={draft.shareDescription ?? ""}
                disabled={pending}
                rows={3}
                maxLength={5000}
                onChange={(event) =>
                  changeDraft({
                    ...draft,
                    shareDescription: event.target.value,
                  })
                }
              />
            </label>
            <p className={styles.source}>
              Optional curriculum text for sharing. Review this text before
              including it in a track file.
            </p>
            <p className={styles.source}>
              Source: {draft.sourceName}. Ratings and pattern hints are source
              metadata. Recognized ID format is shown below; problem existence
              has not been verified.
            </p>
            <details className={styles.studioNotes}>
              <summary>Track source notes</summary>
              <label>
                <span id={`${fieldId}-track-notes`}>Track source notes</span>
                <textarea
                  aria-labelledby={`${fieldId}-track-notes`}
                  value={draft.sourceNotes ?? ""}
                  rows={3}
                  maxLength={5000}
                  disabled={pending}
                  onChange={(event) =>
                    changeDraft({ ...draft, sourceNotes: event.target.value })
                  }
                />
              </label>
            </details>
            <div className={styles.summary} aria-label="Preview counts">
              {sharedPreview && (
                <span>
                  <strong>{sharedPreview.alreadyPresentCount}</strong> already
                  in your workspace
                </span>
              )}
              <span>
                <strong>{counts?.total}</strong> detected problems
              </span>
              <span>
                <strong>{draft.stages.length}</strong> stages
              </span>
              <span>
                <strong>{counts?.unresolved.length}</strong> unresolved entries
              </span>
              <span>
                <strong>{counts?.duplicates.length}</strong> duplicate entries
              </span>
              <span>
                <strong>{counts?.needsReview.length}</strong> need review
              </span>
              <span>
                <strong>{counts?.excluded}</strong> excluded
              </span>
              <span>
                <strong>{counts?.included}</strong> included
              </span>
            </div>
            {sharedPreview && (
              <p className={styles.notice}>
                Only the curriculum is imported. The sender’s progress is
                excluded; your existing history and schedules may already apply
                to matching problems in your current profile. Imported titles,
                ratings and hints stay as track metadata. Choose Make active
                yourself after saving.
              </p>
            )}
            <p className={styles.saveSummary} aria-live="polite">
              {counts?.unresolved.length || counts?.needsReview.length
                ? "Correct or explicitly exclude unresolved entries, and review uncertain extraction before saving."
                : `${counts?.included ?? 0} problem memberships will be saved. ${counts?.excluded ?? 0} excluded candidates will remain outside this track.`}{" "}
              Duplicate memberships retain their source order and share the
              matching underlying problem.
            </p>
            {!!duplicates.length && (
              <div className={styles.notice}>
                <p>
                  {mode === "shared"
                    ? "An equivalent track already exists in your workspace."
                    : "This sheet already belongs to your workspace."}
                </p>
                <div className={styles.actions}>
                  {duplicates.map((track) => (
                    <div key={track.id} className={styles.actions}>
                      {mode === "shared" && (
                        <span className={styles.curriculumText}>
                          {track.title}
                        </span>
                      )}
                      <Link
                        className="text-link"
                        href={`/tracks/${encodeURIComponent(track.id)}`}
                        onClick={(event) => {
                          if (dirty) {
                            event.preventDefault();
                            setDiscardTarget(
                              `/tracks/${encodeURIComponent(track.id)}`,
                            );
                            setDiscarding(true);
                          }
                        }}
                      >
                        {mode === "shared"
                          ? "Open existing track"
                          : `Open existing: ${track.title}`}
                      </Link>
                    </div>
                  ))}
                </div>
                <label className={styles.copyChoice}>
                  <input
                    type="checkbox"
                    checked={copy}
                    disabled={pending}
                    onChange={(event) => {
                      setCopy(event.target.checked);
                      setDirty(true);
                    }}
                  />
                  {mode === "shared"
                    ? "Import a separate copy"
                    : "Import a separate copy of this track"}
                </label>
                <p>
                  The same matching underlying problems and learning history
                  will be reused.
                </p>
              </div>
            )}
            <div className={styles.studioToolbar}>
              <label>
                Search preview
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  disabled={pending}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title, ID or source text"
                />
              </label>
              <label>
                Preview filter
                <select
                  value={filter}
                  disabled={pending}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="all">All entries</option>
                  <option value="unresolved">Unresolved</option>
                  <option value="review">Needs review</option>
                  <option value="duplicates">Duplicates</option>
                  <option value="excluded">Excluded</option>
                </select>
              </label>
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => {
                  const stage = createManualStage();
                  changeDraft({
                    ...draft,
                    stages: [...draft.stages, stage],
                  });
                  setOpenStages((current) => new Set([...current, stage.id]));
                  setSearch("");
                  setFilter("all");
                }}
              >
                <Plus size={16} />
                Add stage
              </button>
            </div>
            {draft.stages.map((stage, stageIndex) => {
              const visible = stage.entries.filter(matches);
              if ((search || filter !== "all") && !visible.length) return null;
              return (
                <details
                  className={styles.editorStage}
                  key={stage.id}
                  open={
                    openStages.has(stage.id) || !!search || filter !== "all"
                  }
                  onToggle={(event) => {
                    if (event.target !== event.currentTarget) return;
                    const open = event.currentTarget.open;
                    setOpenStages((current) => {
                      if (current.has(stage.id) === open) return current;
                      const next = new Set(current);
                      if (open) next.add(stage.id);
                      else next.delete(stage.id);
                      return next;
                    });
                  }}
                  data-studio-stage={stage.id}
                >
                  <summary>
                    {stageIndex + 1}. {stage.title || "Untitled stage"}
                    <span className={styles.source}>
                      · {stage.entries.length} problems
                    </span>
                  </summary>
                  <div className={styles.stageBody}>
                    {sharedPreview && stage.description && (
                      <p className={styles.curriculumText}>
                        {stage.description}
                      </p>
                    )}
                    {sharedPreview && stage.suggestedTime && (
                      <p className={styles.source}>
                        Suggested practice time: {stage.suggestedTime}
                      </p>
                    )}
                    <details className={styles.stageSettings}>
                      <summary>Edit stage details</summary>
                      <div className={styles.stageFields}>
                        <label>
                          Stage {stageIndex + 1} title
                          <input
                            value={stage.title}
                            disabled={pending}
                            onChange={(event) =>
                              stageEdit(stage.id, { title: event.target.value })
                            }
                            maxLength={240}
                          />
                        </label>
                        <label>
                          <span id={`${fieldId}-${stage.id}-description`}>
                            Stage description
                          </span>
                          <textarea
                            aria-labelledby={`${fieldId}-${stage.id}-description`}
                            value={stage.description}
                            disabled={pending}
                            rows={3}
                            onChange={(event) =>
                              stageEdit(stage.id, {
                                description: event.target.value,
                              })
                            }
                            maxLength={5000}
                          />
                        </label>
                        <label>
                          Suggested practice time
                          <input
                            value={stage.suggestedTime}
                            disabled={pending}
                            onChange={(event) =>
                              stageEdit(stage.id, {
                                suggestedTime: event.target.value,
                              })
                            }
                            maxLength={240}
                          />
                        </label>
                        <label className={styles.wide}>
                          <span id={`${fieldId}-${stage.id}-notes`}>
                            Stage source notes
                          </span>
                          <textarea
                            aria-labelledby={`${fieldId}-${stage.id}-notes`}
                            value={stage.sourceNotes ?? ""}
                            disabled={pending}
                            rows={3}
                            onChange={(event) =>
                              stageEdit(stage.id, {
                                sourceNotes: event.target.value,
                              })
                            }
                            maxLength={5000}
                          />
                        </label>
                      </div>
                    </details>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={pending || stageIndex === 0}
                        aria-label={`Move stage ${stageIndex + 1} up`}
                        onClick={() =>
                          changeDraft({
                            ...draft,
                            stages: move(draft.stages, stageIndex, -1),
                          })
                        }
                      >
                        <ArrowUp size={16} />
                        Move stage up
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={
                          pending || stageIndex === draft.stages.length - 1
                        }
                        aria-label={`Move stage ${stageIndex + 1} down`}
                        onClick={() =>
                          changeDraft({
                            ...draft,
                            stages: move(draft.stages, stageIndex, 1),
                          })
                        }
                      >
                        <ArrowDown size={16} />
                        Move stage down
                      </button>
                      <button
                        type="button"
                        className="button ghost"
                        disabled={pending}
                        aria-label={`Remove stage ${stageIndex + 1} and move its problems to Ungrouped`}
                        onClick={() => removeStage(stage.id)}
                      >
                        <Trash2 size={16} />
                        Remove stage
                      </button>
                    </div>
                    {!!stage.entries.length && (
                      <p className={styles.source}>
                        Open a row to correct it. Excluded candidates stay
                        visible here; removing a stage moves its problems to
                        Ungrouped.
                      </p>
                    )}
                    {visible.map((entry) => {
                      const entryIndex = stage.entries.findIndex(
                        (value) => value.id === entry.id,
                      );
                      const isUnresolved = unresolved.has(entry.id);
                      const needsReview = entryNeedsReview(entry);
                      const isDuplicate = repeated.has(entry.id);
                      return (
                        <details
                          className={`${styles.editorEntry} ${entry.excluded ? styles.excludedEntry : ""}`}
                          key={entry.id}
                          open={expanded.has(entry.id)}
                          onToggle={(event) => {
                            if (event.target !== event.currentTarget) return;
                            const open = event.currentTarget.open;
                            setExpanded((current) => {
                              if (current.has(entry.id) === open)
                                return current;
                              const next = new Set(current);
                              if (open) next.add(entry.id);
                              else next.delete(entry.id);
                              return next;
                            });
                          }}
                          data-studio-entry={entry.id}
                        >
                          <summary className={styles.entrySummary}>
                            <span className={styles.position}>
                              {entryIndex + 1}.
                            </span>
                            <span className={styles.entryName}>
                              {entry.title || "Untitled problem"}
                              <span className={styles.entryStatus}>
                                {entry.excluded
                                  ? "Excluded from save"
                                  : isUnresolved
                                    ? "Unresolved identity or title"
                                    : `${entry.code} · Recognized ID format`}
                                {isDuplicate ? " · Duplicate identity" : ""}
                                {alreadyPresent.has(
                                  trackEntryIdentity(entry)?.key ?? "",
                                )
                                  ? " · Already in your workspace"
                                  : ""}
                                {needsReview ? " · Needs review" : ""}
                              </span>
                            </span>
                            <span className={styles.editCue}>Edit</span>
                          </summary>
                          <div className={styles.entryBody}>
                            {sharedPreview && entry.pattern && (
                              <p className={styles.curriculumText}>
                                <strong>Included pattern hint:</strong>{" "}
                                {entry.pattern}
                              </p>
                            )}
                            <div className={styles.entryFields}>
                              <label className={styles.wide}>
                                Problem {entryIndex + 1} title
                                <input
                                  value={entry.title}
                                  disabled={pending}
                                  onChange={(event) =>
                                    entryEdit(stage.id, entry.id, {
                                      title: event.target.value,
                                    })
                                  }
                                  maxLength={240}
                                />
                              </label>
                              <label>
                                Codeforces ID
                                <input
                                  value={entry.code}
                                  placeholder="e.g. 1358C1"
                                  disabled={pending}
                                  onChange={(event) => {
                                    const code = event.target.value;
                                    if (entry.url)
                                      namespaces.current.set(
                                        entry.id,
                                        entry.url,
                                      );
                                    const identity = identityFromCode(
                                      code,
                                      entry.url ||
                                        namespaces.current.get(entry.id) ||
                                        "",
                                    );
                                    entryEdit(stage.id, entry.id, {
                                      code,
                                      url: identity?.url ?? "",
                                    });
                                  }}
                                  maxLength={60}
                                />
                              </label>
                              <label>
                                Source rating
                                <input
                                  type="number"
                                  value={entry.rating ?? ""}
                                  min={0}
                                  max={10000}
                                  step={1}
                                  disabled={pending}
                                  onChange={(event) =>
                                    entryEdit(stage.id, entry.id, {
                                      rating:
                                        event.target.value === ""
                                          ? null
                                          : Number(event.target.value),
                                    })
                                  }
                                />
                              </label>
                              <label className={styles.wide}>
                                Codeforces URL
                                <input
                                  value={entry.url}
                                  disabled={pending}
                                  placeholder="https://codeforces.com/problemset/problem/1358/C1"
                                  onChange={(event) => {
                                    const url = event.target.value;
                                    const identity =
                                      normalizeCodeforcesIdentity({ url });
                                    if (identity)
                                      namespaces.current.set(
                                        entry.id,
                                        identity.url,
                                      );
                                    entryEdit(stage.id, entry.id, {
                                      url,
                                      ...(identity
                                        ? { code: identity.code }
                                        : {}),
                                    });
                                  }}
                                  maxLength={2000}
                                />
                              </label>
                              <label>
                                Stage assignment
                                <select
                                  aria-label="Stage assignment"
                                  value={stage.id}
                                  disabled={pending}
                                  onChange={(event) =>
                                    relocate(
                                      stage.id,
                                      entry.id,
                                      event.target.value,
                                    )
                                  }
                                >
                                  {draft.stages.map((value) => (
                                    <option key={value.id} value={value.id}>
                                      {value.title || "Untitled stage"}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Source pattern hint
                                <input
                                  value={entry.pattern}
                                  disabled={pending}
                                  onChange={(event) =>
                                    entryEdit(stage.id, entry.id, {
                                      pattern: event.target.value,
                                    })
                                  }
                                  maxLength={2000}
                                />
                              </label>
                            </div>
                            {isUnresolved && (
                              <p className={styles.unresolved}>
                                Enter a title and a supported Codeforces URL or
                                explicit ID. Titles alone cannot identify a
                                problem. The ID and URL must agree.
                              </p>
                            )}
                            {entry.source && (
                              <div
                                className={styles.evidence}
                                aria-label={`Source evidence for problem ${entryIndex + 1}`}
                              >
                                <p className={styles.source}>
                                  <strong>Source:</strong>{" "}
                                  {entry.source.location}
                                  {entry.source.page
                                    ? ` · page ${entry.source.page}`
                                    : ""}
                                  {entry.source.kind === "ocr" &&
                                  entry.source.confidence !== undefined
                                    ? ` · OCR confidence ${Math.round(entry.source.confidence)}%`
                                    : ""}
                                </p>
                                <p className={styles.extractedText}>
                                  {entry.source.text ||
                                    "No recoverable source text."}
                                </p>
                                {!!entry.source.reviewReasons?.length && (
                                  <ul>
                                    {entry.source.reviewReasons.map(
                                      (reason, index) => (
                                        <li key={`${index}-${reason}`}>
                                          {reason}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                )}
                                {entry.source.kind === "ocr" && (
                                  <p>
                                    An image may contain a title without an ID
                                    or hyperlink. Enter the missing identity
                                    yourself; Forma does not guess from a title.
                                  </p>
                                )}
                              </div>
                            )}
                            {(entry.source?.kind === "ocr" ||
                              !!entry.source?.reviewReasons?.length) && (
                              <label className={styles.copyChoice}>
                                <input
                                  type="checkbox"
                                  checked={!!entry.reviewed}
                                  disabled={pending}
                                  onChange={(event) =>
                                    entryEdit(stage.id, entry.id, {
                                      reviewed: event.target.checked,
                                    })
                                  }
                                />
                                I reviewed this extracted entry
                              </label>
                            )}
                            <div className={styles.actions}>
                              <button
                                type="button"
                                className="button secondary"
                                disabled={pending || entryIndex === 0}
                                aria-label={`Move problem ${entryIndex + 1} up in ${stage.title}`}
                                onClick={() =>
                                  stageEdit(stage.id, {
                                    entries: move(
                                      stage.entries,
                                      entryIndex,
                                      -1,
                                    ),
                                  })
                                }
                              >
                                <ArrowUp size={16} />
                                Move up
                              </button>
                              <button
                                type="button"
                                className="button secondary"
                                disabled={
                                  pending ||
                                  entryIndex === stage.entries.length - 1
                                }
                                aria-label={`Move problem ${entryIndex + 1} down in ${stage.title}`}
                                onClick={() =>
                                  stageEdit(stage.id, {
                                    entries: move(stage.entries, entryIndex, 1),
                                  })
                                }
                              >
                                <ArrowDown size={16} />
                                Move down
                              </button>
                              <button
                                type="button"
                                className="button ghost"
                                disabled={pending}
                                aria-label={`${entry.excluded ? "Include" : "Exclude"} problem ${entryIndex + 1} from ${stage.title}`}
                                onClick={() =>
                                  entryEdit(stage.id, entry.id, {
                                    excluded: !entry.excluded,
                                  })
                                }
                              >
                                {entry.excluded
                                  ? "Include in save"
                                  : "Exclude from save"}
                              </button>
                            </div>
                          </div>
                        </details>
                      );
                    })}
                    {!visible.length && (
                      <p className={styles.source}>
                        This stage has no entries. Add a problem or a pasted
                        batch when you are ready.
                      </p>
                    )}
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={pending}
                        onClick={() => addEntry(stage.id)}
                      >
                        <Plus size={16} />
                        Add problem
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={pending}
                        onClick={() => {
                          if (batch.trim()) {
                            setError(
                              "Your pasted batch is still here. Add it to the stage or clear the text before opening another batch.",
                            );
                            return;
                          }
                          setBatchStage(stage.id);
                          setBatch("");
                        }}
                      >
                        Add pasted batch
                      </button>
                    </div>
                    {batchStage === stage.id && (
                      <div className={styles.batchPanel}>
                        <label>
                          <span id={`${fieldId}-batch`}>
                            Batch for {stage.title}
                          </span>
                          <textarea
                            aria-labelledby={`${fieldId}-batch`}
                            value={batch}
                            disabled={pending}
                            rows={6}
                            maxLength={DOCUMENT_IMPORT_LIMITS.maxCharacters}
                            onChange={(event) => setBatch(event.target.value)}
                            placeholder={
                              "381A\nhttps://codeforces.com/contest/1358/problem/C1"
                            }
                          />
                        </label>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className="button primary"
                            disabled={pending}
                            onClick={commitBatch}
                          >
                            Add batch to stage
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={pending}
                            onClick={() => {
                              if (batch.trim()) {
                                setError(
                                  "Your pasted batch is still here. Add it to the stage or clear the text before closing the batch.",
                                );
                                return;
                              }
                              setBatchStage(null);
                            }}
                          >
                            Close batch
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
            {!draft.stages.length && (
              <p className={styles.notice}>
                This is an empty track. You can save it now, or add a stage to
                start planning.
              </p>
            )}
            {!!draft.stages.length &&
              (search || filter !== "all") &&
              !draft.stages.some((stage) => stage.entries.some(matches)) && (
                <p className={styles.notice}>
                  No entries match this filter. Clear the search or choose All
                  entries.
                </p>
              )}
          </div>
        )}
      </div>
      <div className={styles.footer}>
        {draft && (
          <p className={styles.footerCounts}>
            {counts?.included ?? 0} included · {counts?.unresolved.length ?? 0}{" "}
            unresolved · {counts?.needsReview.length ?? 0} need review ·{" "}
            {counts?.excluded ?? 0} excluded
          </p>
        )}
        <button
          className="button secondary"
          onClick={cancel}
          disabled={pending}
        >
          {progress ? "Cancel processing" : "Cancel"}
        </button>
        {draft && (
          <button
            className="button primary"
            disabled={
              pending ||
              !!counts?.unresolved.length ||
              !!counts?.needsReview.length ||
              (!!duplicates.length && !copy) ||
              !!batch.trim()
            }
            onClick={() => void save()}
          >
            {pending
              ? "Saving track…"
              : writeFailed
                ? "Retry saving track"
                : initialDraft
                  ? "Save track changes"
                  : "Confirm import"}
          </button>
        )}
      </div>
    </Modal>
  );
}
