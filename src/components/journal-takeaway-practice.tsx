"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { getCatalogue } from "@/lib/catalogue-client";
import { activeContest } from "@/lib/contest-lab";
import type { ProblemCatalogue } from "@/lib/discovery";
import { uid } from "@/lib/model";
import {
  selectTakeawayPractice,
  withTakeawayPractice,
} from "@/lib/takeaway-practice";
import { useWorkspace } from "./provider";
import styles from "./ribbon-journal.module.css";

export function JournalTakeawayPractice({ sourceRecordId }: { sourceRecordId: string }) {
  const { data, savedData, guardWorkspace, storageError, storagePending, update } =
    useWorkspace();
  const router = useRouter();
  const panelId = useId();
  const mounted = useRef(false);
  const actionLock = useRef(false);
  const [open, setOpen] = useState(false);
  const [catalogue, setCatalogue] = useState<ProblemCatalogue | null>();
  const [pending, setPending] = useState<"find" | "start" | null>(null);
  const [error, setError] = useState("");
  const suggestion = useMemo(
    () =>
      catalogue === undefined
        ? null
        : selectTakeawayPractice(savedData, sourceRecordId, catalogue),
    [catalogue, savedData, sourceRecordId],
  );
  const blocker = data.session
    ? "Finish your current session before starting this problem."
    : activeContest(data)
      ? "Finish your active contest before starting this problem."
      : storageError
        ? "Review saving in Settings before starting this problem."
        : "";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function find() {
    if (actionLock.current) return;
    const isCurrent = guardWorkspace();
    actionLock.current = true;
    setPending("find");
    setError("");
    try {
      const local = selectTakeawayPractice(savedData, sourceRecordId, null);
      const available = local ? null : await getCatalogue();
      if (mounted.current && isCurrent()) setCatalogue(available);
    } catch {
      if (mounted.current && isCurrent())
        setError("The problem catalogue is unavailable. Try again in a moment.");
    } finally {
      actionLock.current = false;
      if (mounted.current) setPending(null);
    }
  }

  async function start() {
    if (!suggestion || blocker || storagePending || actionLock.current) return;
    const isCurrent = guardWorkspace();
    actionLock.current = true;
    setPending("start");
    setError("");
    try {
      const now = Date.now();
      const sessionId = uid();
      const problemId = uid();
      const saved = await update((current) =>
        withTakeawayPractice(current, suggestion, now, sessionId, problemId),
      );
      if (!mounted.current || !isCurrent()) return;
      if (saved) router.push("/session");
      else setError("The session could not be saved. Review saving in Settings.");
    } catch (failure) {
      if (mounted.current && isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "This problem could not be started. Try again.",
        );
    } finally {
      actionLock.current = false;
      if (mounted.current) setPending(null);
    }
  }

  return (
    <div className={styles.takeawayOffer}>
      <button
        type="button"
        className="text-link"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
          if (!open && catalogue === undefined) void find();
        }}
      >
        Try it on a new problem <ChevronDown size={15} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open} className={styles.takeawayPanel}>
        {pending === "find" && (
          <p className={styles.meta} role="status">Finding a problem…</p>
        )}
        {catalogue !== undefined && !suggestion && (
          <p className={styles.meta} role="status">
            No untried problem of a similar rating was found for this takeaway.
          </p>
        )}
        {suggestion && (
          <>
            <h4>{suggestion.problem.title}</h4>
            <p className={styles.meta}>
              Rating {suggestion.problem.rating} · Untried in your recorded history
            </p>
            <p className={styles.meta}>The shared topic opens after your reflection.</p>
            {blocker && <p className={styles.meta}>{blocker}</p>}
            <button
              type="button"
              className="button secondary"
              disabled={!!blocker || storagePending || pending !== null}
              onClick={() => void start()}
            >
              {pending === "start" ? "Starting practice…" : "Start practice"}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </>
        )}
        {error && <p className={styles.meta} role="alert">{error}</p>}
        {error && catalogue === undefined && pending === null && (
          <button type="button" className="text-link" onClick={() => void find()}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
