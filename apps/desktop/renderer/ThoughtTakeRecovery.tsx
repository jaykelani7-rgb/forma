import { useId } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import type { ThoughtTakeRecoveryState } from "./thought-voice";
import "./thought-take-recovery.css";

export function ThoughtTakeRecovery({
  recovery,
  problemKey,
  busy = false,
  showEmpty = false,
  retryDisabledReason,
  onRetry,
}: {
  recovery: ThoughtTakeRecoveryState;
  problemKey: string | null | undefined;
  busy?: boolean;
  showEmpty?: boolean;
  retryDisabledReason?: string;
  onRetry: (takeId: string) => void;
}) {
  const headingId = useId();
  const { takes, loading, error, retryingId, discardingId, refresh, discard } =
    recovery;
  if (!takes.length && !loading && !error && !showEmpty) return null;
  const working = busy || !!retryingId || !!discardingId;

  return (
    <section className="thought-take-recovery" aria-labelledby={headingId}>
      <h2 id={headingId}>Failed recordings</h2>
      {!!takes.length && (
        <>
          <p className="field-help">
            Audio is kept on this Mac. Retry sends it to your transcription
            provider. Discard deletes it from this Mac.
          </p>
          <ul className="thought-take-list">
            {takes.map((take) => {
              const reason =
                take.problemKey !== problemKey
                  ? "Attach this problem to retry this recording."
                  : retryDisabledReason;
              return (
                <li key={take.id}>
                  <strong>{take.title}</strong>
                  <time dateTime={take.recordedAt}>
                    {new Date(take.recordedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                  {reason && <p className="field-help">{reason}</p>}
                  <div className="thought-take-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={working || !!reason}
                      onClick={() => onRetry(take.id)}
                    >
                      <RotateCcw size={13} aria-hidden="true" /> Retry
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={working}
                      onClick={() => void discard(take.id)}
                    >
                      <Trash2 size={13} aria-hidden="true" /> Discard
                    </button>
                  </div>
                  {retryingId === take.id && (
                    <p className="field-help" role="status">
                      Retrying transcription…
                    </p>
                  )}
                  {discardingId === take.id && (
                    <p className="field-help" role="status">
                      Discarding recording…
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!takes.length && loading && (
        <p className="field-help" role="status">
          Checking for saved recordings…
        </p>
      )}
      {!takes.length && !loading && !error && (
        <p className="field-help">There are no failed recordings saved.</p>
      )}
      {error && (
        <>
          <p className="inline-error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="text-button"
            disabled={working || loading}
            onClick={() => void refresh()}
          >
            Refresh recordings
          </button>
        </>
      )}
    </section>
  );
}
