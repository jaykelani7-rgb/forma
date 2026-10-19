"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import Link from "next/link";
import {
  listOwnedShares,
  publicationOperation,
  publishShare,
} from "@/lib/share-links-client";
import { sharePath, type Publication } from "@/lib/share-links";
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
  const { savedData, data, guardWorkspace, notify, account, workspaceKey } =
    useWorkspace();
  const [snapshot] = useState(savedData);
  const [includeDescriptions, setIncludeDescriptions] = useState(false);
  const [includeHints, setIncludeHints] = useState(false);
  const [shareDescription, setShareDescription] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [unlisted, setUnlisted] = useState(false);
  const [linkReady, setLinkReady] = useState(false);
  const [linkReason, setLinkReason] = useState("Checking link sharing…");
  const [publication, setPublication] = useState<{
    value: Publication;
    text: string;
  } | null>(null);
  const publicationRequest = useRef<{ text: string; id: string } | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const accountId =
    workspaceKey === `account:${account?.id}` ? account?.id : undefined;
  const owner = useRef(guardWorkspace());
  const profile = useRef(data.codeforces.connectedHandle?.toLowerCase() ?? "");
  const mounted = useRef(true);
  const busy = useRef(false);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    requestController.current = controller;
    listOwnedShares(accountId, controller.signal)
      .then(() => {
        if (
          mounted.current &&
          owner.current() &&
          !controller.signal.aborted &&
          accountId
        ) {
          setLinkReady(true);
          setLinkReason("");
        }
      })
      .catch((failure) => {
        if (mounted.current && owner.current() && !controller.signal.aborted)
          setLinkReason(
            failure instanceof Error
              ? failure.message
              : "Link sharing is unavailable. Download a track file instead.",
          );
      });
    return () => controller.abort();
  }, [accountId]);
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
  const published =
    publication?.text === preview.text ? publication.value.share : null;

  async function publish() {
    if (
      busy.current ||
      !file ||
      !accountId ||
      !linkReady ||
      !unlisted ||
      !owner.current() ||
      !mounted.current
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    const isCurrent = () =>
      mounted.current &&
      owner.current() &&
      !requestController.current?.signal.aborted;
    try {
      if (publicationRequest.current?.text !== preview.text)
        publicationRequest.current = {
          text: preview.text,
          id: await publicationOperation(accountId, file),
        };
      if (!isCurrent()) return;
      const value = await publishShare(
        accountId,
        file,
        publicationRequest.current.id,
        requestController.current?.signal,
      );
      if (!isCurrent()) return;
      setPublication({ value, text: preview.text });
      notify(
        value.share.revokedAt
          ? "This snapshot’s earlier link was revoked. Revise its content to create a new link."
          : "Share link created. Your snapshot is ready to send.",
      );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Publication did not finish. Retry uses the same request, or check My shared tracks.",
        );
    } finally {
      busy.current = false;
      if (isCurrent()) setPending(false);
    }
  }
  async function copyLink() {
    if (!published || !owner.current()) return;
    try {
      await navigator.clipboard.writeText(
        new URL(sharePath(published.token), window.location.origin).href,
      );
      if (mounted.current && owner.current()) notify("Share link copied.");
    } catch {
      if (mounted.current && owner.current())
        setError("Open the snapshot and copy its address to send the link.");
    }
  }

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
        <section
          aria-label="Create an unlisted share link"
          className={styles.sharePreview}
        >
          <h3>Create a share link.</h3>
          <p className={styles.notice}>
            Unlisted means anyone with the link can view this exact snapshot
            without signing in. Private edits won’t change it. Publishing
            revised content creates a new link; older links remain available
            until revoked.
          </p>
          {linkReason && (
            <p className={styles.source} role="status">
              {linkReason} File export is available without an account.
            </p>
          )}
          {!accountId && (
            <Link href="/settings#account" className="text-link">
              Account settings
            </Link>
          )}
          {linkReady && (
            <label className={styles.copyChoice}>
              <input
                type="checkbox"
                checked={unlisted}
                disabled={pending}
                onChange={(event) => setUnlisted(event.target.checked)}
              />
              I understand anyone with this link can view the snapshot.
            </label>
          )}
          <button
            className="button primary"
            disabled={
              pending || !file || !linkReady || !unlisted || !!published
            }
            onClick={publish}
          >
            {pending ? "Preparing…" : "Create share link"}
          </button>
          {published && (
            <div role="status" className={styles.notice}>
              <p>
                {published.revokedAt
                  ? "This snapshot’s link was revoked. Change the shared content to publish a new revision."
                  : "Your share link is ready. You can send it to a friend."}
              </p>
              {!published.revokedAt && (
                <div className={styles.actions}>
                  <Link
                    prefetch={false}
                    href={sharePath(published.token)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                  >
                    View published snapshot
                  </Link>
                  <button className="button secondary" onClick={copyLink}>
                    Copy link
                  </button>
                </div>
              )}
            </div>
          )}
          <p>
            <Link href="/tracks/shared" className="text-link">
              My shared tracks
            </Link>
          </p>
        </section>
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
