"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Leaf,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  Duration,
  addDays,
  breakthroughs,
  latestReflection,
  localDate,
  reviewLabel,
  reviewQueue,
  shortDate,
  visibleProblems,
  suggestion,
  weekActivity,
  skipRecommendation,
} from "@/lib/model";
import { useWorkspace } from "./provider";
import { FreshDiscovery } from "./discovery";
import { TodayActivity } from "./codeforces";
import { SectionHeading, Tags } from "./ui";

function PracticeIllustration({ empty = false }: { empty?: boolean }) {
  return (
    <div
      className={`practice-art ${empty ? "empty-art" : ""}`}
      aria-hidden="true"
    >
      <svg width="170" height="190" viewBox="0 0 170 190" fill="none">
        <path
          d="M15 163C15 140 18 20 83 20C148 20 155 121 155 163H15Z"
          fill="currentColor"
          opacity=".06"
        />
        <path
          d="M35 149H135M35 123H135M35 97H135M35 71H135M35 45H135M35 45V149M61 45V149M87 45V149M113 45V149M135 45V149"
          stroke="currentColor"
          strokeWidth=".75"
          opacity=".17"
        />
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={38 + i * 25}
            y={126 - i * 26}
            width="20"
            height="20"
            rx="2"
            fill="currentColor"
            opacity={0.15 + i * 0.12}
          />
        ))}
        <path
          d="M42 157L142 57M131 57H142V68"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 4"
          opacity=".55"
        />
        <circle cx="32" cy="26" r="3" fill="currentColor" opacity=".35" />
        <path
          d="M144 30V40M139 35H149"
          stroke="currentColor"
          strokeWidth="1"
          opacity=".5"
        />
        <text
          x="85"
          y="184"
          textAnchor="middle"
          fill="currentColor"
          fontSize="8"
          fontFamily="monospace"
          letterSpacing="2"
          opacity=".6"
        >
          ONE STEP AT A TIME
        </text>
      </svg>
    </div>
  );
}
export function WeeklyRhythm() {
  const { data } = useWorkspace();
  const days = weekActivity(data);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const goal = data.settings.weeklyGoal;
  const start = days[0].date,
    end = addDays(start, 6);
  return (
    <section className="rhythm-panel" aria-labelledby="rhythm-title">
      <div className="section-heading">
        <h2 id="rhythm-title">Your weekly rhythm</h2>
        <span className="mono tiny">
          {shortDate(localDate(start))}–{end.getDate()}
        </span>
      </div>
      <p className="rhythm-count">
        <strong>
          {total}
          <span> / {goal}</span>
        </strong>
        <span>timed sessions this week</span>
      </p>
      <div
        className="rhythm-days"
        role="list"
        aria-label="Completed sessions Monday to Sunday"
      >
        {days.map((day) => (
          <div
            role="listitem"
            key={day.day}
            className={`rhythm-day ${day.count ? "completed" : ""} ${day.today ? "is-today" : ""} ${day.future ? "future" : ""}`}
            aria-label={`${day.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}: ${day.count} completed session${day.count === 1 ? "" : "s"}${day.today ? ", today" : ""}`}
          >
            <div className="day-stem">
              {day.count ? (
                <>
                  <span
                    className="day-fill"
                    style={{ height: `${Math.min(100, 35 + day.count * 25)}%` }}
                  />
                  <Check size={14} />
                </>
              ) : (
                <span className="day-dot" />
              )}
            </div>
            <span className="day-name">
              {day.date
                .toLocaleDateString("en-US", { weekday: "short" })
                .slice(0, 1)}
            </span>
            <span className="today-dot" />
          </div>
        ))}
      </div>
      <p className="rhythm-caption">
        {total === 0
          ? "An open week. Make room for a little practice."
          : total >= goal
            ? "You’ve made room for your practice. Anything more is a bonus."
            : `${goal - total} more ${goal - total === 1 ? "session" : "sessions"} to your flexible goal. There’s room to find your own rhythm.`}
      </p>
      <Link href="/progress" className="text-link">
        See your progress
        <ArrowUpRight size={15} />
      </Link>
    </section>
  );
}
export function Today() {
  const { data, mode, setMode, startSession, setAddOpen, update } =
    useWorkspace();
  const [duration, setDuration] = useState<Duration>(
    data.settings.defaultDuration,
  );
  const active = data.session;
  const activeProblem = data.problems.find(
    (problem) => problem.id === active?.problemId,
  );
  const recommended =
    active && activeProblem
      ? {
          problem: activeProblem,
          reason:
            "Your notes and timer are right where you left them. Pick up the idea whenever you’re ready.",
          focusFallback: false,
          revisit: true,
        }
      : suggestion(data);
  const upcoming = reviewQueue(data).slice(0, 3);
  const breakthrough = breakthroughs(data)[0];
  const now = new Date();
  return (
    <div className="today-page page-enter">
      <header
        className={`today-header ${data.problems.length ? "returning" : ""}`}
      >
        <div className="eyebrow">
          <span className="small-line" />
          {now
            .toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "2-digit",
            })
            .toUpperCase()}
        </div>
        {data.problems.length ? (
          <h1>
            {data.settings.displayName
              ? `Welcome back, ${data.settings.displayName}.`
              : "A little practice today."}
          </h1>
        ) : (
          <h1>
            A little sharper,
            <br />
            <em>every day.</em>
          </h1>
        )}
        <p>One focused session is enough to move forward.</p>
        <span className="header-side-note">
          THE ART OF
          <br />
          SHOWING UP<span>01 — DAILY PRACTICE</span>
        </span>
      </header>
      <div className="today-grid">
        <div className="today-primary">
          <section
            className="session-card"
            aria-labelledby="session-card-title"
          >
            <div className="session-card-top">
              <span className="eyebrow">
                <span className="green-square" />
                {active
                  ? "YOUR SESSION IS WAITING"
                  : recommended
                    ? "A GOOD PLACE TO BEGIN"
                    : "MAKE A LITTLE ROOM FOR PRACTICE"}
              </span>
              <span className="card-number mono">01 / FOCUS</span>
            </div>
            <div className="duration-row">
              <span className="small muted">
                {active
                  ? "Your session intention"
                  : "How much time do you have?"}
              </span>
              {active ? (
                <span className="active-duration mono">
                  <Clock3 size={14} />
                  {active.targetMinutes} min
                </span>
              ) : (
                <div
                  className="segmented"
                  role="group"
                  aria-label="Session duration"
                >
                  {([15, 30, 60] as Duration[]).map((value) => (
                    <button
                      key={value}
                      onClick={() => setDuration(value)}
                      aria-pressed={duration === value}
                      className={duration === value ? "selected" : ""}
                    >
                      {value}
                      <span> min</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="session-card-content">
              <div>
                {recommended ? (
                  <>
                    <div className="focus-kind">
                      <RotateCcw size={13} />
                      {recommended.revisit
                        ? "A FAMILIAR PROBLEM, A FRESH TRY"
                        : "SOMETHING NEW TO UNDERSTAND"}
                    </div>
                    <h2 id="session-card-title">
                      {active
                        ? "Continue "
                        : recommended.revisit
                          ? "Revisit "
                          : "Explore "}
                      <span>{recommended.problem.title}</span>
                    </h2>
                    <div className="problem-meta">
                      <span>{recommended.problem.platform}</span>
                      {recommended.problem.problemCode && (
                        <span className="mono">
                          #{recommended.problem.problemCode}
                        </span>
                      )}
                      {recommended.problem.rating !== null && (
                        <span className="mono">
                          {recommended.problem.rating} rating
                        </span>
                      )}
                    </div>
                    <p className="suggestion-reason">{recommended.reason}</p>
                    <Tags tags={recommended.problem.tags} />
                    {recommended.focusFallback && (
                      <p className="focus-fallback">
                        No topics match your focus yet, so this suggestion uses
                        your full collection.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="focus-kind">
                      <Leaf size={14} />
                      GOOD THINGS BEGIN SMALL
                    </div>
                    <h2 id="session-card-title">
                      Your next chapter
                      <br />
                      <em>starts here.</em>
                    </h2>
                    <p className="suggestion-reason">
                      A problem to think about. A little time to yourself.
                      <br className="desktop-break" /> Build a practice that
                      feels like your own.
                    </p>
                    <p className="first-use-note">
                      Start with one problem. We’ll take it from there.
                    </p>
                  </>
                )}
              </div>
              <PracticeIllustration empty={!recommended} />
            </div>
            <div className="session-card-actions">
              {active ? (
                <Link href="/session" className="button primary">
                  <Play size={15} fill="currentColor" />
                  Resume session
                  <ArrowRight size={17} />
                </Link>
              ) : recommended ? (
                <button
                  className="button primary"
                  onClick={() => startSession(recommended.problem, duration)}
                >
                  <Play size={15} fill="currentColor" />
                  Start session
                  <ArrowRight size={17} />
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus size={17} />
                  Add my first problem
                  <ArrowRight size={17} />
                </button>
              )}
              {recommended ? (
                <Link href="/problems" className="quiet-action">
                  Choose my own problem
                  <ArrowUpRight size={15} />
                </Link>
              ) : (
                <button
                  className="quiet-action"
                  onClick={() => setMode("demo")}
                >
                  Explore the demo
                  <ArrowUpRight size={15} />
                </button>
              )}
            </div>
          </section>
          {recommended && !active && (
            <button
              className="text-link muted"
              onClick={() =>
                update((d) => skipRecommendation(d, recommended.problem.id))
              }
            >
              Skip today’s recommendation
            </button>
          )}
          <FreshDiscovery duration={duration} />
          <TodayActivity />
          <section className="upcoming-section">
            <SectionHeading
              title="Worth another look"
              link="/revisit"
              label="Your revisit list"
            />
            {upcoming.length ? (
              <div className="upcoming-list">
                {upcoming.map((problem, index) => (
                  <button
                    className="upcoming-row"
                    key={problem.id}
                    onClick={() => startSession(problem, duration)}
                  >
                    <span className="upcoming-index mono">0{index + 1}</span>
                    <div className="upcoming-problem">
                      <strong>{problem.title}</strong>
                      <span>
                        {latestReflection(data, problem.id)?.difficulty ===
                        "coding"
                          ? "From idea to implementation"
                          : problem.tags.slice(0, 2).join(" · ") ||
                            problem.platform}
                      </span>
                    </div>
                    <span
                      className={`review-time ${problem.reviewAt! <= localDate() ? "ready" : ""}`}
                    >
                      <span className="status-dot" />
                      {reviewLabel(problem.reviewAt!)}
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="quiet-empty">
                <RotateCcw size={21} strokeWidth={1.4} />
                <div>
                  <strong>A clear page for now.</strong>
                  <p>
                    Problems you need another try at will find their way here.
                  </p>
                </div>
              </div>
            )}
            <p className="section-footnote">
              <Clock3 size={13} />A revisit is an invitation. You decide when
              you’re ready.
            </p>
          </section>
        </div>
        <aside className="today-support">
          <WeeklyRhythm />
          <section className="breakthrough-section">
            <div className="section-heading">
              <h2>A small breakthrough</h2>
              <Sparkles size={16} strokeWidth={1.4} />
            </div>
            {breakthrough ? (
              <>
                <div className="breakthrough-icon">
                  <Leaf size={24} strokeWidth={1.3} />
                </div>
                <p className="breakthrough-copy">
                  You found your
                  <br />
                  <em>own way through.</em>
                </p>
                <strong className="breakthrough-problem">
                  {breakthrough.problem.title}
                </strong>
                <p className="small muted">
                  Solved independently after an earlier assisted or unfinished
                  attempt.
                </p>
                <div className="breakthrough-date">
                  <Check size={13} />
                  Independent solve ·{" "}
                  {shortDate(breakthrough.attempt.completedAt)}
                </div>
              </>
            ) : (
              <>
                <div className="breakthrough-icon">
                  <Leaf size={24} strokeWidth={1.3} />
                </div>
                <p className="breakthrough-copy">
                  Understanding
                  <br />
                  <em>takes a little time.</em>
                </p>
                <p className="small muted">
                  When a problem that once felt difficult starts to click, we’ll
                  keep that moment here.
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
      <div className="today-bottom">
        <span className="eyebrow">YOUR PRACTICE NOTEBOOK</span>
        <div>
          <span>
            <strong className="mono">
              {String(visibleProblems(data).length).padStart(2, "0")}
            </strong>{" "}
            problems collected
          </span>
          <span>
            <strong className="mono">
              {String(data.attempts.length).padStart(2, "0")}
            </strong>{" "}
            timed sessions reflected on
          </span>
          <span className="notebook-note">
            <span className="status-dot" />
            {mode === "demo"
              ? "Sample data · separate from your own"
              : "Yours, on this device"}
          </span>
        </div>
      </div>
    </div>
  );
}
