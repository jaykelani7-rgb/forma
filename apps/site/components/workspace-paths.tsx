"use client";
import { ArrowRight, Check, Flag, Route } from "lucide-react";
import type { SamplePractice } from "./companion-sample";
import {
  upsolveComplete,
  upsolveReflection,
  type WorkspacePlan,
} from "./workspace-plan";
import s from "./workspace-paths.module.css";

const stages = [
  {
    title: "Start with a boundary",
    problem: "Watermelon",
    source: "Codeforces · 4A",
    description:
      "Turn a plausible rule into a condition you can explain. Keep the smallest case beside your idea.",
    time: "15 minutes",
    note: "Your live companion session appears here.",
  },
  {
    title: "Build from smaller answers",
    problem: "Cut Ribbon",
    source: "Codeforces · 189A",
    description:
      "Look for a smaller state that can help with the next one. Keep impossible states explicit.",
    time: "25 minutes",
    note: "Example record · Independent",
  },
  {
    title: "Follow the changing direction",
    problem: "Diagonal Traverse",
    source: "LeetCode · 498",
    description:
      "Trace how the direction changes at a boundary, then explain what remains consistent.",
    time: "25 minutes",
    note: "Example record · With a hint",
  },
];
type Props = {
  plan: WorkspacePlan;
  practice: SamplePractice | null;
  onChange: (value: WorkspacePlan) => void;
};
export function TrackPreview({
  plan,
  practice,
  onChange,
  onProblem,
  onToday,
}: Props & { onProblem: (title: string) => void; onToday: () => void }) {
  const stage = stages[plan.stage];
  const independent =
    1 + Number(practice?.reflection?.outcome === "Independent");
  return (
    <section aria-label="Sample practice track" className={s.path}>
      <div className={s.hero}>
        <Route size={25} />
        <span>CURRICULUM SAMPLE · THREE STAGES</span>
        <h4>
          Small steps.
          <br />
          <em>Stronger reasoning.</em>
        </h4>
        <p>
          A direction for your next session, with room to revisit what needs
          another look.
        </p>
        <button
          className={s.primary}
          aria-pressed={plan.activeTrack}
          onClick={() => onChange({ ...plan, activeTrack: !plan.activeTrack })}
        >
          {plan.activeTrack ? <Check size={16} /> : <Route size={16} />}{" "}
          {plan.activeTrack
            ? "Active track · deactivate"
            : "Make this my active track"}
        </button>
        <p role="status" className={s.caption}>
          {plan.activeTrack
            ? "Small steps is now your sample active track. It is connected to Today."
            : "Choosing a track does not start a timer or record a solve."}
        </p>
      </div>
      <div className={s.progress}>
        <span>
          <strong>{independent} / 3</strong> independent
        </span>
        <progress
          aria-label="Independently solved track problems"
          value={independent}
          max={3}
        />
        <small>
          Includes one independent example record. Platform acceptance stays
          separate.
        </small>
      </div>
      <div className={s.stages} role="group" aria-label="Track stages">
        {stages.map((item, index) => (
          <button
            key={item.problem}
            aria-pressed={plan.stage === index}
            onClick={() => onChange({ ...plan, stage: index })}
          >
            <span>0{index + 1}</span>
            <strong>{item.title}</strong>
            <small>
              {index === 0
                ? practice?.reflection?.outcome || "Your session"
                : item.note}
            </small>
          </button>
        ))}
      </div>
      <article className={s.stage} aria-label="Selected track stage">
        <span>
          STAGE 0{plan.stage + 1} · {stage.source}
        </span>
        <h4>{stage.problem}</h4>
        <p>{stage.description}</p>
        <dl>
          <div>
            <dt>Learning outcome</dt>
            <dd>
              {plan.stage === 0
                ? practice?.reflection?.outcome || "Not reflected yet"
                : plan.stage === 1
                  ? "Independent · example"
                  : "With a hint · example"}
            </dd>
          </div>
          <div>
            <dt>Suggested time</dt>
            <dd>
              {stage.time} <small>Practice guidance, not measured time</small>
            </dd>
          </div>
        </dl>
        {plan.stage === 0 && practice?.reflection?.takeaway && (
          <blockquote>{practice.reflection.takeaway}</blockquote>
        )}
        <div className={s.actions}>
          <button
            className={s.primary}
            onClick={() => onProblem(stage.problem)}
          >
            {plan.stage === 0
              ? "Open Watermelon sample"
              : "View example problem"}
            <ArrowRight size={16} />
          </button>
          <button className={s.link} onClick={onToday}>
            See Today <ArrowRight size={16} />
          </button>
        </div>
      </article>
    </section>
  );
}
export function ContestPreview({
  plan,
  practice,
  onChange,
  onStart,
  onToday,
  onJournal,
}: Props & {
  onStart: () => void;
  onToday: () => void;
  onJournal: () => void;
}) {
  const reflection = upsolveReflection(plan, practice);
  const complete = upsolveComplete(plan, practice);
  return (
    <section aria-label="Sample contest review" className={s.path}>
      <div className={s.hero}>
        <Flag size={25} />
        <span>PAST PRACTICE ROUND · EXAMPLE DATA</span>
        <h4>
          The round ends.
          <br />
          <em>The learning continues.</em>
        </h4>
        <p>
          Keep the original result, reflect on your approach, then make space
          for an upsolve.
        </p>
        <div className={s.roundMeta}>
          <span>1 problem</span>
          <span>30 min planned</span>
          <span>Finished · example</span>
        </div>
      </div>
      <div className={s.comparison}>
        <article aria-label="Original contest result">
          <span>DURING THE ROUND</span>
          <h4>
            Watermelon <small>4A</small>
          </h4>
          <dl>
            <dt>Platform result</dt>
            <dd>No acceptance recorded</dd>
            <dt>Learning outcome</dt>
            <dd>Not solved yet</dd>
          </dl>
          <p>
            Example contest evidence. Later practice does not rewrite this
            result.
          </p>
        </article>
        <article aria-label="Later upsolve learning" data-complete={complete}>
          <span>AFTER THE ROUND</span>
          <h4>{complete ? "A new understanding." : "A place to return."}</h4>
          <p>
            {reflection
              ? reflection.takeaway || "A later sample attempt has been kept."
              : "An upsolve keeps a later attempt connected to the original problem."}
          </p>
          <strong>
            {reflection
              ? reflection.outcome
              : "No linked upsolve reflection yet"}
          </strong>
          {reflection && (
            <button className={s.link} onClick={onJournal}>
              Read it in Journal <ArrowRight size={16} />
            </button>
          )}
        </article>
      </div>
      <form
        className={s.debrief}
        onSubmit={(event) => {
          event.preventDefault();
          if (plan.contestDraft.trim())
            onChange({ ...plan, contestNote: plan.contestDraft.trim() });
        }}
      >
        <label>
          What would you change next time?
          <textarea
            maxLength={500}
            rows={3}
            value={plan.contestDraft}
            onChange={(event) =>
              onChange({ ...plan, contestDraft: event.target.value })
            }
            placeholder="I would test the smallest input before trusting a pattern…"
          />
        </label>
        <div className={s.actions}>
          <button
            className={s.primary}
            disabled={
              !plan.contestDraft.trim() ||
              plan.contestDraft.trim() === plan.contestNote
            }
          >
            Save contest takeaway
          </button>
          <span role="status">
            {plan.contestNote === plan.contestDraft.trim()
              ? "Contest takeaway saved in this preview."
              : "Your draft stays here while you explore."}
          </span>
        </div>
      </form>
      {plan.contestNote && (
        <blockquote className={s.savedNote}>
          <span>YOUR CONTEST TAKEAWAY</span>
          {plan.contestNote}
        </blockquote>
      )}
      <section className={s.queue} aria-label="Sample upsolve queue">
        <div>
          <span>ONE NEXT STEP</span>
          <h4>Return to Watermelon.</h4>
          <p>Choose a priority and keep the problem in your sample plan.</p>
        </div>
        <label>
          Upsolve priority
          <select
            value={plan.priority}
            disabled={complete}
            onChange={(event) =>
              onChange({
                ...plan,
                priority: event.target.value as WorkspacePlan["priority"],
              })
            }
          >
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </label>
        {!plan.queued ? (
          <button
            className={s.primary}
            onClick={() =>
              onChange({ ...plan, queued: true, startedAtRevision: null })
            }
          >
            Queue sample upsolve <ArrowRight size={16} />
          </button>
        ) : (
          <>
            <p role="status" className={s.queueStatus}>
              {complete
                ? "Upsolve complete · linked to your later reflection"
                : reflection
                  ? "Attempt kept · still in your upsolve queue"
                  : `${plan.priority === "high" ? "High" : "Normal"} priority · queued in Today`}
            </p>
            <div className={s.actions}>
              {!complete && (
                <button className={s.primary} onClick={onStart}>
                  {plan.startedAtRevision === null
                    ? "Start sample upsolve"
                    : "Continue sample upsolve"}
                  <ArrowRight size={16} />
                </button>
              )}
              <button className={s.link} onClick={onToday}>
                See Today <ArrowRight size={16} />
              </button>
              <button
                className={s.link}
                onClick={() =>
                  onChange({ ...plan, queued: false, startedAtRevision: null })
                }
              >
                Remove from queue
              </button>
            </div>
          </>
        )}
        <small>
          Starting opens the same Watermelon companion. Save a later solved
          learning outcome to complete this sample upsolve; opening the problem
          alone does not complete it.
        </small>
      </section>
    </section>
  );
}
