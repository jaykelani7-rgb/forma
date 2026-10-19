"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { listOwnedShares, revokeShare } from "@/lib/share-links-client";
import { sharePath, type OwnedShare } from "@/lib/share-links";
import { useWorkspace } from "./provider";
import { Modal, PageHeader } from "./ui";
import styles from "./share-links.module.css";

export function SharedTrackManagement() {
  const { workspaceKey, account } = useWorkspace();
  return <Management key={`${workspaceKey}:${account?.id ?? "local"}`} />;
}
function Management() {
  const { account, guardWorkspace, notify, workspaceKey } = useWorkspace();
  const [shares, setShares] = useState<OwnedShare[] | null>(null);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<OwnedShare | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const owner = useRef(guardWorkspace());
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const accountId =
    workspaceKey === `account:${account?.id}` ? account?.id : undefined;
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    listOwnedShares(accountId, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted && owner.current()) {
          setShares(value);
          setError("");
        }
      })
      .catch((failure) => {
        if (!abort.signal.aborted && owner.current())
          setError(
            failure instanceof Error
              ? failure.message
              : "Share links could not be loaded.",
          );
      });
    return () => abort.abort();
  }, [accountId, retry]);
  async function revoke() {
    if (busy.current || !accountId || !revoking || !owner.current()) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await revokeShare(
        accountId,
        revoking.id,
        controller.current?.signal,
      );
      if (!owner.current() || controller.current?.signal.aborted) return;
      setShares(
        (current) =>
          current?.map((share) => (share.id === result.id ? result : share)) ??
          null,
      );
      setRevoking(null);
      notify("Share link revoked. Your private track is preserved.");
    } catch (failure) {
      if (owner.current() && !controller.current?.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Revocation did not finish. Retry this link.",
        );
    } finally {
      busy.current = false;
      if (owner.current() && !controller.current?.signal.aborted)
        setPending(false);
    }
  }
  async function copy(share: OwnedShare) {
    try {
      await navigator.clipboard.writeText(
        new URL(sharePath(share.token), window.location.origin).href,
      );
      if (owner.current()) notify("Share link copied.");
    } catch {
      if (owner.current())
        setError("Copy the link from its preview’s address bar.");
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="CURRICULUM YOU CHOSE TO SHARE"
        title="My shared tracks."
        description="Each link holds a frozen snapshot. New revisions create new links; older links stay available until you revoke them."
      />
      <Link href="/tracks" className="text-link">
        Back to your private tracks
      </Link>
      <p className="muted">
        Unlisted means anyone with the link can view it. Revocation blocks
        future access, but cannot erase files already downloaded or copies
        already imported.
      </p>
      {error && (
        <div className="notice" role="alert">
          <p>{error}</p>
          <button
            className="button secondary"
            onClick={() => setRetry(retry + 1)}
          >
            Retry shared links
          </button>
          {!accountId && (
            <Link href="/settings#account" className="button secondary">
              Account settings
            </Link>
          )}
        </div>
      )}
      {!shares && !error && <p role="status">Loading your shared tracks…</p>}
      {shares?.length === 0 && (
        <p>
          You have no share links yet. Open a private track and choose Share
          track to review a snapshot.
        </p>
      )}
      <ul className={styles.list}>
        {shares?.map((share) => (
          <li key={share.id} className={styles.item}>
            <h2>{share.title}</h2>
            <p>
              Published{" "}
              {new Date(share.publishedAt).toLocaleDateString(undefined, {
                dateStyle: "medium",
              })}{" "}
              · <strong>{share.revokedAt ? "Revoked" : "Active"}</strong>
            </p>
            {!share.revokedAt && (
              <div className={styles.itemActions}>
                <Link
                  prefetch={false}
                  href={sharePath(share.token)}
                  className="button secondary"
                >
                  View snapshot
                </Link>
                <button
                  className="button secondary"
                  onClick={() => copy(share)}
                >
                  Copy link
                </button>
                <button
                  className="button secondary"
                  onClick={() => setRevoking(share)}
                >
                  Revoke link
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {revoking && (
        <Modal
          title="Revoke this link?"
          onClose={() => {
            if (!pending) setRevoking(null);
          }}
        >
          <div className="form-stack">
            <p>{revoking.title}</p>
            <p>
              Future visitors will no longer be able to preview or import from
              this link. Your private track and copies already imported by
              others remain intact.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className={styles.itemActions}>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() => setRevoking(null)}
              >
                Keep link
              </button>
              <button
                className="button primary"
                disabled={pending}
                onClick={revoke}
              >
                {pending ? "Revoking…" : "Revoke link"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
