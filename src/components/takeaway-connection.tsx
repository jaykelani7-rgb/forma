import { useId, type ReactNode } from "react";
import type { TakeawayPracticeContext } from "@/lib/model";
import { RibbonMark } from "../../packages/ribbon/RibbonMark";
import styles from "./takeaway-connection.module.css";

export function TakeawayConnection({
  context,
  action,
  headingLevel = 2,
}: {
  context: TakeawayPracticeContext;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const heading = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={styles.connection} aria-labelledby={heading}>
      <header className={styles.header}>
        <RibbonMark size={30} />
        <Heading id={heading} className={styles.title}>
          The connection
        </Heading>
      </header>
      <p className={styles.topic}>
        Shared topic <strong>{context.topic}</strong>
      </p>
      <figure className={styles.takeaway}>
        <figcaption>From your reflection on {context.sourceProblemTitle}</figcaption>
        <blockquote>{context.takeaway}</blockquote>
      </figure>
      {action}
    </section>
  );
}

export function FoldedTakeawayTopic() {
  return (
    <p className={styles.folded}>
      <RibbonMark size={23} />
      <span>The shared topic is folded until you save your reflection.</span>
    </p>
  );
}
