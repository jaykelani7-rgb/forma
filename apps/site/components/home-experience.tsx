"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Code2,
  Feather,
  Flag,
  Route,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { DesktopRibbonMark } from "../../desktop/renderer/DesktopRibbonMark";
import type {
  SampleReflection,
  SamplePractice,
  TourScene,
} from "./companion-sample";
import { emptyWorkspacePlan, type WorkspaceView } from "./workspace-plan";
import workspaceImage from "../assets/forma-workspace.png";
import s from "./home-experience.module.css";
const WorkspacePreview = dynamic(
  () => import("./workspace-preview").then((module) => module.WorkspacePreview),
  { loading: () => <p role="status">Opening the sample workspace…</p> },
);
const CompanionPlayground = dynamic(
  () =>
    import("./companion-playground").then(
      (module) => module.CompanionPlayground,
    ),
  {
    loading: () => (
      <div className={s.loadingCompanion} role="status">
        <DesktopRibbonMark size={42} />
        <p>Opening your companion…</p>
      </div>
    ),
  },
);
export function HomeExperience({
  downloadUrl,
}: {
  downloadUrl: string | null;
}) {
  const [workspacePlan, setWorkspacePlan] = useState(emptyWorkspacePlan);
  const [practice, setPractice] = useState<SamplePractice | null>(null);
  const [workspaceRequest, setWorkspaceRequest] = useState<{
    view: WorkspaceView;
    id: number;
  } | null>(null);
  const workspaceTrigger = useRef<HTMLButtonElement>(null);
  const workspaceReturnTarget = useRef<HTMLElement | null>(null);
  function openWorkspace(view: WorkspaceView = "Today", trigger?: HTMLElement) {
    if (trigger) workspaceReturnTarget.current = trigger;
    else if (!workspaceRequest)
      workspaceReturnTarget.current = workspaceTrigger.current;
    setWorkspaceRequest((value) => ({ view, id: (value?.id || 0) + 1 }));
    requestAnimationFrame(() =>
      document
        .getElementById("workspace-demo")
        ?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  }
  function reopenProblem(scene: TourScene, startTimer = false) {
    explore(scene, startTimer);
    requestAnimationFrame(() => {
      document
        .getElementById("companion-playground")
        ?.scrollIntoView({ block: "start", behavior: "instant" });
      document
        .querySelector<HTMLElement>(
          '#companion-playground [aria-selected="true"]',
        )
        ?.focus({ preventScroll: true });
    });
  }
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [experienceOpen, setExperienceOpen] = useState(false);
  const [experienceLoaded, setExperienceLoaded] = useState(false);
  const heroAction = useRef<HTMLButtonElement>(null);
  const storyEntry = useRef<HTMLButtonElement>(null);
  const storyOpener = useRef<HTMLElement | null>(null);
  const experienceHeading = useRef<HTMLHeadingElement>(null);
  function showStory(trigger?: HTMLElement) {
    if (trigger) storyOpener.current = trigger;
    else if (!experienceOpen) storyOpener.current = heroAction.current;
    setExperienceLoaded(true);
    setExperienceOpen(true);
    requestAnimationFrame(() => {
      document
        .getElementById("try-forma")
        ?.scrollIntoView({ block: "start", behavior: "instant" });
      experienceHeading.current?.focus({ preventScroll: true });
    });
  }
  function closeStory() {
    setExperienceOpen(false);
    requestAnimationFrame(() => {
      const opener = storyOpener.current?.isConnected
        ? storyOpener.current
        : storyEntry.current || heroAction.current;
      opener?.focus();
    });
  }
  const [startRequest, setStartRequest] = useState(0);
  const [launch, setLaunch] = useState<{
    scene: TourScene;
    id: number;
    startTimer?: boolean;
  }>();
  const [savedReflection, setSavedReflection] =
    useState<SampleReflection | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          entry.target.setAttribute(
            "data-visible",
            String(entry.isIntersecting),
          );
          if (entry.isIntersecting)
            entry.target.setAttribute("data-revealed", "true");
        }),
      { threshold: 0.06 },
    );
    element
      .querySelectorAll("[data-reveal], [data-ambient]")
      .forEach((item) => observer.observe(item));
    element.dataset.enhanced = "true";
    const visibility = () => {
      element.dataset.hidden = String(document.hidden);
    };
    const hash = () => {
      if (location.hash === "#try-forma") {
        setExperienceLoaded(true);
        setExperienceOpen(true);
        setExpanded(true);
      }
    };
    const followAnchor = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a");
      if (
        anchor instanceof HTMLAnchorElement &&
        anchor.hash === "#try-forma" &&
        anchor.pathname === location.pathname
      ) {
        setExperienceLoaded(true);
        setExperienceOpen(true);
        setExpanded(true);
        storyOpener.current = anchor;
      }
    };
    visibility();
    hash();
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("click", followAnchor);
    window.addEventListener("hashchange", hash);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("click", followAnchor);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  function explore(scene: TourScene, startTimer = false) {
    showStory();
    setExpanded(true);
    setLaunch((value) => ({ scene, id: (value?.id ?? 0) + 1, startTimer }));
  }
  function begin() {
    showStory();
    setExpanded(true);
    setStartRequest((value) => value + 1);
  }
  return (
    <div ref={root} className={s.home}>
      <section className={s.hero} aria-labelledby="mac-home-title">
        <div className={s.landscape} aria-hidden="true" />
        <div className={s.heroCopy}>
          <p className={s.eyebrow}>A COMPANION FOR COMPETITIVE PROGRAMMING</p>
          <h1 id="mac-home-title">
            Your thinking.
            <br />
            <em>Beside your code.</em>
          </h1>
          <p className={s.heroDescription}>
            A Mac workspace and floating companion that help you keep your next
            thought beside its code.
          </p>
          <button
            ref={heroAction}
            className={s.primary}
            onClick={(event) => showStory(event.currentTarget)}
            aria-expanded={experienceOpen}
            aria-controls="interactive-story"
          >
            See Forma in action <ArrowDown size={17} />
          </button>
        </div>
        <a className={s.scrollHint} href="#try-forma-intro">
          A thought worth coming back to <ArrowDown size={14} />
        </a>
      </section>
      <section
        id="try-forma"
        className={s.experience}
        data-open={experienceOpen}
        data-expanded={expanded}
        aria-labelledby="experience-title"
      >
        <div id="try-forma-intro" className={s.experienceIntro}>
          <p className={s.chapterLabel}>01 / KEEP THE THREAD</p>
          <h2 id="experience-title" ref={experienceHeading} tabIndex={-1}>
            Step away.
            <br />
            <em>Keep your place.</em>
          </h2>
          <p>
            Leave a thought beside your code. Fold the Ribbon away. Come back to
            the same words, ready for your next step.
          </p>
          {!experienceOpen ? (
            <>
              <button
                ref={storyEntry}
                className={s.storyLaunch}
                onClick={(event) => showStory(event.currentTarget)}
                aria-expanded={false}
                aria-controls="interactive-story"
              >
                {experienceLoaded
                  ? "Continue exploring"
                  : "Open the interactive story"}
                <ArrowRight size={17} />
              </button>
              <small>A browser sample. No install or API key needed.</small>
            </>
          ) : (
            <button
              className={s.storyClose}
              onClick={closeStory}
              aria-controls="interactive-story"
            >
              <X size={16} /> Close story
            </button>
          )}
        </div>
        {!experienceOpen && (
          <div className={s.storyStill}>
            <div className={s.keptNote}>
              <span>
                {practice?.thought
                  ? "YOUR THOUGHT · KEPT IN THIS PREVIEW"
                  : "AN EXAMPLE THOUGHT · WATERMELON"}
              </span>
              <blockquote>
                {practice?.thought ||
                  "Try the smallest even weight before trusting the pattern."}
              </blockquote>
              <span className={s.noteSeam} aria-hidden="true" />
            </div>
            <div className={s.restingRibbon} aria-hidden="true">
              <DesktopRibbonMark size={35} />
              <span>Your place, kept.</span>
            </div>
          </div>
        )}
        <div
          id="interactive-story"
          className={s.liveStage}
          hidden={!experienceOpen}
        >
          {experienceLoaded && (
            <CompanionPlayground
              active={experienceOpen}
              compact={!expanded}
              guided
              onExpand={() => setExpanded(true)}
              startRequest={startRequest}
              launch={launch}
              onReflection={setSavedReflection}
              onPracticeChange={setPractice}
              onPreviewReset={() => setWorkspacePlan(emptyWorkspacePlan)}
              onOpenWorkspace={() => openWorkspace("Journal")}
              downloadUrl={downloadUrl}
            />
          )}
        </div>
        {experienceOpen && (
          <a href="#workspace" className={s.nextChapter}>
            Meet the whole workspace <ArrowDown size={16} />
          </a>
        )}
      </section>
      <div className={s.paper}>
        <section
          id="workspace"
          className={s.workspace}
          aria-labelledby="workspace-title"
          data-reveal
        >
          <div className={s.sectionIntro}>
            <p className={s.chapterLabel}>
              THE COMPANION KEEPS YOUR PLACE. THE WORKSPACE KEEPS THE BIGGER
              PICTURE.
            </p>
            <h2 id="workspace-title">Make room for your next problem.</h2>
            <p>
              Choose a direction, revisit a contest, or find a thought you kept.
              Every practice belongs to the same notebook.
            </p>
          </div>
          <div
            className={s.discovery}
            aria-label="Explore practice paths"
            role="group"
          >
            <button
              onClick={(event) => openWorkspace("Tracks", event.currentTarget)}
            >
              <span className={s.pathSymbol}>
                <Route size={25} />
              </span>
              <span>
                <small>01 / TRACKS</small>
                <strong>Find your next practice.</strong>
                <span>Three stages. A direction you can make your own.</span>
              </span>
              <ArrowUpRight size={22} />
            </button>
            <button
              onClick={(event) =>
                openWorkspace("Contests", event.currentTarget)
              }
            >
              <span className={s.pathSymbol}>
                <Flag size={25} />
              </span>
              <span>
                <small>02 / CONTESTS</small>
                <strong>The round ends. Keep learning.</strong>
                <span>Keep a takeaway. Give a missed problem another go.</span>
              </span>
              <ArrowUpRight size={22} />
            </button>
          </div>
          <div id="workspace-demo" className={s.workspaceDemo}>
            {workspaceRequest ? (
              <WorkspacePreview
                practice={practice}
                plan={workspacePlan}
                onPlanChange={setWorkspacePlan}
                request={workspaceRequest}
                onOpenProblem={reopenProblem}
                onClose={() => {
                  setWorkspaceRequest(null);
                  requestAnimationFrame(() =>
                    (workspaceReturnTarget.current?.isConnected
                      ? workspaceReturnTarget.current
                      : workspaceTrigger.current
                    )?.focus(),
                  );
                }}
              />
            ) : (
              <>
                <figure className={s.workspaceFigure}>
                  <div className={s.figureBar}>
                    <span>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>FORMA FOR MAC / TODAY</span>
                    <span>DEMO DATA</span>
                  </div>
                  <Image
                    src={workspaceImage}
                    alt="Actual Forma desktop workspace showing Today’s practice, the problem collection, tracks, contests, and journal."
                    unoptimized
                    sizes="(max-width: 760px) 95vw, 1100px"
                  />
                  <figcaption>
                    The actual desktop workspace, shown with demo records.
                  </figcaption>
                </figure>
                <button
                  ref={workspaceTrigger}
                  className={s.workspaceLaunch}
                  onClick={(event) =>
                    openWorkspace("Today", event.currentTarget)
                  }
                >
                  Explore the sample workspace <ArrowRight size={18} />
                </button>
                <p className={s.workspaceCaption}>
                  Try Today, Practice, Tracks, Contests, and Journal. Your
                  companion’s reflection appears in the same sample notebook.
                </p>
              </>
            )}
          </div>
          <div className={s.productParts}>
            <article>
              <span>01 / YOUR EDITOR</span>
              <Code2 size={23} />
              <h3>Stay with the problem.</h3>
              <p>
                Pair VS Code and choose your practice folders. Explicitly share
                a code selection when you want to keep or discuss it.
              </p>
            </article>
            <article>
              <span>02 / YOUR RIBBON</span>
              <DesktopRibbonMark size={30} />
              <h3>Keep a thought close.</h3>
              <p>
                Time a session, leave a thread, or explore an idea with your
                optional Tutor. Fold the companion away when you want quiet.
              </p>
            </article>
            <article>
              <span>03 / YOUR WORKSPACE</span>
              <BookOpen size={23} />
              <h3>Build on what stayed.</h3>
              <p>
                Return to your plan, reflections, and earlier problems. The
                workspace and Ribbon use the same local notebook.
              </p>
            </article>
          </div>
          <a
            className={s.inkLink}
            href="#try-forma"
            onClick={() => explore("appearance")}
          >
            Make the Ribbon yours
            <ArrowRight size={16} />
          </a>
        </section>
        <section
          id="your-learning"
          className={s.learningSection}
          aria-labelledby="learning-title"
          data-reveal
        >
          <div className={s.learningWindow}>
            <div className={s.learningBar}>
              <DesktopRibbonMark size={26} />
              <span>forma / your learning</span>
              <small>SAMPLE NOTEBOOK</small>
            </div>
            <div className={s.learningBody}>
              <p className={s.chapterLabel}>
                {savedReflection
                  ? "FROM THE SESSION YOU JUST TRIED"
                  : "THIS IS WHERE YOUR TAKEAWAY WILL LAND"}
              </p>
              <h3>
                Watermelon <span>4A</span>
              </h3>
              <div className={s.learningStats}>
                <span>
                  Learning outcome
                  <strong>
                    {savedReflection?.outcome || "Yours to choose"}
                  </strong>
                </span>
                <span>
                  Platform verdict<strong>Recorded separately</strong>
                </span>
              </div>
              <div className={s.learningNote} data-new={!!savedReflection}>
                <span>
                  {savedReflection
                    ? "YOUR OWN WORDS"
                    : "A PLACE FOR YOUR INSIGHT"}
                </span>
                <p>
                  {savedReflection?.takeaway ||
                    (savedReflection
                      ? "A session kept. Add a takeaway whenever you’re ready."
                      : "What will you remember next time?")}
                </p>
              </div>
              <a
                href="#try-forma"
                onClick={() => explore(savedReflection ? "recall" : "reflect")}
                className={s.recallOffer}
              >
                <RotateCcw size={18} />
                <span>
                  <strong>
                    {savedReflection
                      ? "What do you remember?"
                      : "Keep your first takeaway"}
                  </strong>
                  <small>
                    {savedReflection
                      ? "Try recalling before opening your notes."
                      : "Your reflection will appear right here."}
                  </small>
                </span>
                <ArrowRight size={16} />
              </a>
            </div>
          </div>
          <div>
            <p className={s.chapterLabel}>THE THREAD DOESN’T END AT ACCEPTED</p>
            <h2 id="learning-title">
              Practice becomes
              <br />
              <em>something you keep.</em>
            </h2>
            <p>
              A platform verdict tells you whether the solution passed. Your
              reflection records how you got there and what you want to carry
              forward.
            </p>
            <p>
              Write a takeaway in the companion above. It appears here, in your
              own words, ready for a small return.
            </p>
            <a
              className={s.inkLink}
              href="#try-forma"
              onClick={() => explore("reflect")}
            >
              {savedReflection
                ? "Return to your reflection"
                : "Try a reflection"}
              <ArrowRight size={16} />
            </a>
          </div>
        </section>
        <section className={s.ownership} data-reveal>
          <div>
            <ShieldCheck size={22} />
            <h3>Your practice belongs to you.</h3>
            <p>
              The Mac notebook lives locally, with export and backup options.
            </p>
          </div>
          <div>
            <Feather size={22} />
            <h3>Help, when you choose it.</h3>
            <p>
              Notes and tracking work without AI. Tutor uses your own supported
              provider key and the context you choose to share.
            </p>
          </div>
        </section>
        <section
          className={s.faq}
          id="questions"
          aria-labelledby="faq-title"
          data-reveal
        >
          <div>
            <p className={s.chapterLabel}>BEFORE YOU SETTLE IN</p>
            <h2 id="faq-title">Before your first session.</h2>
          </div>
          <div>
            <details>
              <summary>
                What is Forma, exactly?<span>+</span>
              </summary>
              <p>
                Forma is a Mac practice workspace with a separate floating
                Ribbon companion. It brings together session timing,
                problem-specific notes, optional AI tutoring, reflections, and
                recall. Both windows use the same local notebook.
              </p>
            </details>
            <details>
              <summary>
                Is this the real companion?<span>+</span>
              </summary>
              <p>
                The journey reuses the desktop Problem Desk, idea-review and
                hint cards, Ribbon mark, and appearance controls. It uses sample
                data and prepared Tutor replies. Your entries stay in memory for
                this visit and reset on reload.
              </p>
            </details>
            <details>
              <summary>
                Do I need an AI subscription?<span>+</span>
              </summary>
              <p>
                Tracking, notes, reflection, and recall work without AI. Tutor
                uses your own supported Gemini or OpenAI API key in the Mac app.
                Provider usage follows your provider account and billing; Forma
                does not include a shared AI plan.
              </p>
            </details>
            <details>
              <summary>
                How does it work with my editor?<span>+</span>
              </summary>
              <p>
                Pair the Forma VS Code extension, approve practice folders, and
                opt in to CPH recognition. You can pin code selections to a
                Problem Desk or share them with Tutor. Optional Chrome capture
                supplies Codeforces statement context. The website does not
                connect to your local tools.
              </p>
            </details>
            <details>
              <summary>
                Where does my practice data live?<span>+</span>
              </summary>
              <p>
                The Mac notebook is stored locally and can be exported or backed
                up. When you use Tutor, the context you choose to share goes to
                your selected AI provider.
              </p>
            </details>
            <details>
              <summary>
                Can I download Forma now?<span>+</span>
              </summary>
              <p>
                {downloadUrl
                  ? "The Apple silicon installer is available on the download page, with installation steps."
                  : "The public Mac installer is not published yet. You can explore the interactive browser sample now."}{" "}
                <Link href="/download">
                  View release details
                  <ArrowUpRight size={13} />
                </Link>
              </p>
            </details>
          </div>
        </section>
      </div>
      <section className={s.closing}>
        <DesktopRibbonMark size={52} />
        <p className={s.eyebrow}>YOUR NEXT PROBLEM IS WAITING</p>
        <h2>
          Bring your curiosity.
          <br />
          <em>Keep the thread.</em>
        </h2>
        <button className={s.primary} onClick={begin}>
          {expanded ? "Continue your practice" : "Try a problem with Forma"}
          <ArrowRight size={17} />
        </button>
        <p>Built for competitive programmers. Made for your own pace.</p>
      </section>
    </div>
  );
}
