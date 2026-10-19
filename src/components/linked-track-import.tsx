"use client";
import { useEffect, useRef, useState } from "react";
import { readPublicShare } from "@/lib/share-links-client";
import { parseSharedTrack } from "@/lib/shared-tracks";
import type { TrackImportDraft } from "@/lib/tracks-types";
import { useWorkspace } from "./provider";
import { TrackImport } from "./track-import";

export function LinkedTrackImport({ token }: { token: string }) {
  const { ready, guardWorkspace } = useWorkspace();
  const [draft, setDraft] = useState<TrackImportDraft | null>(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const [retry, setRetry] = useState(0);
  const source = useRef("");
  const guard = useRef(guardWorkspace);
  useEffect(() => {
    guard.current = guardWorkspace;
  });
  useEffect(() => {
    if (!ready || closed) return;
    const isCurrent = guard.current();
    const controller = new AbortController();
    readPublicShare(token, controller.signal)
      .then((file) => {
        if (controller.signal.aborted || !isCurrent()) return;
        source.current = JSON.stringify(file);
        setDraft(parseSharedTrack(source.current));
        setError("");
      })
      .catch((failure) => {
        if (!controller.signal.aborted && isCurrent())
          setError(
            failure instanceof Error
              ? failure.message
              : "This share is unavailable.",
          );
      });
    return () => controller.abort();
  }, [ready, token, closed, retry]);
  if (closed) return null;
  if (draft)
    return (
      <TrackImport
        entryPoint="shared"
        newDraft={draft}
        onClose={() => setClosed(true)}
        beforeImport={async () => {
          const active = await readPublicShare(token);
          if (JSON.stringify(active) !== source.current)
            throw new Error(
              "This share changed. Close this preview and reopen the link before importing.",
            );
        }}
      />
    );
  return (
    <section className="notice" aria-live="polite">
      <p>{error || "Opening shared track for review…"}</p>
      {error && (
        <button
          className="button secondary"
          onClick={() => setRetry(retry + 1)}
        >
          Retry shared track
        </button>
      )}
      <button className="button text" onClick={() => setClosed(true)}>
        Dismiss shared track
      </button>
    </section>
  );
}
