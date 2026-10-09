"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  encodeSharedTrack,
  sharedTrackFilename,
  sharedTrackFromTrack,
} from "@/lib/shared-tracks";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";
import styles from "./tracks.module.css";

export function TrackShare({
  trackId,
  onClose,
}: {
  trackId: string;
  onClose: () => void;
}) {
  const { savedData, data, guardWorkspace, notify } = useWorkspace();
  const [snapshot] = useState(savedData);
  const [includeDescriptions, setIncludeDescriptions] = useState(false);
  const [includeHints, setIncludeHints] = useState(false);
  const [shareDescription, setShareDescription] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const owner = useRef(guardWorkspace());
  const profile = useRef(data.codeforces.connectedHandle?.toLowerCase() ?? "");
  const mounted = useRef(true);
  const busy = useRef(false);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    if (
      !owner.current() ||
      profile.current !== (data.codeforces.connectedHandle?.toLowerCase() ?? "")
    )
      onClose();
  }, [data, onClose]);
  useEffect(() => {
    mounted.current = true;
    const downloads = urls.current;
    return () => {
      mounted.current = false;
      for (const url of downloads) URL.revokeObjectURL(url);
      downloads.clear();
    };
  }, []);
  const preview = useMemo(() => {
    try {
      if (!snapshot.tracks?.some((track) => track.id === trackId))
        throw new Error(
          "Save this track before sharing. If a save failed, review Settings and retry it.",
        );
      const file = sharedTrackFromTrack(snapshot, trackId, {
        includeDescriptions,
        includeHints,
        shareDescription,
      });
      return { file, text: encodeSharedTrack(file), error: "" };
    } catch (failure) {
      return {
        file: null,
        text: "",
        error:
          failure instanceof Error
            ? failure.message
            : "This saved track could not be prepared for sharing.",
      };
    }
  }, [snapshot, trackId, includeDescriptions, includeHints, shareDescription]);
  const file = preview.file;
  const filename = file ? sharedTrackFilename(file.track.title) : "";
  const problemCount =
    file?.track.stages.reduce((sum, stage) => sum + stage.problems.length, 0) ??
    0;

  function download() {
    if (
      busy.current ||
      !file ||
      !mounted.current ||
      !owner.current() ||
      profile.current !== (data.codeforces.connectedHandle?.toLowerCase() ?? "")
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const url = URL.createObjectURL(
        new Blob([preview.text], { type: "application/json" }),
      );
      urls.current.add(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 1000);
      setPrepared(true);
      notify("Track file prepared. You can send it to a friend.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The track file could not be downloaded. Your choices are still here.",
      );
    } finally {
      setTimeout(() => {
        busy.current = false;
        if (mounted.current) setPending(false);
      }, 250);
    }
  }

  return (
    <Modal title="Share track." onClose={onClose} className={styles.modal}>
      <div className={styles.scroll}>
        <p className={styles.notice}>
          Download the practice structure to send to a friend. Your progress,
          reflections, personal notes, schedules and account details stay in
          your workspace. This track file is separate from a workspace backup.
        </p>
        <div className={styles.shareOptions}>
          <label className={styles.copyChoice}>
            <input
              type="checkbox"
              checked={includeDescriptions}
              disabled={pending}
              onChange={(event) => {
                setIncludeDescriptions(event.target.checked);
                setPrepared(false);
              }}
            />
            Include descriptions
          </label>
          <label className={styles.copyChoice}>
            <input
              type="checkbox"
              checked={includeHints}
              disabled={pending}
              onChange={(event) => {
                setIncludeHints(event.target.checked);
                setPrepared(false);
              }}
            />
            Include pattern hints
          </label>
          <label>
            Share description
            <textarea
              rows={3}
              maxLength={5000}
              value={shareDescription}
              disabled={pending}
              onChange={(event) => {
                setShareDescription(event.target.value);
                setPrepared(false);
              }}
              aria-describedby="forma-share-description-help"
            />
          </label>
          <p id="forma-share-description-help" className={styles.source}>
            Optional text to include in this file. Type any attribution
            yourself; Forma never adds an author from your account. Review all
            included descriptions and hints below before downloading.
          </p>
        </div>
        {(preview.error || error) && (
          <p role="alert" className={styles.error}>
            {preview.error || error}
          </p>
        )}
        {file && (
          <section
            aria-label="Track file content"
            className={styles.sharePreview}
          >
            <div className={styles.summary} aria-label="Shared track counts">
              <span>
                <strong>{file.track.stages.length}</strong> stages
              </span>
              <span>
                <strong>{problemCount}</strong> problem memberships
              </span>
              <span>Forma track file · version {file.version}</span>
            </div>
            <h3>{file.track.title}</h3>
            {file.track.shareDescription && (
              <p className={styles.curriculumText}>
                {file.track.shareDescription}
              </p>
            )}
            <p className={styles.source}>Download name: {filename}</p>
            <ol className={styles.shareStages}>
              {file.track.stages.map((stage, stageIndex) => (
                <li key={stageIndex}>
                  <h4>
                    {stageIndex + 1}. {stage.title}
                  </h4>
                  {stage.description && (
                    <p className={styles.curriculumText}>{stage.description}</p>
                  )}
                  {stage.suggestedTime && (
                    <p className={styles.source}>
                      Suggested practice time: {stage.suggestedTime}
                    </p>
                  )}
                  <ol className={styles.shareProblems}>
                    {stage.problems.map((problem, index) => (
                      <li key={index}>
                        <strong>
                          {index + 1}. {problem.title}
                        </strong>
                        <p className={styles.source}>
                          {problem.code} · Source rating:{" "}
                          {problem.rating === null
                            ? "not provided"
                            : problem.rating}
                        </p>
                        <p className={styles.shareUrl}>{problem.url}</p>
                        {problem.hint && (
                          <p className={styles.curriculumText}>
                            <strong>Pattern hint:</strong> {problem.hint}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                  {!stage.problems.length && (
                    <p className={styles.source}>No problems in this stage.</p>
                  )}
                </li>
              ))}
            </ol>
            {!file.track.stages.length && (
              <p className={styles.source}>This track has no stages.</p>
            )}
          </section>
        )}
        {prepared && (
          <p role="status" className={styles.notice}>
            Your track file is ready to send. Your friend can choose Import
            shared track in Forma.
          </p>
        )}
      </div>
      <div className={styles.footer}>
        <button className="button secondary" onClick={onClose}>
          Close
        </button>
        <button
          className="button primary"
          disabled={pending || !file}
          onClick={download}
        >
          <Download size={18} />
          {pending ? "Preparing track file…" : "Download track file"}
        </button>
      </div>
    </Modal>
  );
}
