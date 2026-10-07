"use client";
import { useRef, useState } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import { Problem, safeUrl, uid } from "@/lib/model";
import { useWorkspace } from "./provider";
import { Modal } from "./ui";

export function AddProblem({
  onClose,
  problem,
}: {
  onClose: () => void;
  problem?: Problem;
}) {
  const { update, notify, guardWorkspace } = useWorkspace();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const identity = useRef(problem?.id ?? uid());
  const [platform, setPlatform] = useState(
    problem
      ? ["Codeforces", "LeetCode"].includes(problem.platform)
        ? problem.platform
        : "Other"
      : "Codeforces",
  );
  const [custom, setCustom] = useState(
    problem && !["Codeforces", "LeetCode"].includes(problem.platform)
      ? problem.platform
      : "",
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const url = String(form.get("url") ?? "").trim();
    const ratingText = String(form.get("rating") ?? "").trim();
    const tags = [
      ...new Set(
        String(form.get("tags") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (!title) {
      setError("Give this problem a name so you can find it again.");
      return;
    }
    if (!safeUrl(url)) {
      setError("Use a complete http:// or https:// problem link.");
      return;
    }
    if (tags.length > 20 || tags.some((t) => t.length > 60)) {
      setError("Use up to 20 topics, each under 60 characters.");
      return;
    }
    if (
      ratingText &&
      (!Number.isInteger(Number(ratingText)) ||
        Number(ratingText) < 0 ||
        Number(ratingText) > 10000)
    ) {
      setError("The rating must be a whole number between 0 and 10,000.");
      return;
    }
    const value: Problem = {
      ...problem,
      id: identity.current,
      title,
      platform: platform === "Other" ? custom.trim() : platform,
      url,
      problemCode: String(form.get("problemCode") ?? "").trim(),
      tags,
      rating: ratingText ? Number(ratingText) : null,
      createdAt: problem?.createdAt ?? new Date().toISOString(),
      reviewAt: problem?.reviewAt ?? null,
      reviewCount: problem?.reviewCount ?? 0,
    };
    if (!value.platform) {
      setError("Add a platform name.");
      return;
    }
    const isCurrent = guardWorkspace();
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await update((data) => ({
        ...data,
        problems: data.problems.some((p) => p.id === value.id)
          ? data.problems.map((p) =>
              p.id === value.id
                ? {
                    ...p,
                    title: value.title,
                    platform: value.platform,
                    url: value.url,
                    problemCode: value.problemCode,
                    tags: value.tags,
                    rating: value.rating,
                  }
                : p,
            )
          : [...data.problems, value],
      }));
      if (!isCurrent()) return;
      if (!saved) {
        setError(
          "This change was not committed. Your input is still here. Review the storage message and recovery copies in Settings, then retry.",
        );
        return;
      }
      notify(
        problem
          ? "Problem details updated."
          : "Problem added. A good place to begin.",
      );
      onClose();
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "This change was not committed. Review the storage message and retry.",
        );
    } finally {
      saving.current = false;
      if (isCurrent()) setPending(false);
    }
  }
  const known = platform === "Codeforces" || platform === "LeetCode";
  return (
    <Modal
      title={problem ? "A few small edits." : "Add to your practice."}
      onClose={() => {
        if (!saving.current) onClose();
      }}
    >
      <form className="form-stack" onSubmit={submit}>
        <p className="muted">
          Save a problem you want to understand. The first attempt can come
          whenever you’re ready.
        </p>
        <label>
          Problem name
          <input
            autoFocus
            name="title"
            disabled={pending}
            placeholder="e.g. Diagonal Traverse"
            defaultValue={problem?.title}
            maxLength={240}
            required
          />
        </label>
        <div className="form-row">
          <label>
            Platform
            <select
              value={known ? platform : "Other"}
              disabled={pending}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option>Codeforces</option>
              <option>LeetCode</option>
              <option>Other</option>
            </select>
          </label>
          <label>
            Problem ID <span className="optional">optional</span>
            <input
              name="problemCode"
              disabled={pending}
              defaultValue={problem?.problemCode}
              placeholder={platform === "Codeforces" ? "e.g. 189A" : "e.g. 498"}
              maxLength={60}
            />
          </label>
        </div>
        {!known && (
          <label>
            Platform name
            <input
              value={custom}
              disabled={pending}
              onChange={(e) => setCustom(e.target.value)}
              maxLength={60}
              placeholder="e.g. AtCoder"
              required
            />
          </label>
        )}
        <label>
          Problem link <span className="optional">optional</span>
          <div className="input-icon">
            <Link2 size={16} />
            <input
              type="url"
              name="url"
              disabled={pending}
              defaultValue={problem?.url}
              placeholder="https://…"
              maxLength={2000}
            />
          </div>
        </label>
        <div className="form-row topic-row">
          <label>
            Topics <span className="optional">comma separated</span>
            <input
              name="tags"
              disabled={pending}
              defaultValue={problem?.tags.join(", ")}
              placeholder="Arrays, Binary search"
              maxLength={1200}
            />
          </label>
          <label>
            Rating <span className="optional">optional</span>
            <input
              name="rating"
              disabled={pending}
              type="number"
              min={0}
              max={10000}
              step={1}
              defaultValue={problem?.rating ?? ""}
              placeholder="1300"
            />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : problem ? "Save changes" : "Add problem"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
