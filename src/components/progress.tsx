"use client";
import { useState } from "react";
import { learningStats, learningBreakthroughs } from "@/lib/learning";
import { ArrowRight, Check, Leaf, TrendingUp } from "lucide-react";
import Link from "next/link";
import {
  DIFFICULTIES,
  addDays,
  localDate,
  shortDate,
  weekStart,
} from "@/lib/model";
import { useWorkspace } from "./provider";
import { CodeforcesProgress } from "./codeforces";
import { LearningSummary } from "./learning-summary";
import { EmptyState, PageHeader, SectionHeading } from "./ui";

export function Progress() {
  const { data } = useWorkspace();
  const [handle, setHandle] = useState(data.codeforces.connectedHandle ?? "");
  const stats = learningStats(data, { handle });
  const total = stats.reflected;
  const independent = stats.independent;
  const assisted = stats.assisted;
  const unsolved = stats.unsolved;
  const wins = learningBreakthroughs(data, { handle });
  const difficulties = Object.entries(DIFFICULTIES)
    .map(([key, label]) => ({
      key,
      label,
      count: stats.difficulties.find((d) => d.difficulty === key)?.count ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
  const maxDifficulty = Math.max(1, ...difficulties.map((d) => d.count));
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const date = addDays(weekStart(), -(5 - i) * 7);
    const end = addDays(date, 7);
    return {
      date,
      count: data.attempts.filter(
        (a) => new Date(a.completedAt) >= date && new Date(a.completedAt) < end,
      ).length,
    };
  });
  const maxWeek = Math.max(
    data.settings.weeklyGoal,
    ...weeks.map((w) => w.count),
    1,
  );
  const topics = stats.topics;
  const maxTopic = Math.max(1, ...topics.map((t) => t.count));
  const minutes = stats.measuredMinutes;
  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="EVIDENCE, NOT EXPECTATIONS"
        title="See what’s taking shape."
        description="A thoughtful look at your practice. Understanding goes beyond a solved count."
      />
      {data.codeforces.profiles.length > 0 && (
        <label className="cf-progress-profile">
          Learning profile
          <select value={handle} onChange={(e) => setHandle(e.target.value)}>
            <option value="">Personal timed practice only</option>
            {data.codeforces.profiles.map((p) => (
              <option key={p.handle}>{p.handle}</option>
            ))}
          </select>
        </label>
      )}
      <LearningSummary handle={handle} />
      {!stats.practiceAttempts ? (
        <EmptyState
          icon={<TrendingUp size={30} strokeWidth={1.4} />}
          title="Your progress begins with an attempt."
          description="Practise in Forma or import Codeforces activity. Reflections distinguish understanding from acceptance."
          action={
            <Link className="button primary" href="/problems">
              Choose a problem
              <ArrowRight size={16} />
            </Link>
          }
        />
      ) : (
        <>
          <div className="progress-overview">
            <div>
              <span className="eyebrow">PRACTICE ATTEMPTS</span>
              <strong className="mono">
                {stats.practiceAttempts}
                <small>{stats.timedSessions} timed sessions</small>
              </strong>
            </div>
            <div>
              <span className="eyebrow">MEASURED FOCUS TIME</span>
              <strong className="mono">
                {minutes >= 60
                  ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
                  : `${minutes}m`}
                <small>focused time</small>
              </strong>
            </div>
            <div>
              <span className="eyebrow">FOUND YOUR OWN WAY</span>
              <strong className="mono">
                {wins.length}
                <small>
                  {wins.length === 1
                    ? "later independent solve"
                    : "later independent solves"}
                </small>
              </strong>
            </div>
          </div>
          <p className="small muted">
            {stats.reflected} reflected · {stats.pending} attempted, reflection
            pending · {stats.practiceDays.length} practice days. A practice day
            includes a completed timed session or an imported submission;
            imported activity adds no measured minutes.
          </p>
          <div className="progress-grid">
            <section className="progress-section">
              <SectionHeading title="How your attempts unfold" />
              <p className="small muted">
                Every kind of attempt has something to teach you.
              </p>
              <div className="outcome-big">
                <strong className="mono">{independent}</strong>
                <span>
                  of {total} reflected attempts
                  <br />
                  solved independently
                </span>
              </div>
              <div
                className="outcome-chart"
                role="img"
                aria-label={`${independent} independent solves, ${assisted} assisted attempts, ${unsolved} not solved yet.`}
              >
                {independent > 0 && (
                  <div
                    className="independent-bar"
                    style={{ width: `${(independent / total) * 100}%` }}
                  />
                )}
                {assisted > 0 && (
                  <div
                    className="assisted-bar"
                    style={{ width: `${(assisted / total) * 100}%` }}
                  />
                )}
                {unsolved > 0 && (
                  <div
                    className="unsolved-bar"
                    style={{ width: `${(unsolved / total) * 100}%` }}
                  />
                )}
              </div>
              <div className="chart-legend">
                <span>
                  <i className="independent-bar" />
                  Independent<strong className="mono">{independent}</strong>
                </span>
                <span>
                  <i className="assisted-bar" />
                  With help<strong className="mono">{assisted}</strong>
                </span>
                <span>
                  <i className="unsolved-bar" />
                  Still exploring<strong className="mono">{unsolved}</strong>
                </span>
              </div>
              <p className="tiny muted">
                “With help” includes hints and editorials. Unreflected
                acceptances stay pending. Explicitly linked records receive
                learning credit once.
              </p>
            </section>
            <section className="progress-section">
              <SectionHeading title="Where to give a little attention" />
              <p className="small muted">
                Difficulties you’ve mentioned in your reflections.
              </p>
              <div className="difficulty-chart">
                {difficulties.map((d) => (
                  <div className="difficulty-row" key={d.key}>
                    <div>
                      <span>{d.label}</span>
                      <strong className="mono">{d.count}</strong>
                    </div>
                    <div className="bar-track">
                      <span
                        style={{ width: `${(d.count / maxDifficulty) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="tiny muted">
                Optional reflections; an attempt may have no difficulty
                selected.
              </p>
            </section>
            <section className="progress-section">
              <SectionHeading title="A practice you’re returning to" />
              <p className="small muted">
                Completed timed Forma sessions across the last six weeks.
              </p>
              <div
                className="consistency-chart"
                role="img"
                aria-label={
                  weeks
                    .map(
                      (w) =>
                        `Week of ${shortDate(localDate(w.date))}: ${w.count} sessions`,
                    )
                    .join(". ") +
                  `. Flexible goal: ${data.settings.weeklyGoal} per week.`
                }
              >
                <div
                  className="goal-line"
                  style={{
                    bottom: `${28 + (data.settings.weeklyGoal / maxWeek) * 112}px`,
                  }}
                >
                  <span>GOAL {data.settings.weeklyGoal}</span>
                </div>
                {weeks.map((w, i) => (
                  <div
                    className={`week-bar ${i === 5 ? "current-week" : ""}`}
                    key={w.date.toISOString()}
                  >
                    <span className="mono">{w.count}</span>
                    <div style={{ height: `${(w.count / maxWeek) * 112}px` }} />
                    <span className="week-label">
                      {shortDate(localDate(w.date))}
                    </span>
                  </div>
                ))}
              </div>
              <p className="tiny muted">
                A flexible goal, with room for life. Current week is still in
                progress.
              </p>
            </section>
            <section className="progress-section later-solves">
              <SectionHeading title="From a struggle to a small win" />
              {wins.length ? (
                <>
                  <p className="small muted">
                    Problems you later solved independently after needing help
                    or another try.
                  </p>
                  <div className="win-list">
                    {wins.map((win) => (
                      <div key={win.problem.id}>
                        <span className="win-check">
                          <Check size={15} />
                        </span>
                        <div>
                          <strong>{win.problem.title}</strong>
                          <span>
                            {shortDate(win.attempt.completedAt)} ·{" "}
                            {win.problem.platform}
                          </span>
                        </div>
                        <Leaf size={17} strokeWidth={1.4} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="quiet-empty">
                  <Leaf size={24} />
                  <p>
                    These moments take time. Your first independent revisit will
                    have a home here.
                  </p>
                </div>
              )}
            </section>
          </div>
          <section className="topic-section">
            <SectionHeading title="The ideas you’ve been practising" />
            <p className="small muted">
              Topic coverage shows practice, not mastery. One attempt may cover
              several topics.
            </p>
            {topics.length ? (
              <div className="topic-grid">
                {topics.map(({ topic, count }) => (
                  <div key={topic} className="topic-coverage">
                    <div>
                      <strong>{topic}</strong>
                      <span className="mono">
                        {count}
                        <small> attempts</small>
                      </span>
                    </div>
                    <div className="bar-track">
                      <span style={{ width: `${(count / maxTopic) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                Add topics to your problems to see where your practice goes.
              </p>
            )}
          </section>
        </>
      )}
      <CodeforcesProgress />
      <div className="progress-note">
        <Leaf size={19} strokeWidth={1.3} />
        <p>
          A number can show what you’ve done. Your reflections help you
          understand what you’ve learned.
        </p>
      </div>
    </div>
  );
}
