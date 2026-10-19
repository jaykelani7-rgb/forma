"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readPublicShare } from "@/lib/share-links-client";
import type { SharedTrackFile } from "@/lib/shared-tracks";
import styles from "./share-links.module.css";

export function PublicTrack({ token }: { token: string }) {
  const [file, setFile] = useState<SharedTrackFile | null>(null);
  const [error, setError] = useState("");
  const [large, setLarge] = useState(false);
  const [ink, setInk] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    let sequence = 0;
    const load = () => {
      const request = ++sequence;
      setFile(null);
      readPublicShare(token, controller.signal)
        .then((value) => {
          if (current && request === sequence) {
            setFile(value);
            setError("");
          }
        })
        .catch((failure) => {
          if (current && request === sequence && !controller.signal.aborted)
            setError(
              failure instanceof Error
                ? failure.message
                : "This shared track is unavailable.",
            );
        });
    };
    const resume = () => {
      if (document.visibilityState === "visible") load();
    };
    const hide = () => {
      sequence++;
      setFile(null);
    };
    load();
    window.addEventListener("pageshow", load);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", resume);
    return () => {
      current = false;
      controller.abort();
      window.removeEventListener("pageshow", load);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [token, refresh]);
  return (
    <main
      id="main-content"
      className={`${styles.publicPage} ${large ? styles.large : ""}`}
      data-theme={ink ? "dark" : "light"}
    >
      <div className={styles.publicInner}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            forma.
          </Link>
          <div className={styles.controls}>
            <button
              className="button secondary"
              aria-pressed={large}
              onClick={() => setLarge(!large)}
            >
              Large text
            </button>
            <button
              className="button secondary"
              aria-pressed={ink}
              onClick={() => setInk(!ink)}
            >
              Ink appearance
            </button>
          </div>
        </header>
        <p className="eyebrow">A CURRICULUM TO MAKE YOUR OWN</p>
        <p className={styles.intro}>
          Forma is a personal practice notebook for competitive programming.
          Explore this track, then review your own copy before adding it.
        </p>
        {error ? (
          <section className={styles.panel} aria-live="polite">
            <h1>This shared track is unavailable.</h1>
            <p>{error}</p>
            <p>Ask the sender for an active link or an exported track file.</p>
            <button
              className="button secondary"
              onClick={() => setRefresh(refresh + 1)}
            >
              Try again
            </button>
          </section>
        ) : !file ? (
          <p role="status">Opening shared track…</p>
        ) : (
          <>
            <h1>{file.track.title}</h1>
            {file.track.shareDescription && (
              <p className={styles.prose}>{file.track.shareDescription}</p>
            )}
            <p>
              {file.track.stages.length} stages ·{" "}
              {file.track.stages.reduce(
                (sum, stage) => sum + stage.problems.length,
                0,
              )}{" "}
              problem memberships
            </p>
            <div className={styles.panel}>
              <Link
                prefetch={false}
                href={`/tracks?share=${token}`}
                className="button primary"
              >
                Add to my Forma
              </Link>
              <p>
                No account needed. You’ll review and edit before saving. Your
                own matching practice history may apply; the sender’s progress
                is never included.
              </p>
            </div>
            <ol className={styles.stages}>
              {file.track.stages.map((stage, index) => (
                <li key={index}>
                  <details open={index === 0}>
                    <summary>
                      <span>
                        {index + 1}. {stage.title}
                      </span>
                      <span className="muted">
                        {stage.problems.length} problems
                      </span>
                    </summary>
                    {stage.description && (
                      <p className={styles.prose}>{stage.description}</p>
                    )}
                    {stage.suggestedTime && (
                      <p className="muted">
                        Suggested practice: {stage.suggestedTime}
                      </p>
                    )}
                    <ol className={styles.problems}>
                      {stage.problems.map((problem, entry) => (
                        <li key={entry}>
                          <a
                            href={problem.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {problem.code} · {problem.title}
                          </a>
                          <p className="muted">
                            {problem.url.includes("/gym/")
                              ? "Codeforces Gym"
                              : "Codeforces"}
                            {problem.rating !== null
                              ? ` · Source rating ${problem.rating}`
                              : ""}
                          </p>
                          {problem.hint && (
                            <details>
                              <summary>Pattern hint</summary>
                              <p className={styles.prose}>{problem.hint}</p>
                            </details>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              ))}
            </ol>
            <p className={styles.footnote}>
              This is an unlisted, frozen snapshot. Anyone with this link can
              view it. Later edits create a different link. Your imported copy
              remains independent if this link is revoked.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
