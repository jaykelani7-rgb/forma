"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Code2,
  Sun,
  X,
  Route,
  Flag,
} from "lucide-react";
import { DesktopRibbonMark } from "../../desktop/renderer/DesktopRibbonMark";
import {
  sampleCode,
  type SamplePractice,
  type TourScene,
} from "./companion-sample";
import { TrackPreview, ContestPreview } from "./workspace-paths";
import {
  upsolveComplete,
  type WorkspacePlan,
  type WorkspaceView,
} from "./workspace-plan";
import s from "./workspace-preview.module.css";

const tabs = ["Today", "Practice", "Tracks", "Contests", "Journal"] as const;
const tabIcons = [Sun, Code2, Route, Flag, BookOpen];
type View = WorkspaceView;
const examples = [
  {
    title: "Diagonal Traverse",
    id: "498",
    platform: "LeetCode",
    outcome: "With a hint",
    note: "Change direction at each diagonal boundary; check a single row first.",
  },
  {
    title: "Cut Ribbon",
    id: "189A",
    platform: "Codeforces",
    outcome: "Independent",
    note: "Mark unreachable lengths explicitly before extending a shorter solution.",
  },
];
export function WorkspacePreview({
  practice,
  plan,
  onPlanChange,
  request,
  onOpenProblem,
  onClose,
}: {
  practice: SamplePractice | null;
  plan: WorkspacePlan;
  onPlanChange: (plan: WorkspacePlan) => void;
  request: { view: View; id: number };
  onOpenProblem: (scene: TourScene, startTimer?: boolean) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(request.view);
  const [selected, setSelected] = useState("Watermelon");
  const [query, setQuery] = useState("");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setView(request.view);
    heading.current?.focus({ preventScroll: true });
  }, [request]);
  useEffect(() => {
    const keepActiveTabVisible = () => {
      const button = buttons.current[tabs.indexOf(view)];
      const strip = button?.parentElement;
      if (!button || !strip || strip.scrollWidth <= strip.clientWidth) return;
      const item = button.getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right)
        strip.scrollLeft += item.right - bounds.right;
    };
    keepActiveTabVisible();
    window.addEventListener("resize", keepActiveTabVisible);
    return () => window.removeEventListener("resize", keepActiveTabVisible);
  }, [view]);
  function showView(next: View) {
    setView(next);
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      root.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }
  const current = examples.find((item) => item.title === selected);
  const titles = ["Watermelon", ...examples.map((item) => item.title)].filter(
    (title) => title.toLowerCase().includes(query.toLowerCase()),
  );
  function navigate(event: KeyboardEvent) {
    const index = tabs.indexOf(view);
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setView(tabs[next]);
    buttons.current[next]?.focus();
    buttons.current[next]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }
  const completedUpsolve = upsolveComplete(plan, practice);
  function startUpsolve() {
    onPlanChange({
      ...plan,
      startedAtRevision:
        plan.startedAtRevision ?? practice?.reflectionRevision ?? 0,
    });
    onOpenProblem("desk", true);
  }
  function openTrackProblem(title: string) {
    if (title === "Watermelon") onOpenProblem("desk");
    else {
      setSelected(title);
      setQuery("");
      showView("Practice");
    }
  }
  return (
    <div
      ref={root}
      className={s.workspace}
      role="region"
      aria-label="Interactive sample workspace"
    >
      <header className={s.bar}>
        <span>
          <DesktopRibbonMark size={25} /> forma <small>workspace</small>
        </span>
        <span>INTERACTIVE SAMPLE</span>
        <button onClick={onClose} aria-label="Close workspace preview">
          <X size={18} />
        </button>
      </header>
      <div className={s.layout}>
        <aside className={s.sidebar}>
          <div role="tablist" aria-label="Workspace views" onKeyDown={navigate}>
            {tabs.map((tab, index) => (
              <button
                key={tab}
                role="tab"
                id={`workspace-${tab}`}
                aria-controls="workspace-panel"
                aria-selected={view === tab}
                tabIndex={view === tab ? 0 : -1}
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                onClick={() => setView(tab)}
              >
                {(() => {
                  const Icon = tabIcons[index];
                  return <Icon size={17} />;
                })()}{" "}
                {tab}
                {tab === "Journal" && practice?.reflection && (
                  <i aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          <p>
            One sample notebook.
            <br />
            The same thinking, kept together.
          </p>
        </aside>
        <div
          id="workspace-panel"
          role="tabpanel"
          aria-labelledby={`workspace-${view}`}
          className={s.content}
        >
          <div className={s.title}>
            <h3 ref={heading} tabIndex={-1}>
              {view}
            </h3>
            <span>YOUR PRACTICE, IN CONTEXT</span>
          </div>
          {view === "Today" && (
            <>
              {(plan.activeTrack || plan.queued) && (
                <section
                  className={s.planNotice}
                  aria-label="Your sample practice plan"
                >
                  <span>YOUR NEXT PRACTICE</span>
                  {plan.queued && (
                    <div>
                      <strong>
                        {completedUpsolve
                          ? "Upsolve reflection kept"
                          : "Watermelon · upsolve"}
                      </strong>
                      <p>
                        {completedUpsolve
                          ? "Your later learning is linked. The original contest result stays separate."
                          : `${plan.priority === "high" ? "High" : "Normal"} priority · from the sample practice round`}
                      </p>
                      {!completedUpsolve && (
                        <button className={s.link} onClick={startUpsolve}>
                          {plan.startedAtRevision === null
                            ? "Start sample upsolve"
                            : "Continue sample upsolve"}
                          <ArrowRight size={16} />
                        </button>
                      )}
                      <button
                        className={s.link}
                        onClick={() => showView("Contests")}
                      >
                        Review contest <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                  {plan.activeTrack && (
                    <div>
                      <strong>Active track · Small steps</strong>
                      <p>
                        Three stages of practice, with independent outcomes
                        tracked separately.
                      </p>
                      <button
                        className={s.link}
                        onClick={() => showView("Tracks")}
                      >
                        Return to track <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </section>
              )}
              <div className={s.today}>
                <span>CONTINUE YOUR PRACTICE</span>
                <h4>Watermelon</h4>
                <p>Codeforces · 4A</p>
                <button onClick={() => onOpenProblem("desk")}>
                  Open in companion <ArrowRight size={16} />
                </button>
              </div>
              <h4 className={s.sectionTitle}>A thread to return to</h4>
              <p className={s.thought}>
                {practice?.thought ||
                  "Save a thought in the companion. It will be waiting here when you return."}
              </p>
              <button className={s.link} onClick={() => showView("Journal")}>
                {practice?.reflection
                  ? "Read your latest reflection"
                  : "Explore the sample journal"}
                <ArrowRight size={16} />
              </button>
            </>
          )}
          {view === "Tracks" && (
            <TrackPreview
              plan={plan}
              practice={practice}
              onChange={onPlanChange}
              onProblem={openTrackProblem}
              onToday={() => showView("Today")}
            />
          )}
          {view === "Contests" && (
            <ContestPreview
              plan={plan}
              practice={practice}
              onChange={onPlanChange}
              onStart={startUpsolve}
              onToday={() => showView("Today")}
              onJournal={() => showView("Journal")}
            />
          )}
          {view === "Practice" && (
            <>
              <label className={s.search}>
                Find a problem
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search sample problems"
                />
              </label>
              <div className={s.problems} aria-label="Sample problems">
                {titles.map((title) => (
                  <button
                    key={title}
                    aria-pressed={selected === title}
                    onClick={() => setSelected(title)}
                  >
                    <span>{title}</span>
                    <small>
                      {title === "Watermelon"
                        ? "Your session"
                        : "Example record"}
                    </small>
                    <ArrowRight size={15} />
                  </button>
                ))}
                {!titles.length && (
                  <p role="status">No sample problems match “{query}”.</p>
                )}
              </div>
              <article className={s.detail} aria-label="Selected problem">
                <span>
                  {current
                    ? `${current.platform} · ${current.id} · EXAMPLE RECORD`
                    : "CODEFORCES · 4A · YOUR SESSION"}
                </span>
                <h4>{selected}</h4>
                <p>
                  {current?.note ||
                    practice?.thought ||
                    "Your selected code and next step stay attached to this problem."}
                </p>
                {!current && (
                  <>
                    {practice?.code && (
                      <details>
                        <summary>Selected code · lines 7–11</summary>
                        <pre>
                          {sampleCode.split("\n").slice(6, 11).join("\n")}
                        </pre>
                      </details>
                    )}
                    <button
                      className={s.link}
                      onClick={() => onOpenProblem("desk")}
                    >
                      Reopen Watermelon in companion <ArrowRight size={16} />
                    </button>
                  </>
                )}
                {current && (
                  <small>
                    This example record illustrates the collection. The live
                    companion sample uses Watermelon.
                  </small>
                )}
              </article>
            </>
          )}
          {view === "Journal" && (
            <>
              <p className={s.intro}>
                The result tells one story. Your reflection keeps the part you
                learned.
              </p>
              <div role="status" className={s.receipt}>
                {practice?.reflection ? (
                  <>
                    <Check size={17} /> Reflection received from your companion
                  </>
                ) : (
                  "Your next reflection will appear here."
                )}
              </div>
              {practice?.reflection && (
                <article
                  className={s.entry}
                  aria-label="Your Watermelon reflection"
                  key={`${practice.reflection.outcome}-${practice.reflection.takeaway}`}
                >
                  <span>YOUR SESSION · JUST NOW</span>
                  <h4>Watermelon</h4>
                  <div className={s.meta}>
                    <span>
                      Learning outcome
                      <strong>{practice.reflection.outcome}</strong>
                    </span>
                    <span>
                      Platform verdict<strong>Recorded separately</strong>
                    </span>
                  </div>
                  <blockquote>
                    {practice.reflection.takeaway ||
                      "A session kept. You can add a takeaway in the companion."}
                  </blockquote>
                  {practice.recall && (
                    <details>
                      <summary>Your recall · {practice.recall.outcome}</summary>
                      <p>{practice.recall.text}</p>
                    </details>
                  )}
                  <div className={s.actions}>
                    <button onClick={() => onOpenProblem("desk")}>
                      Reopen problem <ArrowRight size={16} />
                    </button>
                    <button onClick={() => onOpenProblem("recall")}>
                      Try recall
                    </button>
                  </div>
                </article>
              )}
              <h4 className={s.sectionTitle}>Example records</h4>
              {examples.map((item) => (
                <article key={item.id} className={s.example}>
                  <span>
                    {item.platform} · {item.id} · {item.outcome}
                  </span>
                  <h4>{item.title}</h4>
                  <p>{item.note}</p>
                  <button
                    className={s.link}
                    onClick={() => {
                      setSelected(item.title);
                      setQuery("");
                      showView("Practice");
                    }}
                  >
                    View problem <ArrowRight size={15} />
                  </button>
                </article>
              ))}
            </>
          )}
        </div>
      </div>
      <footer>
        Website sample · changes stay in this page and clear on reset or reload.
      </footer>
    </div>
  );
}
