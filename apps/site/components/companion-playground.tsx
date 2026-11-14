"use client";
import Link from "next/link";
import type { SamplePractice } from "./companion-sample";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Feather,
  FileCode2,
  Lightbulb,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import {
  DesktopRibbonMark,
  type RibbonFeedback,
} from "../../desktop/renderer/DesktopRibbonMark";
import { ProblemDesk, type DeskItem } from "../../desktop/renderer/ProblemDesk";
import { DeskIdeaCard } from "../../desktop/renderer/DeskIdeaCard";
import { DeskHintCard } from "../../desktop/renderer/DeskHintCard";
import { RibbonStudio } from "../../../packages/ribbon/RibbonStudio";
import { defaultRibbon } from "../../../packages/ribbon/options";
import type { IdeaOutline } from "../../../packages/tutor/types";
import type { DeskEntry } from "../../../packages/contracts/src";
import {
  sampleChallenge,
  sampleCode,
  sampleExplanation,
  sampleHint,
  sampleOutline,
  sampleReview,
  tourScenes,
  type SampleReflection,
  type TourScene,
} from "./companion-sample";
import "../../../packages/ribbon/studio.css";
import s from "./companion-playground.module.css";
import {
  PracticeGuide,
  PracticeTrail,
  BoundaryCase,
  ContinuePractice,
  practiceSteps,
} from "./practice-guide";
import { MotionFeedback, type CodeFlight } from "./motion-feedback";
import { ReturnStory, exampleReturnThought } from "./return-story";

const icons = [
  Clock3,
  BookOpen,
  Feather,
  Lightbulb,
  Check,
  RotateCcw,
  SlidersHorizontal,
];
const seedThread =
  "I checked odd weights. Next, try the smallest even weight before trusting the pattern.";
const outcomes = ["Independent", "With a hint", "Editorial", "Not solved yet"];

