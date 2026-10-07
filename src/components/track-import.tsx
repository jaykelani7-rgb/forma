"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  parsePracticeSheet,
  analyzePracticeSheet,
  DOCX_IMPORT_LIMITS,
} from "@/lib/docx-import";
import { findDuplicateTracks, importTrack, updateTrack } from "@/lib/tracks";
import type { TrackImportDraft, TrackImportEntry } from "@/lib/tracks-types";
import { normalizeCodeforcesIdentity } from "@/lib/codeforces-identity";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";
import styles from "./tracks.module.css";

function move<T>(values: T[], index: number, direction: number): T[] {
  const next = [...values];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function TrackImport({
  onClose,
  initialDraft,
}: {
  onClose: () => void;
  initialDraft?: TrackImportDraft;
}) {
  const { data, update, notify, guardWorkspace, retryLocalSave } =
    useWorkspace();
  const router = useRouter();
  const [draft, setDraft] = useState<TrackImportDraft | null>(
    initialDraft ?? null,
  );
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{
    phase: string;
    percent: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [copy, setCopy] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const owner = useRef(guardWorkspace());
  useEffect(() => {
    if (!owner.current()) {
      controller.current?.abort();
      onClose();
    }
  }, [data, onClose]);
  useEffect(() => () => controller.current?.abort(), []);

  function cancel() {
    if (pending) return;
    controller.current?.abort();
    onClose();
  }

  async function select(file: File) {
    if (busy.current) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError(
        "Choose a .docx practice sheet. PDF, images, and older .doc files are not supported.",
      );
      return;
    }
    if (file.size > DOCX_IMPORT_LIMITS.maxFileBytes) {
      setError("This file is too large. Choose a DOCX smaller than 8 MB.");
      return;
    }
    const isCurrent = guardWorkspace();
    const abort = new AbortController();
    controller.current = abort;
    busy.current = true;
    setError("");
    setProgress({ phase: "Reading practice sheet", percent: 0 });
    try {
      const parsed = await parsePracticeSheet(
        await file.arrayBuffer(),
        file.name,
        {
          signal: abort.signal,
          onProgress: (value) => {
            if (isCurrent() && !abort.signal.aborted) setProgress(value);
          },
        },
      );
      if (!isCurrent() || abort.signal.aborted) return;
      setDraft(parsed);
      setCopy(false);
    } catch (failure) {
      if (isCurrent() && !abort.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "This sheet could not be read. Try a valid DOCX containing Codeforces problem links.",
        );
    } finally {
      busy.current = false;
      if (isCurrent()) setProgress(null);
    }
  }

  async function save() {
    if (!draft || busy.current) return;
    const isCurrent = guardWorkspace();
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const change = (current: typeof data) =>
        initialDraft
          ? updateTrack(current, draft)
          : importTrack(current, draft, {
              duplicates: copy ? "copy" : "reject",
            });
      const saved = await (writeFailed
        ? retryLocalSave(change)
        : update(change));
      if (!isCurrent()) return;
      if (!saved) {
        setWriteFailed(true);
        setError(
          `Your preview is still here. This ${initialDraft ? "edit" : "import"} was not committed. Review the storage message and recovery copies in Settings, then retry.`,
        );
        return;
      }
      notify(
        initialDraft
          ? "Track updated."
          : "Practice sheet imported. Choose a stage and make it your own.",
      );
      onClose();
      router.push(`/tracks/${encodeURIComponent(draft.id)}`);
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "The track could not be saved. Your preview is still here for retry.",
        );
    } finally {
      busy.current = false;
      if (isCurrent()) setPending(false);
    }
  }

  const counts = draft && analyzePracticeSheet(draft);
  const duplicates =
    draft && !initialDraft
      ? findDuplicateTracks(data, draft).filter(
          (track) => track.id !== draft.id,
        )
      : [];
  function entryEdit(
    stageId: string,
    entryId: string,
    changes: Partial<TrackImportEntry>,
  ) {
    setDraft(
      (current) =>
        current && {
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
        },
    );
  }
  function relocate(stageId: string, entryId: string, target: string) {
    setDraft((current) => {
      if (!current || stageId === target) return current;
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
  }

  return (
    <Modal
      title={
        initialDraft
          ? "Edit your track."
          : draft
            ? "Make this sheet your own."
            : "Import a practice sheet."
      }
      onClose={cancel}
      className={styles.modal}
    >
      <div className={styles.scroll}>
        {error && (
          <div className={styles.error} role="alert">
            {error}
            {pending || !writeFailed ? null : (
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
              Upload a DOCX with Codeforces links. Forma reads headings, tables,
              problem order, and source notes. Review everything before saving.
            </p>
            <label>
              Practice sheet (.docx)
              <input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={!!progress}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void select(file);
                }}
              />
            </label>
            <p>
              Up to 8 MB. PDF, image OCR, and older .doc files are not
              supported. Sheets contain links and metadata; full problem
              statements are not imported.
            </p>
            {progress && (
              <div role="status" aria-live="polite">
                <p>
                  {progress.phase} · {progress.percent}%
                </p>
                <progress
                  className={styles.progress}
                  max={100}
                  value={progress.percent}
                  aria-label="Import progress"
                />
              </div>
            )}
            <FileUp size={30} aria-hidden="true" className="muted" />
          </div>
        ) : (
          <div className={styles.editor}>
            <label>
              Track title
              <input
                value={draft.title}
                disabled={pending}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
                maxLength={240}
              />
            </label>
            <p className={styles.source}>
              Source: {draft.sourceName}. Titles, ratings, and pattern hints
              below come from your sheet.
            </p>
            <div className={styles.summary} aria-label="Preview counts">
              <span>
                <strong>{counts?.problemCount}</strong> detected problems
              </span>
              <span>
                <strong>{counts?.stageCount}</strong> stages
              </span>
              <span>
                <strong>{counts?.unresolvedCount}</strong> unresolved entries
              </span>
              <span>
                <strong>{counts?.duplicateCount}</strong> duplicate entries
              </span>
            </div>
            {!!duplicates?.length && (
              <div className={styles.notice}>
                <p>This sheet already belongs to your workspace.</p>
                <div className={styles.actions}>
                  {duplicates.map((track) => (
                    <Link
                      key={track.id}
                      className="text-link"
                      href={`/tracks/${encodeURIComponent(track.id)}`}
                      onClick={cancel}
                    >
                      Open existing: {track.title}
                    </Link>
                  ))}
                </div>
                <label className={styles.copyChoice}>
                  <input
                    type="checkbox"
                    checked={copy}
                    disabled={pending}
                    onChange={(event) => setCopy(event.target.checked)}
                  />
                  Import a separate copy of this track
                </label>
                <p>
                  The same underlying problems and learning history will be
                  reused.
                </p>
              </div>
            )}
            {draft.stages.map((stage, stageIndex) => (
              <details
                className={styles.editorStage}
                key={stage.id}
                open={stageIndex === 0}
              >
                <summary>
                  {stageIndex + 1}. {stage.title || "Untitled stage"}{" "}
                  <span className={styles.source}>
                    · {stage.entries.length} problems
                  </span>
                </summary>
                <div className={styles.stageBody}>
                  <div className={styles.stageFields}>
                    <label>
                      Stage {stageIndex + 1} title
                      <input
                        value={stage.title}
                        disabled={pending}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            stages: draft.stages.map((value) =>
                              value.id === stage.id
                                ? { ...value, title: event.target.value }
                                : value,
                            ),
                          })
                        }
                        maxLength={240}
                      />
                    </label>
                    <label>
                      Stage description
                      <textarea
                        value={stage.description}
                        disabled={pending}
                        rows={3}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            stages: draft.stages.map((value) =>
                              value.id === stage.id
                                ? { ...value, description: event.target.value }
                                : value,
                            ),
                          })
                        }
                        maxLength={4000}
                      />
                    </label>
                    <label>
                      Suggested practice time
                      <input
                        value={stage.suggestedTime}
                        disabled={pending}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            stages: draft.stages.map((value) =>
                              value.id === stage.id
                                ? {
                                    ...value,
                                    suggestedTime: event.target.value,
                                  }
                                : value,
                            ),
                          })
                        }
                        maxLength={240}
                      />
                    </label>
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={pending || stageIndex === 0}
                      aria-label={`Move stage ${stageIndex + 1} up`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          stages: move(draft.stages, stageIndex, -1),
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
                        pending || stageIndex === draft.stages.length - 1
                      }
                      aria-label={`Move stage ${stageIndex + 1} down`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          stages: move(draft.stages, stageIndex, 1),
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
                      aria-label={`Remove stage ${stageIndex + 1} and its problems`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          stages: draft.stages.filter(
                            (value) => value.id !== stage.id,
                          ),
                        })
                      }
                    >
                      <Trash2 size={16} />
                      Remove stage and its problems
                    </button>
                  </div>
                  {stage.entries.map((entry, entryIndex) => (
                    <div className={styles.editorEntry} key={entry.id}>
                      <p className={styles.source}>Problem {entryIndex + 1}</p>
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
                              const identity = normalizeCodeforcesIdentity({
                                code,
                              });
                              entryEdit(stage.id, entry.id, {
                                code,
                                url: identity?.url ?? "",
                              });
                            }}
                            maxLength={30}
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
                              entryEdit(stage.id, entry.id, {
                                url,
                                code:
                                  normalizeCodeforcesIdentity({ url })?.code ??
                                  "",
                              });
                            }}
                            maxLength={1000}
                          />
                        </label>
                        <label>
                          Stage assignment
                          <select
                            aria-label="Stage assignment"
                            value={stage.id}
                            disabled={pending}
                            onChange={(event) =>
                              relocate(stage.id, entry.id, event.target.value)
                            }
                          >
                            {draft.stages.map((value) => (
                              <option key={value.id} value={value.id}>
                                {value.title}
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
                            maxLength={1000}
                          />
                        </label>
                      </div>
                      {!entry.url && !entry.code && (
                        <span className={styles.unresolved}>
                          Add a Codeforces URL or explicit ID. Titles alone
                          cannot identify a problem.
                        </span>
                      )}
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={pending || entryIndex === 0}
                          aria-label={`Move problem ${entryIndex + 1} up in ${stage.title}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              stages: draft.stages.map((value) =>
                                value.id === stage.id
                                  ? {
                                      ...value,
                                      entries: move(
                                        value.entries,
                                        entryIndex,
                                        -1,
                                      ),
                                    }
                                  : value,
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
                            pending || entryIndex === stage.entries.length - 1
                          }
                          aria-label={`Move problem ${entryIndex + 1} down in ${stage.title}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              stages: draft.stages.map((value) =>
                                value.id === stage.id
                                  ? {
                                      ...value,
                                      entries: move(
                                        value.entries,
                                        entryIndex,
                                        1,
                                      ),
                                    }
                                  : value,
                              ),
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
                          aria-label={`Remove problem ${entryIndex + 1} from ${stage.title}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              stages: draft.stages.map((value) =>
                                value.id === stage.id
                                  ? {
                                      ...value,
                                      entries: value.entries.filter(
                                        (problem) => problem.id !== entry.id,
                                      ),
                                    }
                                  : value,
                              ),
                            })
                          }
                        >
                          <Trash2 size={16} />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
            {!draft.stages.length && (
              <p className={styles.notice}>
                All stages were removed. Choose another file or cancel this
                preview.
              </p>
            )}
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <button
          className="button secondary"
          onClick={cancel}
          disabled={pending}
        >
          {progress ? "Cancel import" : "Cancel"}
        </button>
        {draft && (
          <button
            className="button primary"
            disabled={
              pending ||
              !draft.stages.length ||
              !!counts?.unresolvedCount ||
              (!!duplicates?.length && !copy)
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
