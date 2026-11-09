import { useId, useState, type ReactNode, type Ref } from "react";
import { RibbonMark } from "../../packages/ribbon/RibbonMark";
import { compareAttempts } from "../lib/attempt-comparison";
import type { LearningRecord } from "../lib/learning";
import { MISTAKES } from "../lib/memory-types";
import { clockTime, DIFFICULTIES, OUTCOMES } from "../lib/model";
import styles from "./attempt-comparison.module.css";

type CodeExcerpt = { id: string; text: string };

const sourceLabels: Record<LearningRecord["source"], string> = {
  timed: "Timed practice",
  codeforces: "Codeforces import",
  linked: "Timed + Codeforces",
  contest: "Contest participation",
};
const attemptDateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateLabel = (value: string) => attemptDateFormat.format(new Date(value));
const outcomeLabel = (record: LearningRecord) =>
  record.outcome ? OUTCOMES[record.outcome] : "Reflection pending";

function AttemptCard({
  label, record, excerpts, originalLink,
}: {
  label: "Then" | "Now";
  record: LearningRecord;
  excerpts?: readonly CodeExcerpt[];
  originalLink?: ReactNode;
}) {
  const titleId = useId();
  const notes = [
    ["Approach", record.approach],
    ["Takeaway", record.takeaway],
    ["Where you got stuck", record.mistakeNote],
    ["Session notes", record.notes],
    ["Recorded mistakes", record.mistakes?.map(mistake => MISTAKES[mistake]).join(", ")],
    ["Difficulty", record.difficulty ? DIFFICULTIES[record.difficulty] : null],
  ].filter(([, value]) => value?.trim());

  return (
    <article className={styles.attempt} aria-labelledby={titleId}>
      <div className={styles.attemptHeader}>
        <h3 id={titleId}>{label}</h3>
        <time className={styles.date} dateTime={record.completedAt}>{dateLabel(record.completedAt)}</time>
        <p className={styles.metadata}>
          {sourceLabels[record.source]}{record.elapsedMs !== null && ` · ${clockTime(record.elapsedMs)} measured`}
        </p>
        <span className={styles.outcome}>{outcomeLabel(record)}</span>
      </div>
      {notes.length > 0 && (
        <dl className={styles.notes}>
          {notes.map(([title, value]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!record.outcome && <p className={styles.empty}>No reflection has been saved for this attempt.</p>}
      {record.outcome && !notes.length && <p className={styles.empty}>Outcome saved without written notes.</p>}
      {!!excerpts?.length && (
        <details className={styles.code}>
          <summary>Saved code {excerpts.length === 1 ? "excerpt" : "excerpts"}</summary>
          {excerpts.map((excerpt, index) => (
            <pre key={excerpt.id} tabIndex={0} aria-label={`Saved code excerpt ${index + 1}`}>
              <code>{excerpt.text}</code>
            </pre>
          ))}
        </details>
      )}
      {originalLink && <div className={styles.originalLink}>{originalLink}</div>}
    </article>
  );
}

export function AttemptComparison({
  selected, choices, problemTitle, compact = false, showHeading = true, headingRef,
  renderRecordLink, codeForAttempt,
}: {
  selected: LearningRecord;
  choices: readonly LearningRecord[];
  problemTitle: string;
  compact?: boolean;
  showHeading?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  renderRecordLink?: (record: LearningRecord) => ReactNode;
  codeForAttempt?: (record: LearningRecord) => readonly CodeExcerpt[];
}) {
  const [choiceId, setChoiceId] = useState<string>();
  const choiceLabel = useId();
  const headingId = useId();
  const choice = choices.find(record => record.id === choiceId) ?? choices[0];
  const comparison = choice ? compareAttempts(selected, choice) : null;
  if (!comparison) return null;
  const { then, now, change } = comparison;

  return (
    <section className={`${styles.comparison} ${compact ? styles.compact : ""}`}
      aria-labelledby={showHeading ? headingId : undefined} aria-label={showHeading ? undefined : "Then / Now"}>
      <div className={styles.intro}>
        <div>
          {showHeading && (
            <h2 ref={headingRef} id={headingId} tabIndex={-1}>Then / Now</h2>
          )}
          <p className={styles.problemTitle}>{problemTitle}</p>
        </div>
        {choices.length > 1 && (
          <div className={styles.chooser}>
            <label htmlFor={choiceLabel}>Compare with</label>
            <select id={choiceLabel} value={choice.id} onChange={event => setChoiceId(event.target.value)}>
              {choices.map(record => (
                <option key={record.id} value={record.id}>
                  {dateLabel(record.completedAt)} · {outcomeLabel(record)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className={styles.observation} aria-live="polite">
        {change && <p>{change}</p>}
      </div>
      <div className={`${styles.pair} ${compact ? "" : styles.wide}`}>
        <AttemptCard label="Then" record={then} excerpts={codeForAttempt?.(then)} originalLink={renderRecordLink?.(then)}/>
        <div className={styles.connector} aria-hidden="true">
          <span><RibbonMark size={19}/></span>
        </div>
        <AttemptCard label="Now" record={now} excerpts={codeForAttempt?.(now)} originalLink={renderRecordLink?.(now)}/>
      </div>
    </section>
  );
}
