"use client";

import { ArrowRight, Check } from "lucide-react";
import { useState, type FormEvent } from "react";
import styles from "./waitlist.module.css";

const messages = {
  idle: "",
  submitting: "Submitting your email…",
  joined: "You’re on the Windows waitlist.",
  failed: "We couldn’t save your email. Please try again.",
  busy: "The waitlist is busy. Please wait a moment and try again.",
};

export function WindowsWaitlist({ endpoint }: { endpoint: string | null }) {
  const [submission, setSubmission] = useState<keyof typeof messages>("idle");
  const submitting = submission === "submitting";
  const joined = submission === "joined";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpoint || submitting || joined) return;

    const form = event.currentTarget;
    setSubmission("submitting");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        setSubmission(response.status === 429 ? "busy" : "failed");
        return;
      }
      const result: { next?: unknown } | null = await response.json();
      // Formspree returns a thank-you URL when it accepts the submission.
      if (typeof result?.next !== "string") {
        setSubmission("failed");
        return;
      }
      form.reset();
      setSubmission("joined");
    } catch {
      setSubmission("failed");
    }
  }

  return (
    <form
      className={styles.form}
      aria-label="Windows waitlist"
      action={endpoint ?? undefined}
      method="post"
      encType="multipart/form-data"
      onSubmit={submit}
    >
      {!joined && (
        <>
          <label htmlFor="windows-waitlist-email">Email address</label>
          <div className={styles.fields}>
            <input
              id="windows-waitlist-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              placeholder="you@example.com"
              disabled={!endpoint}
              readOnly={submitting}
              required
            />
            <button type="submit" disabled={!endpoint || submitting}>
              {submitting ? "Joining…" : "Join the waitlist"}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
          <input
            type="text"
            name="_gotcha"
            tabIndex={-1}
            autoComplete="off"
            hidden
          />
        </>
      )}
      <p className={styles.status} data-state={submission} role="status">
        {joined && <Check size={17} aria-hidden="true" />}
        {endpoint ? messages[submission] : "Signups will open soon."}
      </p>
    </form>
  );
}