export function CompanionPlayground({
  launch,
  onReflection,
  onPracticeChange,
  onPreviewReset,
  onOpenWorkspace,
  downloadUrl,
  guided = false,
  active = true,
  compact = false,
  onExpand,
  startRequest = 0,
}: {
  onPreviewReset?: () => void;
  onPracticeChange?: (practice: SamplePractice) => void;
  onOpenWorkspace?: () => void;
  downloadUrl?: string | null;
  launch?: { scene: TourScene; id: number; startTimer?: boolean };
  guided?: boolean;
  active?: boolean;
  compact?: boolean;
  onExpand?: () => void;
  startRequest?: number;
  onReflection?: (reflection: SampleReflection | null) => void;
}) {
  const [guidedMode, setGuidedMode] = useState(guided);
  const [step, setStep] = useState(0);
  const [scene, setScene] = useState<TourScene>("focus");
  const [collapsed, setCollapsed] = useState(false);
  const [ink, setInk] = useState(false);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState("");
  const [feedback, setFeedback] = useState<RibbonFeedback | null>(null);
  const [items, setItems] = useState<DeskItem[]>([
    {
      id: "sample-thread",
      kind: "thread",
      text: seedThread,
      createdAt: "2026-11-13T09:00:00.000Z",
    },
  ]);
  const [threadDraft, setThreadDraft] = useState("");
  const [editThread, setEditThread] = useState(false);
  const [explanation, setExplanation] = useState(sampleExplanation);
  const [outline, setOutline] = useState<IdeaOutline | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [challenged, setChallenged] = useState(false);
  const [includeStatement, setIncludeStatement] = useState(true);
  const [includeCode, setIncludeCode] = useState(false);
  const [includeHypothesis, setIncludeHypothesis] = useState(false);
  const [hintShown, setHintShown] = useState(false);
  const [outlineKept, setOutlineKept] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [takeaway, setTakeaway] = useState("");
  const [reflectionRevision, setReflectionRevision] = useState(0);
  const [reflection, setReflection] = useState<SampleReflection | null>(null);
  const [recall, setRecall] = useState("");
  const [recallOutcome, setRecallOutcome] = useState("Recalled independently");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [recallSaved, setRecallSaved] = useState(false);
  const [ribbonOptions, setRibbonOptions] = useState(defaultRibbon);
  const [contextOpen, setContextOpen] = useState(false);
  const [hostTab, setHostTab] = useState<"code" | "statement">("code");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [flight, setFlight] = useState<CodeFlight | null>(null);
  const [storyPhase, setStoryPhase] = useState(0);
  const [storyDraft, setStoryDraft] = useState(exampleReturnThought);
  const [storyPlaying, setStoryPlaying] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const nextId = useRef(0);
  const current = tourScenes.find((item) => item.id === scene)!;
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const latestThread = items
    .filter((item) => item.kind === "thread")
    .at(-1)?.text;
  const codePinned = items.some((item) => item.kind === "code");

  const ownThread = items
    .filter((item) => item.kind === "thread" && item.id !== "sample-thread")
    .at(-1)?.text;
  const completed = [
    codePinned,
    !!ownThread,
    challenged || hintShown,
    !!reflection,
    recallSaved,
  ];
  const publishPractice = useEffectEvent(() =>
    onPracticeChange?.({
      reflectionRevision,
      code: codePinned,
      thought:
        items.find(
          (item) => item.kind === "thread" && item.id !== "sample-thread",
        )?.text || "",
      reflection,
      recall: recallSaved ? { text: recall, outcome: recallOutcome } : null,
    }),
  );
  useEffect(() => {
    publishPractice();
  }, [
    items,
    reflection,
    reflectionRevision,
    recallSaved,
    recall,
    recallOutcome,
  ]);
  function goStep(next: number) {
    setStoryPlaying(false);
    onExpand?.();
    setGuidedMode(true);
    setStep(next);
    setContextOpen(false);
    setScene(practiceSteps[next].scene);
    setCollapsed(false);
    setNotice("");
    if (next === 1 && !ownThread) setEditThread(true);
    requestAnimationFrame(() => {
      stage.current
        ?.querySelector<HTMLElement>("#journey-title")
        ?.focus({ preventScroll: true });
      stage.current?.scrollIntoView({
        block: "start",
        behavior: reducedMotion ? "instant" : "smooth",
      });
    });
  }
  function begin() {
    const next = completed.findIndex((value) => !value);
    setRunning(true);
    goStep(next < 0 ? 4 : next);
  }
  const startFromRequest = useEffectEvent(begin);
  useEffect(() => {
    if (startRequest) startFromRequest();
  }, [startRequest]);
  useEffect(() => {
    if (!compact && guidedMode && scene === "focus") setScene("desk");
  }, [compact, guidedMode, scene]);

  function advanceStory() {
    if (storyPhase === 0) {
      setStoryPhase(1);
      setCollapsed(false);
    } else if (storyPhase === 1 && storyDraft.trim()) {
      const thought = storyDraft.trim();
      setItems((previous) => [
        ...previous.filter((item) => item.id !== "return-story-thought"),
        ...(!previous.some((item) => item.kind === "code")
          ? [
              {
                id: "return-story-code",
                kind: "code" as const,
                text: sampleCode.split("\n").slice(6, 11).join("\n"),
                createdAt: new Date().toISOString(),
              },
            ]
          : []),
        {
          id: "return-story-thought",
          kind: "thread",
          text: thought,
          createdAt: new Date().toISOString(),
        },
      ]);
      setExplanation(thought);
      setScene("desk");
      setCollapsed(false);
      setStoryPhase(2);
      react("thought");
    } else if (storyPhase === 2) {
      setCollapsed(true);
      setStoryPhase(3);
      react("bookmark");
    } else if (storyPhase === 3) {
      setScene("desk");
      setCollapsed(false);
      setStoryPhase(4);
      setStoryPlaying(false);
      react("thought");
    }
  }
  const playNextBeat = useEffectEvent(advanceStory);
  useEffect(() => {
    if (
      !storyPlaying ||
      !active ||
      !compact ||
      reducedMotion ||
      !visible ||
      storyPhase >= 4
    )
      return;
    const timer = setTimeout(
      () => playNextBeat(),
      [2200, 5800, 5000, 5000][storyPhase],
    );
    return () => clearTimeout(timer);
  }, [storyPlaying, storyPhase, compact, reducedMotion, visible, active]);
  useEffect(() => {
    if (!visible || !compact || reducedMotion || !active)
      setStoryPlaying(false);
  }, [visible, compact, reducedMotion, active]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setStoryPlaying(false);
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  function foldCompanion(next: boolean) {
    setStoryPlaying(false);
    setCollapsed(next);
    if (compact && storyPhase >= 2) {
      setStoryPhase(next ? 3 : 4);
      if (!next) setScene("desk");
    }
    if (next)
      requestAnimationFrame(() =>
        stage.current
          ?.querySelector<HTMLButtonElement>('[aria-label="Open companion"]')
          ?.focus({ preventScroll: true }),
      );
  }

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries[0]?.isIntersecting ?? false),
    );
    if (stage.current) observer.observe(stage.current);
    return () => {
      preference.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!running || !visible || !active) return;
    const timer = setInterval(() => {
      if (!document.hidden) setSeconds((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [running, visible, active]);
  useEffect(() => {
    if (launch) {
      if (launch.startTimer) setRunning(true);
      setGuidedMode(false);
      setScene(launch.scene);
      setCollapsed(false);
      setNotice("");
    }
  }, [launch]);
  useEffect(() => {
    panel.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [scene, collapsed]);

  function open(next: TourScene) {
    onExpand?.();
    if (guidedMode) {
      const index =
        next === "desk"
          ? codePinned
            ? 1
            : 0
          : next === "idea" || next === "hint"
            ? 2
            : next === "reflect"
              ? 3
              : next === "recall"
                ? 4
                : -1;
      if (index >= 0) setStep(index);
      else setGuidedMode(false);
    }
    setScene(next);
    setCollapsed(false);
    setNotice("");
  }
  function reveal(target: "host" | "companion") {
    requestAnimationFrame(() =>
      (target === "host" ? host.current : panel.current)?.scrollIntoView({
        block: "start",
        behavior: reducedMotion ? "instant" : "smooth",
      }),
    );
  }
  function openContext(next: "code" | "statement") {
    onExpand?.();
    setContextOpen(true);
    setHostTab(next);
    reveal("host");
  }
  function react(kind: RibbonFeedback["kind"]) {
    setFeedback({ kind, id: ++nextId.current });
  }
  function flyCode(source: HTMLElement) {
    if (reducedMotion) return;
    requestAnimationFrame(() => {
      if (!stage.current || !panel.current || !source.isConnected) return;
      const bounds = stage.current.getBoundingClientRect();
      const from = source.getBoundingClientRect();
      const to = panel.current.getBoundingClientRect();
      setFlight({
        id: ++nextId.current,
        x: from.left + from.width / 2 - bounds.left,
        y: from.top + from.height / 2 - bounds.top,
        dx: to.left + to.width / 2 - from.left - from.width / 2,
        dy: to.top + 60 - from.top - from.height / 2,
      });
    });
  }
  async function saveItem(item: DeskEntry) {
    setItems((value) => [
      ...value,
      {
        ...item,
        id: `sample-item-${++nextId.current}`,
        createdAt: new Date().toISOString(),
      },
    ]);
    if (guidedMode && item.kind === "thread") {
      if (step === 1) {
        setExplanation(item.text || "");
        setOutline(null);
        setChallenged(false);
      }
      if (step === 2) setTakeaway(item.text || "");
    }
    setNotice("Saved in this preview.");
    react("thought");
    return true;
  }
  function keepAsThread(text: string) {
    setThreadDraft(text);
    setEditThread(true);
    open("desk");
    if (guidedMode && step === 2) setStep(2);
  }
  function changeTab(event: KeyboardEvent<HTMLDivElement>) {
    const index = tourScenes.findIndex((item) => item.id === scene);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tourScenes.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tourScenes.length) % tourScenes.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tourScenes.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      open(tourScenes[next].id);
      tabRefs.current[next]?.focus();
    }
  }
  function reset() {
    setStoryPhase(0);
    setStoryDraft(exampleReturnThought);
    setStoryPlaying(false);
    setReflectionRevision(0);
    onPreviewReset?.();
    setScene(guided && !compact ? "desk" : "focus");
    setGuidedMode(guided);
    setStep(0);
    setCollapsed(false);
    setRunning(false);
    setSeconds(0);
    setNotice("Preview reset.");
    setItems([
      {
        id: "sample-thread",
        kind: "thread",
        text: seedThread,
        createdAt: "2026-11-13T09:00:00.000Z",
      },
    ]);
    setThreadDraft("");
    setEditThread(false);
    setExplanation(sampleExplanation);
    setOutline(null);
    setSelected(null);
    setChallenged(false);
    setHintShown(false);
    setOutlineKept(false);
    setIncludeStatement(true);
    setIncludeCode(false);
    setIncludeHypothesis(false);
    setOutcome("");
    setTakeaway("");
    setReflection(null);
    setRecall("");
    setRecallSaved(false);
    setMemoryOpen(false);
    setRecallOutcome("Recalled independently");
    setRibbonOptions(defaultRibbon);
    setInk(false);
    setFeedback(null);
    setFlight(null);
    setHostTab("code");
    setContextOpen(false);
    onReflection?.(null);
  }

  return (
    <div
      ref={stage}
      className={s.playground}
      id="companion-playground"
      aria-label="Interactive Forma companion"
      role="region"
      data-compact={compact}
      data-guided={guidedMode}
      data-step={step}
      data-story-phase={storyPhase}
      data-story-playing={storyPlaying}
    >
      {flight && (
        <MotionFeedback
          key={flight.id}
          flight={flight}
          onComplete={() => setFlight(null)}
        />
      )}
      <div className={s.tourBar}>
        <span>
          <span className={s.liveDot} /> EXPLORE FORMA
        </span>
        <div className={s.modeControls}>
          {guided && (
            <button
              onClick={() => {
                setGuidedMode(!guidedMode);
                if (!guidedMode) goStep(step);
              }}
            >
              {guidedMode ? "Explore freely" : "Follow the guide"}
            </button>
          )}
          <button onClick={reset}>
            <RotateCcw size={13} /> Reset preview
          </button>
        </div>
      </div>
      {guidedMode && (
        <PracticeGuide step={step} completed={completed} onStep={goStep} />
      )}
      <div
        hidden={guidedMode}
        role="tablist"
        aria-label="Explore companion features"
        className={s.tabs}
        onKeyDown={changeTab}
      >
        {tourScenes.map((item, index) => {
          const Icon = icons[index];
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              id={`tour-${item.id}`}
              role="tab"
              aria-selected={scene === item.id}
              aria-controls="companion-scene"
              tabIndex={scene === item.id ? 0 : -1}
              onClick={() => open(item.id)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className={s.sceneHeading} hidden={guidedMode}>
        <div>
          <p className={s.sceneIndex}>
            0{tourScenes.indexOf(current) + 1} / THE COMPANION IN PRACTICE
          </p>
          <h3>{current.title}</h3>
        </div>
        <p>{current.description}</p>
      </div>
      <div
        className={s.desktop}
        id="companion-scene"
        role={guidedMode ? "region" : "tabpanel"}
        aria-label={guidedMode ? "Your sample practice" : undefined}
        aria-labelledby={guidedMode ? undefined : `tour-${scene}`}
      >
        <div className={s.desktopBar}>
          <span className={s.traffic} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>your practice space</span>
          <span className={s.sampleLabel}>INTERACTIVE SAMPLE</span>
        </div>
        <div className={s.desktopContent}>
          {compact && (
            <ReturnStory
              phase={storyPhase}
              draft={storyDraft}
              thought={
                items.find((item) => item.id === "return-story-thought")
                  ?.text || ""
              }
              playing={storyPlaying}
              reducedMotion={reducedMotion}
              onDraft={(value) => {
                setStoryPlaying(false);
                setStoryDraft(value);
              }}
              onAdvance={() => {
                setStoryPlaying(false);
                advanceStory();
              }}
              onPlay={() => setStoryPlaying(true)}
              onPause={() => setStoryPlaying(false)}
              onReplay={() => {
                setStoryPlaying(false);
                setStoryPhase(0);
                setScene("focus");
                setCollapsed(false);
              }}
              onContinue={begin}
            />
          )}
          <div className={s.host} ref={host}>
            {guidedMode && step > 0 && (
              <PracticeTrail
                codePinned={codePinned}
                thought={ownThread}
                takeaway={reflection?.takeaway}
                concealed={step === 4 && !memoryOpen}
              />
            )}
            <div
              className={s.contextEditor}
              hidden={guidedMode && step > 1 && !contextOpen}
            >
              <div className={s.hostTabs}>
                <button
                  aria-pressed={hostTab === "code"}
                  onClick={() => setHostTab("code")}
                >
                  <FileCode2 size={13} /> VS Code
                </button>
                <button
                  aria-pressed={hostTab === "statement"}
                  onClick={() => setHostTab("statement")}
                >
                  <Code2 size={13} /> Codeforces
                </button>
              </div>
              <div className={s.hostPath}>
                <span>
                  {hostTab === "code"
                    ? "practice / watermelon.cpp"
                    : "problemset / 4A"}
                </span>
                <span>sample context</span>
              </div>
              {hostTab === "code" ? (
                <div className={s.codeWindow}>
                  <div className={s.codeHeading}>
                    <span>C++</span>
                    <span className={s.codeSelection}>Lines 7–11 selected</span>
                  </div>
                  <pre aria-label="Sample VS Code solution">
                    {sampleCode.split("\n").map((line, index) => (
                      <span
                        className={
                          index >= 6 && index <= 10 ? s.selectedLine : ""
                        }
                        key={index}
                      >
                        <i>{index + 1}</i>
                        <code>{line || " "}</code>
                      </span>
                    ))}
                  </pre>
                  <button
                    className={s.pinCode}
                    onClick={(event) => {
                      if (!codePinned) {
                        flyCode(event.currentTarget);
                        void saveItem({
                          kind: "code",
                          text: sampleCode.split("\n").slice(6, 11).join("\n"),
                        });
                      }
                      open("desk");
                      if (guidedMode) {
                        setStep(1);
                        setEditThread(true);
                      }
                      reveal("companion");
                    }}
                  >
                    <FileCode2 size={14} />
                    {codePinned
                      ? "Open pinned selection"
                      : "Pin selection to desk"}
                    <ArrowRight size={14} />
                  </button>
                  <p className={s.hostFoot}>
                    In the Mac app, explicitly share a selection from your
                    paired VS Code extension.
                  </p>
                </div>
              ) : (
                <article className={s.statement}>
                  <span>CODEFORCES · 4A</span>
                  <h4>Watermelon</h4>
                  <p>
                    Split a weight into two positive parts, both even. Can it be
                    done?
                  </p>
                  <dl>
                    <div>
                      <dt>INPUT</dt>
                      <dd>An integer w, from 1 to 100.</dd>
                    </div>
                    <div>
                      <dt>OUTPUT</dt>
                      <dd>YES if a split exists. Otherwise NO.</dd>
                    </div>
                  </dl>
                  <div className={s.sampleIO}>
                    <span>
                      sample input <b>8</b>
                    </span>
                    <span>
                      sample output <b>YES</b>
                    </span>
                  </div>
                  <p className={s.hostFoot}>
                    Example statement context. Capture or paste the full
                    statement before asking your Tutor.
                  </p>
                </article>
              )}
            </div>
            {guidedMode && step === 2 && (challenged || hintShown) && (
              <BoundaryCase />
            )}
            <div className={s.connection}>
              <span />
              <p>
                <strong>Your code stays with its problem.</strong>
                <br />
                Notes, selected code, and your next step stay together.
              </p>
            </div>
            <div className={s.tryCue}>
              <span>TRY THIS</span>
              <p key={scene}>{current.task}</p>
            </div>
          </div>

          <div
            className={`${s.companionSpace} ${collapsed ? s.isCollapsed : ""}`}
          >
            <div className={s.companionAnnotation}>
              your real companion.
              <br />a sample practice session.
            </div>
            <div
              className={`${s.nativeSurface} companion ${ink ? "theme-ink" : "theme-light"} ${reducedMotion || ribbonOptions.motion === "still" ? "is-reduced" : ""}`}
              data-ink={ink}
            >
              {!collapsed && (
                <div className={s.nativeCard}>
                  {feedback && (
                    <span
                      key={feedback.id}
                      className={s.arrivalRing}
                      aria-hidden="true"
                    />
                  )}
                  <div className={s.nativeHeader}>
                    <span>
                      <DesktopRibbonMark size={28} feedback={feedback} />
                      <strong>forma</strong>
                      <small>ribbon</small>
                    </span>
                    <div>
                      <button
                        aria-label={
                          ink ? "Use light appearance" : "Use ink appearance"
                        }
                        onClick={() => setInk(!ink)}
                      >
                        {ink ? <Sun size={15} /> : <Moon size={15} />}
                      </button>
                      <button
                        aria-label="Collapse companion"
                        onClick={() => foldCompanion(true)}
                      >
                        <Minus size={16} />
                      </button>
                    </div>
                  </div>
                  <div className={s.nativeBody} ref={panel}>
                    {(scene === "idea" || scene === "hint") && (
                      <p className={s.fixtureNotice}>
                        Prepared Watermelon example · no AI request is sent.
                        Responses illustrate this example, including if you edit
                        its text.
                      </p>
                    )}
                    {scene === "focus" && (
                      <div className={s.focusView}>
                        <button
                          className={s.today}
                          onClick={() => {
                            setRunning(true);
                            setNotice(
                              "Sample session started. The Ribbon keeps time while you explore.",
                            );
                          }}
                        >
                          Today’s plan <strong>Watermelon · 25 min</strong>
                          <ChevronRight size={13} />
                        </button>
                        <span className="eyebrow">IN YOUR OWN TIME</span>
                        <h4>
                          One thought
                          <br />
                          <em>at a time.</em>
                        </h4>
                        <p>Ribbon will keep the thread while you focus.</p>
                        <button
                          className={s.problemChip}
                          onClick={() => openContext("statement")}
                        >
                          <Code2 size={22} />
                          <span>
                            <small>CODEFORCES · 4A</small>
                            <strong>Watermelon</strong>
                            <small>Sample problem context</small>
                          </span>
                          <ArrowUpRight size={13} />
                        </button>
                        <div className={s.sessionLine}>
                          <span>
                            <i />
                            {running
                              ? "Session running"
                              : seconds
                                ? "Taking a quiet moment"
                                : "Ready when you are"}
                          </span>
                          <time>{clock}</time>
                        </div>
                        <button
                          className="button"
                          onClick={() => {
                            if (compact) {
                              begin();
                              return;
                            }
                            if (!running && !seconds) {
                              setRunning(true);
                              setNotice("Your sample session has started.");
                            } else {
                              setEditThread(true);
                              open("desk");
                            }
                          }}
                        >
                          {compact
                            ? "Try this problem"
                            : !running && !seconds
                              ? "Start sample session"
                              : "Save a thought"}
                          {!running && !seconds ? (
                            <Play size={13} />
                          ) : (
                            <Plus size={13} />
                          )}
                        </button>
                        <div className={s.splitActions}>
                          <button onClick={() => setRunning(!running)}>
                            {running ? <Pause size={12} /> : <Play size={12} />}
                            {running ? "Pause" : "Resume"}
                          </button>
                          <button
                            onClick={() => {
                              setRunning(false);
                              open("reflect");
                            }}
                          >
                            <Check size={12} />
                            Finish & reflect
                          </button>
                        </div>
                        <button
                          className={s.deskEntry}
                          onClick={() => open("desk")}
                        >
                          <BookOpen size={14} />
                          <span>
                            Open problem desk
                            <small>
                              {latestThread ||
                                "Leave a thought for your next session."}
                            </small>
                          </span>
                          <ChevronRight size={13} />
                        </button>
                        <button
                          className={s.askTutor}
                          onClick={() => open("hint")}
                        >
                          <Lightbulb size={13} /> Ask Tutor{" "}
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                    {scene === "desk" && (
                      <ProblemDesk
                        problemTitle="Watermelon"
                        elapsed={clock}
                        paused={!running}
                        items={items}
                        threadDraft={threadDraft}
                        editThread={editThread}
                        onThreadDraftChange={setThreadDraft}
                        onEditThreadChange={setEditThread}
                        onSave={saveItem}
                        onRemove={async (id) => {
                          if (
                            id === "return-story-thought" ||
                            id === "return-story-code"
                          ) {
                            setStoryPlaying(false);
                            setStoryPhase(1);
                          }
                          setItems((value) =>
                            value.filter((item) => item.id !== id),
                          );
                          setNotice("Removed from this preview.");
                          return true;
                        }}
                        onResume={
                          !running
                            ? () => {
                                setRunning(true);
                                open("focus");
                              }
                            : undefined
                        }
                        onOpenProblem={() => {
                          openContext("statement");
                          setNotice(
                            "The example statement is open in the workspace.",
                          );
                        }}
                        onOpenSolution={() => {
                          openContext("code");
                          setNotice(
                            "The sample solution is open in the workspace.",
                          );
                        }}
                        onToggleHint={() => open("hint")}
                        onToggleIdea={() => open("idea")}
                      />
                    )}
                    {scene === "idea" && (
                      <DeskIdeaCard
                        review={sampleReview}
                        explanation={explanation}
                        outline={outline}
                        selectedAssumption={selected}
                        includeStatement={includeStatement}
                        includeCode={includeCode}
                        challenge={challenged ? sampleChallenge : null}
                        challengedAssumption={
                          challenged ? sampleOutline.assumptions[0] : undefined
                        }
                        pending={null}
                        onExplanationChange={setExplanation}
                        onOutlineChange={(value) => {
                          setOutline(value);
                          setOutlineKept(false);
                        }}
                        onReviseExplanation={() => setOutline(null)}
                        onTryAnother={() => setChallenged(false)}
                        onSelectAssumption={setSelected}
                        onIncludeStatementChange={setIncludeStatement}
                        onIncludeCodeChange={setIncludeCode}
                        onOutline={() => {
                          setOutline({
                            ...sampleOutline,
                            approach: explanation,
                            assumptions: [...sampleOutline.assumptions],
                          });
                          setSelected(null);
                        }}
                        onChallenge={() => setChallenged(true)}
                        onKeepOutline={() => {
                          if (outline) {
                            void saveItem({
                              kind: "hypothesis",
                              text: outline.approach,
                            });
                            setOutlineKept(true);
                          }
                        }}
                        outlineKept={outlineKept}
                        onKeepChallenge={() =>
                          keepAsThread(
                            "Test the smallest even weight: 2. Both parts must be positive and even.",
                          )
                        }
                        onChallengeVisible={() => {}}
                        onStop={() => {}}
                        onClose={() => open("desk")}
                        onOpenTutor={() => open("hint")}
                        onRefresh={() =>
                          setNotice("This is the prepared Watermelon example.")
                        }
                        verification={
                          <div className={s.caseCard}>
                            <span>ILLUSTRATED CASE · NOT EXECUTED</span>
                            <div>
                              <span>
                                input<b>2</b>
                              </span>
                              <span>
                                expected<b>NO</b>
                              </span>
                              <span>
                                initial idea<b>YES</b>
                              </span>
                            </div>
                            <p>
                              1 + 1 uses odd parts. 2 + 0 uses a zero part.
                              Neither is a valid split.
                            </p>
                          </div>
                        }
                      />
                    )}
                    {scene === "hint" && (
                      <DeskHintCard
                        review={sampleReview}
                        question="Give me one small hint without the solution."
                        hypothesis={
                          items
                            .filter((item) => item.kind === "hypothesis")
                            .at(-1)?.text || sampleOutline.assumptions[0]
                        }
                        includeHypothesis={includeHypothesis}
                        onIncludeHypothesisChange={setIncludeHypothesis}
                        error=""
                        loading={false}
                        locked={false}
                        running={false}
                        turn={hintShown ? sampleHint : null}
                        onSend={() => setHintShown(true)}
                        onStop={() => {}}
                        onClose={() => open("desk")}
                        onOpenTutor={() => open("idea")}
                        onLeaveThread={() => keepAsThread("")}
                        onKeep={keepAsThread}
                        onOpenLink={() => {}}
                        onExpose={() => {}}
                        onRefresh={() =>
                          setNotice("This is a prepared sample hint.")
                        }
                      />
                    )}
                    {scene === "reflect" && (
                      <div className={s.reflectionView}>
                        <span className="eyebrow">THE PART THAT STAYS</span>
                        <h4>
                          How did
                          <br />
                          <em>you get here?</em>
                        </h4>
                        <p>Your reflection gives this session its meaning.</p>
                        {reflection ? (
                          <div className={s.savedReflection} role="status">
                            <Check size={22} />
                            <h5>Reflection kept.</h5>
                            {onReflection && (
                              <a
                                onClick={
                                  onOpenWorkspace
                                    ? (event) => {
                                        event.preventDefault();
                                        onOpenWorkspace();
                                      }
                                    : undefined
                                }
                                className={s.notebookLink}
                                href="#your-learning"
                              >
                                See it in your notebook <ArrowRight size={13} />
                              </a>
                            )}
                            <span>
                              {reflection.outcome} · {clock}
                            </span>
                            <blockquote>
                              {reflection.takeaway ||
                                "A practice session to build on."}
                            </blockquote>
                            <button
                              className="button"
                              onClick={() => open("recall")}
                            >
                              Try a recall <ArrowRight size={14} />
                            </button>
                            <button
                              className={s.textButton}
                              onClick={() => setReflection(null)}
                            >
                              Edit reflection
                            </button>
                          </div>
                        ) : (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              if (!outcome) return;
                              const saved = {
                                outcome,
                                takeaway: takeaway.trim(),
                              };
                              setRunning(false);
                              setReflection(saved);
                              setReflectionRevision((value) => value + 1);
                              onReflection?.(saved);
                              react("bookmark");
                              setNotice("Reflection saved in this preview.");
                            }}
                          >
                            <fieldset>
                              <legend>How did this attempt go?</legend>
                              <div className={s.outcomes}>
                                {outcomes.map((item, index) => (
                                  <button
                                    type="button"
                                    key={item}
                                    aria-pressed={outcome === item}
                                    onClick={() => setOutcome(item)}
                                  >
                                    <span>
                                      {outcome === item ? (
                                        <Check size={12} />
                                      ) : (
                                        `0${index + 1}`
                                      )}
                                    </span>
                                    {item}
                                  </button>
                                ))}
                              </div>
                            </fieldset>
                            <label className={s.field}>
                              One thing to carry forward
                              <textarea
                                value={takeaway}
                                onChange={(event) =>
                                  setTakeaway(event.target.value)
                                }
                                maxLength={300}
                                rows={3}
                                placeholder="Next time, I’ll remember…"
                              />
                            </label>
                            <button
                              className="button"
                              type="submit"
                              disabled={!outcome}
                            >
                              Save sample reflection <Check size={14} />
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                    {scene === "recall" && (
                      <div className={s.reflectionView}>
                        <span className="eyebrow">A SMALL RETURN</span>
                        <h4>
                          What do
                          <br />
                          <em>you remember?</em>
                        </h4>
                        <p>
                          Explain the condition for two positive even parts
                          before opening your earlier notes.
                        </p>
                        {recallSaved ? (
                          <div className={s.savedReflection} role="status">
                            <Check size={22} />
                            <h5>Recall recorded.</h5>
                            <p>{recallOutcome}</p>
                            <blockquote>{recall}</blockquote>
                            <button
                              className="button"
                              onClick={() => {
                                setRecallSaved(false);
                                setRecall("");
                                setMemoryOpen(false);
                              }}
                            >
                              Try again <RotateCcw size={13} />
                            </button>
                          </div>
                        ) : (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              setRecallSaved(true);
                              react("bookmark");
                              setNotice("Sample recall recorded.");
                            }}
                          >
                            <label className={s.field}>
                              Your explanation
                              <textarea
                                value={recall}
                                onChange={(event) =>
                                  setRecall(event.target.value)
                                }
                                maxLength={1000}
                                rows={4}
                                placeholder="The key condition was…"
                                required
                              />
                            </label>
                            <label className={s.field}>
                              How did recall feel?
                              <select
                                value={recallOutcome}
                                onChange={(event) =>
                                  setRecallOutcome(event.target.value)
                                }
                              >
                                <option>Recalled independently</option>
                                <option>Needed a cue</option>
                                <option>Could not recall yet</option>
                              </select>
                            </label>
                            <button
                              className="button"
                              disabled={!recall.trim()}
                            >
                              Save sample recall <Check size={14} />
                            </button>
                            <button
                              className={s.textButton}
                              type="button"
                              onClick={() => setMemoryOpen(!memoryOpen)}
                            >
                              <BookOpen size={13} />
                              {memoryOpen
                                ? "Close my memory"
                                : "Open my memory"}
                            </button>
                            {memoryOpen && (
                              <blockquote className={s.memory}>
                                {reflection?.takeaway ||
                                  latestThread ||
                                  "No thought saved in this preview yet."}
                              </blockquote>
                            )}
                          </form>
                        )}
                      </div>
                    )}
                    {scene === "appearance" && (
                      <RibbonStudio
                        saved={ribbonOptions}
                        reducedMotion={reducedMotion}
                        savedMessage="Appearance saved for this preview."
                        onSave={async (value) => {
                          setRibbonOptions(value);
                          setNotice("Appearance updated for this preview.");
                        }}
                        onRehearse={() => open("focus")}
                      />
                    )}
                    {!compact &&
                      guidedMode &&
                      step === 4 &&
                      completed.every(Boolean) && (
                        <div className={s.journeyDone}>
                          <Check size={20} />
                          <strong>You’ve kept the whole thread.</strong>
                          <p>
                            Code, your thinking, a takeaway, and a recall. That
                            is one connected practice session.
                          </p>
                          <dl className={s.sessionSummary}>
                            <dt>Selected code</dt>
                            <dd>watermelon.cpp · lines 7–11</dd>
                            <dt>Your first thought</dt>
                            <dd>
                              {
                                items.find(
                                  (item) =>
                                    item.kind === "thread" &&
                                    item.id !== "sample-thread",
                                )?.text
                              }
                            </dd>
                            <dt>Your takeaway</dt>
                            <dd>
                              {reflection?.takeaway ||
                                "A session kept without a written takeaway."}
                            </dd>
                            <dt>Your recall</dt>
                            <dd>
                              {recall}
                              <small>{recallOutcome}</small>
                            </dd>
                          </dl>
                          {downloadUrl ? (
                            <a
                              className={s.completionAction}
                              href={downloadUrl}
                            >
                              Download Forma for Mac <ArrowRight size={16} />
                            </a>
                          ) : (
                            <Link
                              className={s.completionAction}
                              href="/download"
                            >
                              Mac release details <ArrowRight size={16} />
                            </Link>
                          )}
                          {onReflection && (
                            <a
                              href="#your-learning"
                              onClick={
                                onOpenWorkspace
                                  ? (event) => {
                                      event.preventDefault();
                                      onOpenWorkspace();
                                    }
                                  : undefined
                              }
                            >
                              See your learning record <ArrowRight size={14} />
                            </a>
                          )}
                        </div>
                      )}
                  </div>
                  {!compact && guidedMode && step < 4 && (
                    <div className={s.journeyNavigation}>
                      <ContinuePractice
                        step={step}
                        ready={
                          completed[step] && !(scene === "desk" && editThread)
                        }
                        onNext={() => goStep(step + 1)}
                      />
                    </div>
                  )}
                  <div className={s.nativeFooter}>
                    <span>
                      <i />
                      In-memory preview
                    </span>
                    <span>Nothing sent or installed</span>
                  </div>
                </div>
              )}
              {compact && collapsed && storyPhase === 3 && (
                <div className={s.foldedThread} aria-hidden="true">
                  <span>WATERMELON · 4A</span>
                  <strong>A thought, kept.</strong>
                  <i />
                </div>
              )}
              <div
                className={s.dock}
                data-folded={ribbonOptions.shape === "fold"}
                data-edge={ribbonOptions.edge}
              >
                <button
                  className={s.dockOpen}
                  aria-label={collapsed ? "Open companion" : "Fold companion"}
                  aria-expanded={!collapsed}
                  onClick={() => foldCompanion(!collapsed)}
                >
                  <DesktopRibbonMark
                    size={34}
                    focusing={running}
                    feedback={feedback}
                    tucked={
                      collapsed && ribbonOptions.edge !== "free"
                        ? ribbonOptions.edge
                        : undefined
                    }
                  />
                  {ribbonOptions.shape !== "fold" && <time>{clock}</time>}
                </button>
                {ribbonOptions.shape !== "fold" && (
                  <button
                    aria-label={
                      running ? "Pause sample timer" : "Resume sample timer"
                    }
                    onClick={() => setRunning(!running)}
                  >
                    {running ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                )}
              </div>
              {collapsed && (
                <button
                  className={s.unfoldHint}
                  onClick={() => foldCompanion(false)}
                >
                  Click the Ribbon to pick up the thread{" "}
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className={s.statusBar}>
          <span role="status">
            {notice ||
              "Try any control. This sample notebook resets on reload."}
          </span>
          <span>Sample context · prepared Tutor responses</span>
        </div>
      </div>
      <p className={s.demoDisclosure}>
        The Problem Desk, idea review, hint card, Ribbon mark, and appearance
        controls are the components used in the desktop app. This preview uses
        example data and prepared Tutor responses; it does not connect to your
        editor, call AI, or save a notebook.
      </p>
    </div>
  );
}
