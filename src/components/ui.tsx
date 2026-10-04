"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, ArrowUpRight, ArrowRight, Sprout, Check } from "lucide-react";
import Link from "next/link";
import { Outcome, OUTCOMES, Problem } from "@/lib/model";

export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current!;
    const focused = document.activeElement as HTMLElement | null;
    element.showModal();
    if (element.querySelector<HTMLElement>("[data-initial-focus]"))
      element.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    else
      Array.from(
        element.querySelectorAll<HTMLElement>(
          "input:not([type='file']), select, textarea",
        ),
      )
        .find((field) => field.offsetParent !== null)
        ?.focus();
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = bodyOverflow;
      focused?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">YOUR PRACTICE, YOUR PACE</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function OutcomeLabel({ outcome }: { outcome: Outcome | undefined }) {
  return (
    <span className={`outcome ${outcome ?? "fresh"}`}>
      <span className="status-dot" />
      {outcome ? OUTCOMES[outcome] : "Not attempted"}
    </span>
  );
}
export function Tags({ tags }: { tags: string[] }) {
  return (
    <div className="tags">
      {tags.map((tag, index) => (
        <span key={`${index}-${tag}`}>{tag}</span>
      ))}
    </div>
  );
}
export function ProblemLink({
  problem,
  children,
}: {
  problem: Problem;
  children?: ReactNode;
}) {
  return problem.url ? (
    <a
      href={problem.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-link"
    >
      {children ?? "Open problem"}
      <ArrowUpRight size={16} />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <span className="muted small">No external link added</span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {icon ?? <Sprout size={30} strokeWidth={1.4} />}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SectionHeading({
  title,
  link,
  label,
}: {
  title: string;
  link?: string;
  label?: string;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {link && (
        <Link href={link} className="text-link">
          {label ?? "View all"}
          <ArrowRight size={15} />
        </Link>
      )}
    </div>
  );
}
export function CheckMark() {
  return <Check size={14} strokeWidth={2.5} />;
}
