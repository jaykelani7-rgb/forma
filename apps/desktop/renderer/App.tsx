import { useCallback, useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Code2, Ellipsis, Feather, FileCode2, Globe2, Link2, LoaderCircle, Mic, Moon, Pause, Play, Plus, Search, Settings2, ShieldCheck, Sun, X } from "lucide-react";
import { TutorPanel, type TutorActivity } from "./TutorPanel";
import { useThoughtVoice } from "./thought-voice";
import { ThoughtTakeRecovery } from "./ThoughtTakeRecovery";
import { ThoughtShortcutSettings } from "./ThoughtShortcutSettings";
import { PaletteShortcutSettings } from "./PaletteShortcutSettings";
import { CommandPaletteFlow, type PaletteCommand } from "./CommandPaletteFlow";
import { ProblemDesk } from "./ProblemDesk";
import { DeskHintFlow } from "./DeskHintFlow";
import { DeskIdeaFlow, emptyDeskIdeaDraft, type DeskIdeaDraft } from "./DeskIdeaFlow";
import { SessionHandoffPanel } from "./SessionHandoffPanel";
import { DesktopRibbonMark, type RibbonFeedback } from "./DesktopRibbonMark";
import { DEFAULT_PALETTE_SHORTCUT, DEFAULT_THOUGHT_SHORTCUT } from "../main/preferences";
import { SetupPanel } from "./SetupPanel";
import { BackupPanel } from "./BackupPanel";
import { RibbonStudio } from "../../../packages/ribbon/RibbonStudio";
import { RibbonRehearsal } from "../../../packages/ribbon/RibbonRehearsal";
import { defaultRibbon } from "../../../packages/ribbon/options";
import "../../../packages/ribbon/studio.css";
import { RibbonMark } from "../../../packages/ribbon/RibbonMark";
import { FENN_STATES, type FennState } from "../../../packages/pet-ui/src";
import { getCompanionView } from "../../../packages/core/src";
import { normalizeCodeforcesIdentity } from "../../../packages/core/src/codeforces-identity";
import { activeSolutionBinding } from "../../../packages/core/src/active-binding";
import { capturePreconditions, freezeCaptureTarget, type CaptureTarget } from "../../../packages/core/src/capture-target";
import { addDays, localDate, type Outcome } from "../../../src/lib/model";
import type { CompanionCommand, DeskEntry } from "../../../packages/contracts/src";
import { connectBridge, previewMode, type CompanionSnapshot, type FormaBridge } from "./api";

type Panel = "rehearsal" | "tutor" | "today" | "home" | "attach" | "thought" | "desk" | "reflect" | "memory" | "recall" | "settings" | "handoff";
type IconType = typeof ArrowRight;
const outcomeLabels: Record<Outcome, string> = { independent: "Independent", hint: "With a hint", editorial: "Editorial", unsolved: "Not solved yet" };
const stateLabels: Record<FennState, string> = { idle: "Ready when you are", focus: "A little room to focus", "context-ready": "Problem attached", "tests-running": "Local tests running", "local-tests-passed": "Local tests passed", "submission-pending": "Submission pending", accepted: "Accepted on Codeforces", "needs-attention": "Needs your attention", "reflection-saved": "Reflection saved locally", "recall-available": "A thought to revisit", paused: "Taking a quiet moment", offline: "Working locally" };
const tutorStates: Record<Exclude<TutorActivity,"idle">,FennState> = {listening:"focus",transcribing:"focus",thinking:"focus",responding:"context-ready",speaking:"context-ready",interrupted:"paused",error:"needs-attention"};
const tutorLabels: Record<Exclude<TutorActivity,"idle">,string> = {listening:"Listening · microphone on",transcribing:"Turning your recording into a draft",thinking:"Thinking through your question",responding:"Writing a response",speaking:"Speaking · AI-generated voice",interrupted:"Response stopped · draft kept",error:"Tutor needs your attention"};
function IconButton({ icon: Icon, label, onClick, active = false }: { icon: IconType; label: string; onClick: () => void; active?: boolean }) { return <button className={`icon-button ${active ? "is-active" : ""}`} type="button" aria-label={label} title={label} onClick={onClick}><Icon size={15} strokeWidth={1.6}/></button>; }
function Button({ children, onClick, type = "button", disabled = false, secondary = false, icon: Icon }: { children: ReactNode; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; secondary?: boolean; icon?: IconType }) { return <button className={`button ${secondary ? "button--secondary" : ""}`} type={type} disabled={disabled} onClick={onClick}>{children}{Icon && <Icon size={15} strokeWidth={1.7}/>}</button>; }
function Form({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) { return <form onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(); }}>{children}</form>; }
function duration(ms: number) { const minutes = Math.floor(Math.max(0, ms) / 60000); const seconds = Math.floor(Math.max(0, ms) / 1000) % 60; return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "That action could not be completed. Your existing notebook is safe."; }
function usePageVisible() { const [visible, setVisible] = useState(!document.hidden); useEffect(() => { const change = () => setVisible(!document.hidden); document.addEventListener("visibilitychange", change); return () => document.removeEventListener("visibilitychange", change); }, []); return visible; }

export function App() {
  const [bridge, setBridge] = useState<FormaBridge | null>(null);
  const [snapshot, setSnapshot] = useState<CompanionSnapshot | null>(null);
  const [tutorActivity,setTutorActivity] = useState<TutorActivity>("idle");
  const [tutorRequest,setTutorRequest] = useState<{id:number;conversationId?:string;settings?:boolean}>();
  const rehearsalReturn = useRef<Panel>("home");
  const [panel, setPanel] = useState<Panel>("home");
  const [expanded, setExpanded] = useState(previewMode);
  const [palette, setPalette] = useState<{ restoreCompact: boolean } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [problemTitle, setProblemTitle] = useState("");
  const [thought, setThought] = useState("");
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [threadEditorProblem, setThreadEditorProblem] = useState<string | null>(null);
  const [deskAssist, setDeskAssist] = useState<{ scope: string; kind: "hint" | "idea" } | null>(null);
  const [ideaDraft, setIdeaDraft] = useState<{ scope: string; value: DeskIdeaDraft } | null>(null);
  const [returnFromTutorToDesk, setReturnFromTutorToDesk] = useState(false);
  const hintButton = useRef<HTMLButtonElement>(null);
  const ideaButton = useRef<HTMLButtonElement>(null);
  const [ribbonFeedback, setRibbonFeedback] = useState<(RibbonFeedback & { problemId: string | null }) | null>(null);
  const [takeaway, setTakeaway] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [recallActivity, setRecallActivity] = useState<"explain" | "complexity">("explain");
  const [recallResponse, setRecallResponse] = useState("");
  const [recallOutcome, setRecallOutcome] = useState<"independent" | "cue" | "unrecalled">("independent");
  const [handle, setHandle] = useState("");
  const [shortcut, setShortcut] = useState("Control+Option+F");
  const [pairing, setPairing] = useState<{ credential: string; endpoint: string } | null>(null);
  const [more, setMore] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [motionPreference, setMotionPreference] = useState(matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [darkPreference, setDarkPreference] = useState(matchMedia("(prefers-color-scheme: dark)").matches);
  const [reaction, setReaction] = useState<FennState | null>(null);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTarget = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const panelRequestId = useRef<number | null>(null);
  const lastThoughtShortcutPress = useRef<number | undefined>(undefined);
  const lastPaletteShortcutPress = useRef<number | undefined>(undefined);
  const pendingCommand = useRef<{ signature: string; command: CompanionCommand } | null>(null);
  const [draftTargets, setDraftTargets] = useState<Partial<Record<"thought" | "reflect" | "recall", CaptureTarget>>>({});
  const visible = usePageVisible();
  const search = new URLSearchParams(location.search);
  const gallery = previewMode && search.get("gallery") === "1";
  useEffect(() => bridge?.subscribeTutor?.(event => {
    if (event.kind === "recovery") {
      setIdeaDraft(null);
      setDeskAssist(null);
    }
  }), [bridge]);
  useEffect(() => { let cancelled = false; let unsubscribe: (() => void) | undefined; const receive = (next: CompanionSnapshot) => { const scope = JSON.stringify([next.state.problemId, next.data.session?.id ?? null]); setDeskAssist(current => current?.scope === scope ? current : null); setIdeaDraft(current => current?.scope === scope ? current : null); setSnapshot(next); const nextExpanded = next.presentation?.expanded ?? previewMode; setExpanded(nextExpanded); if (!nextExpanded) setPalette(null); const request = next.presentation?.panelRequest; if (request && request.id !== panelRequestId.current) { panelRequestId.current = request.id; setPalette(null); setDeskAssist(null); setPanel(request.panel); if(request.panel==="tutor")setTutorRequest({id:request.id,conversationId:request.conversationId}); } }; connectBridge().then(async (api) => { const initial = await api.getSnapshot(); if (cancelled) return; setBridge(api); receive(initial); setHandle(initial.state.handle ?? ""); setShortcut(initial.preferences.shortcut ?? "Control+Option+F"); unsubscribe = api.subscribe(receive); }).catch((reason) => { if (!cancelled) setError(errorMessage(reason)); }); return () => { cancelled = true; unsubscribe?.(); }; }, []);
  useEffect(() => { if (!bridge || previewMode) return; let last: boolean | null = null; const updateHitbox = (event: PointerEvent) => { const interactive = !!(event.target instanceof Element && event.target.closest("button,input,textarea,select,a,[data-interactive],.card,.drag-handle")); if (interactive === last) return; last = interactive; void bridge.ui("hitbox", interactive).catch(() => { /* The menu bar remains available for recovery. */ }); }; document.addEventListener("pointermove", updateHitbox); return () => document.removeEventListener("pointermove", updateHitbox); }, [bridge]);
  useEffect(() => { const motion = matchMedia("(prefers-reduced-motion: reduce)"); const dark = matchMedia("(prefers-color-scheme: dark)"); const onMotion = () => setMotionPreference(motion.matches); const onDark = () => setDarkPreference(dark.matches); motion.addEventListener("change", onMotion); dark.addEventListener("change", onDark); return () => { motion.removeEventListener("change", onMotion); dark.removeEventListener("change", onDark); }; }, []);
  useEffect(() => { if (!visible || !snapshot?.data.session?.runningSince) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [visible, snapshot?.data.session?.runningSince]);
  useEffect(() => {
    if (!visible) return;
    const midnight = new Date(); midnight.setDate(midnight.getDate() + 1); midnight.setHours(0, 0, 0, 100);
    const snooze = snapshot?.preferences.snoozedUntil ? Date.parse(snapshot.preferences.snoozedUntil) : Infinity;
    const next = Math.min(midnight.getTime(), snooze > Date.now() ? snooze : Infinity);
    const timer = setTimeout(() => setNow(Date.now()), Math.max(100, next - Date.now()));
    return () => clearTimeout(timer);
  }, [visible, snapshot?.preferences.snoozedUntil, now]);
  useEffect(() => { focusTarget.current?.scrollTo({ top: 0 }); if (panel !== "home" && !focusTarget.current?.contains(document.activeElement)) focusTarget.current?.focus(); }, [panel]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        if (!snapshot || gallery || panel === "rehearsal") return;
        event.preventDefault();
        if (!event.repeat && !palette) openPalette();
        return;
      }
      if (event.key !== "Escape" || palette) return;
      if (showDeskIdea) closeDeskAssist("idea");
      else if (showDeskHint) closeDeskAssist("hint");
      else if (panel === "tutor" && returnFromTutorToDesk) openPanel("desk");
      else if (panel !== "home") { setDeskAssist(null); setPanel("home"); }
      else void toggleExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => () => { if (reactionTimer.current) clearTimeout(reactionTimer.current); }, []);

  const theme = previewMode && search.get("theme") === "ink" ? "ink" : snapshot?.preferences.theme === "system" ? (darkPreference ? "ink" : "light") : snapshot?.preferences.theme ?? "light";
  const reducedMotion = motionPreference || !!snapshot?.preferences.reducedMotion || snapshot?.preferences.ribbon?.motion === "still";
  const view = snapshot ? getCompanionView(snapshot.data, snapshot.state, now) : null;
  const today = snapshot?.today;
  const verdictNotice = snapshot?.presentation?.verdict;
  const verdictNoticeId=verdictNotice?.id;
  useEffect(()=>{if(!verdictNoticeId||!bridge)return;const timer=setTimeout(()=>void bridge.ui("attention-dismiss",verdictNoticeId),8000);return()=>clearTimeout(timer);},[verdictNoticeId,bridge]);
  const recognition = snapshot?.presentation?.recognition;
  const recognitionId = recognition?.id, recognitionStatus = recognition?.status;
  useEffect(() => { if (!recognitionId || recognitionStatus !== "recognised" || !bridge) return; const timer = setTimeout(() => { void bridge.ui("recognition-dismiss", recognitionId); }, 8000); return () => clearTimeout(timer); }, [recognitionId, recognitionStatus, bridge]);
  const problem = view?.problem;
  const session = view?.session;
  const deskItems = snapshot?.state.desk?.filter(item => item.problemId === problem?.id) ?? [];
  const latestThread = deskItems.findLast(item => item.kind === "thread");
  const deskScope = problem ? JSON.stringify([problem.id, session?.id ?? null]) : null;
  const changeIdeaDraft = useCallback((patch: Partial<DeskIdeaDraft>) => {
    if (!deskScope) return;
    setIdeaDraft(current => ({
      scope: deskScope,
      value: { ...(current?.scope === deskScope ? current.value : emptyDeskIdeaDraft), ...patch },
    }));
  }, [deskScope]);
  const showDeskAssist = expanded && panel === "desk" && deskAssist?.scope === deskScope;
  const showDeskHint = showDeskAssist && deskAssist?.kind === "hint";
  const showDeskIdea = showDeskAssist && deskAssist?.kind === "idea";
  const editThread = !!problem && threadEditorProblem === problem.id;
  const thoughtVoice = useThoughtVoice(
    window.forma ? bridge : null, expanded && (panel === "thought" || (panel === "desk" && (editThread || showDeskIdea))),
    snapshot?.state.identity, snapshot?.data.session?.id, !reducedMotion,
  );
  const thoughtVoiceBusy = thoughtVoice.phase !== "idle";
  const canDictate = !!window.forma && !!problem && !!snapshot?.state.identity;
  const thoughtLimit = 10_000;
  const thoughtShortcut = snapshot?.preferences.thoughtShortcut === undefined
    ? DEFAULT_THOUGHT_SHORTCUT : snapshot.preferences.thoughtShortcut;
  const paletteShortcut = snapshot?.preferences.paletteShortcut === undefined
    ? DEFAULT_PALETTE_SHORTCUT : snapshot.preferences.paletteShortcut;
  const thoughtTarget = snapshot ? freezeCaptureTarget(snapshot) : undefined;
  const savedThoughtTarget = draftTargets.thought;
  const differentDraft = !!thought.trim() && !!savedThoughtTarget && (
    savedThoughtTarget.problemKey !== thoughtTarget?.problemKey ||
    (!!savedThoughtTarget.sessionId && savedThoughtTarget.sessionId !== thoughtTarget?.sessionId)
  );
  const draftMismatchReason = differentDraft
    ? "This draft belongs to an earlier practice context. Save it there or clear it before adding another thought."
    : undefined;
  const binding = snapshot && activeSolutionBinding(snapshot.state.bindings, problem?.id, snapshot.presentation?.activeFileUri);
  const deskBinding = binding ?? snapshot?.state.bindings.findLast(item => item.problemId === problem?.id);
  const bindingFilename = binding ? decodeURIComponent(new URL(binding.fileUri).pathname.split("/").at(-1) ?? "Solution file") : null;
  const latestThought = snapshot?.state.thoughts.filter((item) => item.problemId === problem?.id).at(-1);
  const reflectionPending = session?.phase === "reflection";
  const handoffPending = !!snapshot?.presentation?.handoffPending;
  const canHandoff = !!window.forma && !!bridge && (handoffPending || (!!session && !reflectionPending));
  const snoozed = !!snapshot?.preferences.snoozedUntil && Date.parse(snapshot.preferences.snoozedUntil) > now;
  const semanticState: FennState = reaction ?? (tutorActivity!=="idle"?tutorStates[tutorActivity]:error ? "needs-attention" : snapshot?.state.platform === "accepted" && snapshot.state.learning === "unrecorded" ? "accepted" : snapshot?.state.localTests === "running" ? "tests-running" : snapshot?.state.platform === "pending" ? "submission-pending" : snapshot?.state.lifecycle === "working" ? "focus" : snapshot?.state.lifecycle === "paused" ? "paused" : view?.due.length && !snoozed ? "recall-available" : problem ? "context-ready" : "idle");
  const ribbon = snapshot?.preferences.ribbon ?? defaultRibbon;
  const tucked = !expanded && session?.running && ribbon.edge !== "free" && !((recognition || verdictNotice) && !snoozed);
  const folded = !expanded && (tucked || ribbon.shape === "fold");
  function rehearse() {
    rehearsalReturn.current = panel;
    openPanel("rehearsal");
  }
  const petStatus = tutorActivity!=="idle"?tutorLabels[tutorActivity]:previewMode && semanticState === "reflection-saved" ? "Reflection saved in preview" : stateLabels[semanticState];

  function react(state: FennState) { setReaction(state); if (reactionTimer.current) clearTimeout(reactionTimer.current); reactionTimer.current = setTimeout(() => setReaction(null), 2400); }
  async function command(type: CompanionCommand["type"], payload: unknown, success?: string, nextPanel?: Panel) {
    if (!bridge || busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    const draft = type === "thought" ? draftTargets.thought : type === "reflect" ? draftTargets.reflect : ["recall", "defer"].includes(type) && panel === "recall" ? draftTargets.recall : undefined;
    const expected = draft ? capturePreconditions(draft) : { ...(snapshot?.state.identity && type !== "attach" ? { expectedProblemKey: snapshot.state.identity } : {}), ...(snapshot?.data.session && ["pause", "resume", "finish", "reflect"].includes(type) ? { expectedSessionId: snapshot.data.session.id } : {}) };
    const signature = `${type}:${JSON.stringify(payload)}:${JSON.stringify(expected)}`;
    const request = pendingCommand.current?.signature === signature ? pendingCommand.current.command : { id: crypto.randomUUID(), type, payload, ...expected } as CompanionCommand;
    pendingCommand.current = { signature, command: request };
    try { const next = await bridge.command(request); pendingCommand.current = null; if (type === "thought" || type === "reflect" || type === "recall") { setDraftTargets(current => { const next = { ...current }; delete next[type]; return next; }); if (type === "recall") setRecallResponse(""); } if (nextPanel === "reflect" && !takeaway && !outcome) setDraftTargets(current => ({ ...current, reflect: freezeCaptureTarget(next) })); setSnapshot(next); setNow(Date.now()); if (success) setNotice(previewMode ? success.replace(/saved locally/gi, "saved in preview") : success); if (nextPanel) setPanel(nextPanel); if (type === "reflect" || type === "recall") react("reflection-saved");
      if (type === "thought" || type === "desk-add" || type === "reflect") {
        setRibbonFeedback(previous => ({
          kind: type === "reflect" ? "bookmark" : "thought",
          id: (previous?.id ?? 0) + 1,
          problemId: next.state.problemId,
        }));
      } else if (type === "start" || type === "plan-select" || type === "attach") {
        setRibbonFeedback(null);
      }
      return true;
    }
    catch (reason) { setError(errorMessage(reason)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function ui(action: string, payload?: unknown) {
    if (!bridge || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { const result = await bridge.ui(action, payload); if (action === "pair" && result && typeof result === "object" && "credential" in result && "endpoint" in result) setPairing(result as { credential: string; endpoint: string }); const next = await bridge.getSnapshot(); if (action === "recognition-finish" && !takeaway && !outcome) setDraftTargets(current => ({ ...current, reflect: freezeCaptureTarget(next) })); setSnapshot(next); if (action === "revoke-pairing") setPairing(null); return result; }
    catch (reason) { setError(errorMessage(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function toggleExpanded(value: boolean) { if (!value) { setDeskAssist(null); setPalette(null); } setExpanded(value); if (bridge) { try { await bridge.ui("expand", value); } catch (reason) { setError(errorMessage(reason)); setExpanded(true); } } }
  function openPanel(value: Panel, target?: CaptureTarget) { if (value !== "desk") setDeskAssist(null); if (value !== "tutor") setReturnFromTutorToDesk(false); if (snapshot && (value === "thought" || value === "reflect" || value === "recall")) { const hasDraft = value === "thought" ? !!thought.trim() : value === "reflect" ? !!takeaway.trim() || !!outcome : !!recallResponse.trim(); if (!hasDraft || !draftTargets[value]) setDraftTargets(current => ({ ...current, [value]: target ?? freezeCaptureTarget(snapshot) })); } setError(""); setNotice(""); setMore(false); setPanel(value); if (value === "today") void ui("today"); else if(value === "tutor")void ui("tutor-show"); else void toggleExpanded(true); }
  async function chooseToday(item: NonNullable<CompanionSnapshot["today"]>["items"][number]) {
    const coding=item.activity === "coding";
    if(!await command("plan-select", {itemId:item.id,start:coding&&!item.resume}, undefined, "home"))return;
    if(coding){if(!item.resume)await ui("open-external",item.url);}
    else {setRecallActivity(item.activity as "explain"|"complexity");const next=await bridge?.getSnapshot();openPanel("recall",next?freezeCaptureTarget(next):undefined);}
  }
  async function openRecall() { setRecallActivity("explain"); if (!snapshot || !view) return; const due = view.due[0]; let target: CaptureTarget | undefined; if (due && due.id !== problem?.id) { if (session) { setNotice("Finish your current session before switching to a revisit."); return; } if (!await command("attach", { url: due.url, title: due.title })) return; const identity = normalizeCodeforcesIdentity(due.url); if (identity) target = { problemKey: identity.key, title: due.title }; } openPanel("recall", target); }
  function addTranscript(text: string) {
    setThought(current => [current.trimEnd(), text].filter(Boolean).join("\n\n"));
  }

  function speakThought() {
    if (busy || thoughtVoiceBusy) return;
    openPanel("thought", thoughtTarget);
    if (!thoughtTarget || !canDictate) {
      setError("Attach a problem before recording a thought.");
      return;
    }
    if (draftMismatchReason) {
      setError(draftMismatchReason);
      return;
    }
    void thoughtVoice.start(thoughtTarget, addTranscript);
  }

  function retryThought(takeId: string) {
    if (!thoughtTarget || draftMismatchReason || busy || thoughtVoiceBusy) return;
    openPanel("thought", thoughtTarget);
    void thoughtVoice.retry(takeId, thoughtTarget, addTranscript);
  }

  function changeThreadDraft(text: string) {
    if (problem) setThreadDrafts(current => ({ ...current, [problem.id]: text }));
  }

  function closeDeskAssist(kind: "hint" | "idea") {
    setDeskAssist(null);
    (kind === "hint" ? hintButton : ideaButton).current?.focus();
  }

  function openDeskAssist(kind: "hint" | "idea") {
    if (!deskScope) return;
    setThreadEditorProblem(null);
    setDeskAssist({ scope: deskScope, kind });
  }

  function openThreadFromAssist(text?: string) {
    if (!problem) return;
    if (text?.trim()) addThreadTranscript(text.trim());
    setDeskAssist(null);
    setThreadEditorProblem(problem.id);
  }

  function addThreadTranscript(text: string) {
    if (problem) setThreadDrafts(current => ({
      ...current,
      [problem.id]: [current[problem.id]?.trimEnd(), text].filter(Boolean).join("\n\n"),
    }));
  }

  function speakThread() {
    if (!thoughtTarget || !canDictate || busy || thoughtVoiceBusy) return;
    void thoughtVoice.start(thoughtTarget, addThreadTranscript);
  }

  function retryThread(takeId: string) {
    if (!thoughtTarget || busy || thoughtVoiceBusy) return;
    void thoughtVoice.retry(takeId, thoughtTarget, addThreadTranscript);
  }

  async function pausePractice() {
    if (!await command("pause", {}, "Session paused.")) return;
    if (problem && (!expanded || panel === "home" || panel === "desk")) {
      setThreadEditorProblem(problem.id);
      setPanel("desk");
    }
  }

  async function resumePractice() {
    if (handoffPending) { openPanel("handoff"); return; }
    if (await command("resume", {}, "Session resumed.")) setThreadEditorProblem(null);
  }

  async function openHandoff() {
    if (!canHandoff || busy || thoughtVoiceBusy) return;
    if (session?.running && !await command("pause", {}, "Session paused.")) return;
    openPanel("handoff");
  }

  async function prepareHandoff(thread: string) {
    if (thread !== (latestThread?.text ?? "") && (!thread || !await saveDeskEntry({ kind: "thread", text: thread }))) return false;
    changeThreadDraft("");
    return true;
  }

  function openPalette(restoreCompact = !expanded, hostExpanded = false) {
    if (!snapshot || gallery || panel === "rehearsal") return;
    setPalette(current => current ?? { restoreCompact });
    if (!hostExpanded && !expanded) void toggleExpanded(true);
  }

  function closePalette(restoreCompact = true) {
    setPalette(null);
    if (restoreCompact && palette?.restoreCompact) void toggleExpanded(false);
  }

  function openPaletteDesk(withHint = false) {
    closePalette(false);
    openPanel("desk");
    if (withHint) openDeskAssist("hint");
  }

  const onPaletteShortcut = useEffectEvent(() => {
    openPalette(snapshot?.presentation?.paletteShortcutWasExpanded === false, true);
  });
  const paletteShortcutEvent = snapshot?.presentation?.paletteShortcutPress;
  useEffect(() => {
    if (paletteShortcutEvent === undefined) return;
    const previous = lastPaletteShortcutPress.current;
    if (previous !== undefined && paletteShortcutEvent <= previous) return;
    lastPaletteShortcutPress.current = paletteShortcutEvent;
    if (previous !== undefined) onPaletteShortcut();
  }, [paletteShortcutEvent]);

  const paletteCommands: PaletteCommand[] = [];
  if (palette && problem && !busy && !thoughtVoiceBusy) {
    if (session && !session.running && !reflectionPending && !handoffPending) paletteCommands.push({
      id: "action:resume", title: `Resume ${problem.title}`,
      detail: latestThread?.text ?? `${duration(session.elapsedMs)} tracked`,
      meta: "Paused session", keywords: "continue paused session practice yesterday s problem",
      run: () => { closePalette(false); void resumePractice(); },
    });
    paletteCommands.push({
      id: "action:desk", title: "Open problem desk", detail: problem.title, keywords: "current workspace thread notes",
      run: () => openPaletteDesk(),
    });
    if (canDictate) paletteCommands.push({
      id: "action:record", title: "Record a thought", detail: problem.title, keywords: "speak voice dictate microphone note",
      run: () => { closePalette(false); speakThought(); },
    }, {
      id: "action:hint", title: "I’m stuck", detail: "Review a request for one hint", keywords: "tutor help one hint current problem",
      run: () => openPaletteDesk(true),
    });
    if (canHandoff) paletteCommands.push({
      id: "action:handoff", title: handoffPending ? "Review web handoff" : "Continue on web",
      detail: problem.title, keywords: "pause browser transfer",
      run: () => { closePalette(false); void openHandoff(); },
    });
  }

  const handoffAction = canHandoff && <button type="button" className="settings-link"
    disabled={busy || thoughtVoiceBusy} onClick={() => void openHandoff()}>
    <Globe2 size={15} aria-hidden="true"/>
    {handoffPending ? "Review web handoff" : session?.running ? "Pause and continue on web" : "Continue on web"}
  </button>;

  function saveDeskEntry(item: DeskEntry) {
    if (!problem || thoughtVoiceBusy) return Promise.resolve(false);
    return command("desk-add", { ...item, problemId: problem.id }, item.kind === "thread" ? "Thread saved locally." : "Pinned locally.");
  }

  const onThoughtShortcut = useEffectEvent(() => {
    if (!bridge || !window.forma || busy) return;
    if (thoughtVoice.phase === "recording" || thoughtVoice.phase === "recorded") {
      closePalette(false);
      thoughtVoice.finish();
    }
    else if (thoughtVoice.phase === "idle") {
      closePalette(false);
      if (showDeskIdea) return;
      if (expanded && panel === "desk" && editThread) speakThread();
      else speakThought();
    }
  });
  const thoughtShortcutEvent = snapshot?.presentation?.thoughtShortcutPress;
  useEffect(() => {
    if (thoughtShortcutEvent === undefined) return;
    const previous = lastThoughtShortcutPress.current;
    if (previous !== undefined && thoughtShortcutEvent <= previous) return;
    lastThoughtShortcutPress.current = thoughtShortcutEvent;
    if (previous !== undefined) onThoughtShortcut();
  }, [thoughtShortcutEvent]);

  async function saveThought() {
    if (!thoughtTarget || thoughtVoiceBusy || thought.length > thoughtLimit) return;
    if (await command("thought", { text: thought }, "Thought saved locally.", "home")) setThought("");
  }
  async function saveReflection() { if (outcome && await command("reflect", { outcome, takeaway, notes: "" }, "Reflection saved locally. Your next revisit follows your notebook’s learning rules.", "home")) { setTakeaway(""); setOutcome(null); } }
  function renderVoiceControls(thread = false, onIdeaTranscript?: (text: string) => void, disabled = false) {
    const start = onIdeaTranscript
      ? () => { if (thoughtTarget) void thoughtVoice.start(thoughtTarget, onIdeaTranscript); }
      : thread ? speakThread : speakThought;
    const retry = onIdeaTranscript
      ? (takeId: string) => { if (thoughtTarget) void thoughtVoice.retry(takeId, thoughtTarget, onIdeaTranscript); }
      : thread ? retryThread : retryThought;
    return <>
      {canDictate && <div className="thought-voice">
        {!thoughtVoiceBusy && <button type="button" className="settings-link" onClick={start} disabled={busy || disabled}>
          <Mic size={15}/> {thoughtVoice.notice ? "Record more" : onIdeaTranscript ? "Speak my idea" : thread ? "Speak this thread" : "Start voice recording"}
        </button>}
        {!onIdeaTranscript && !thoughtVoiceBusy && thoughtShortcut && snapshot?.presentation?.thoughtShortcutAvailable &&
          <p className="field-help"><kbd>{thoughtShortcut}</kbd> to start or finish.</p>}
        {thoughtVoiceBusy && <>
          <p className="thought-voice-status" role="status">
            {thoughtVoice.phase === "permission" ? "Preparing the microphone…"
              : thoughtVoice.phase === "recording" ? "Recording"
              : thoughtVoice.phase === "recorded" ? "Recording stopped at 60 seconds."
              : onIdeaTranscript ? "Transcribing your explanation…" : "Transcribing your thought…"}
          </p>
          {thoughtVoice.phase === "recording" && <span className="thought-voice-time" aria-hidden="true">{thoughtVoice.seconds}s</span>}
          {thoughtVoice.provider && <p className="field-help">Finishing sends the audio to {thoughtVoice.provider} for transcription. {onIdeaTranscript ? "Review the transcript before outlining your idea." : "You can review the text before saving it locally."}</p>}
          <div className="thought-voice-actions">
            {(thoughtVoice.phase === "recording" || thoughtVoice.phase === "recorded") &&
              <Button secondary onClick={thoughtVoice.finish} icon={Check}>
                {thoughtVoice.phase === "recorded" ? "Transcribe recording" : "Finish recording and transcribe"}
              </Button>}
            <button type="button" className="text-button" onClick={thoughtVoice.cancel}>Cancel recording</button>
          </div>
        </>}
        {thoughtVoice.error && <p className="inline-error" role="alert">{thoughtVoice.error}</p>}
        {thoughtVoice.notice && <p className="field-help" role="status">{thoughtVoice.notice}</p>}
      </div>}
      <ThoughtTakeRecovery recovery={thoughtVoice.recovery} problemKey={snapshot?.state.identity}
        busy={busy || thoughtVoiceBusy || disabled} retryDisabledReason={thread || onIdeaTranscript ? undefined : draftMismatchReason}
        onRetry={retry}/>
    </>;
  }
  const footer = <footer className="card-footer"><span><span className="status-dot"/>{previewMode ? "In-memory preview" : "Local notebook"}</span><span>{busy ? <><LoaderCircle className="spin" size={11}/> Saving…</> : snapshot ? <><ShieldCheck size={11}/>{previewMode ? "Preview only" : "Saved locally"}</> : "Connecting…"}</span></footer>;

  if (gallery) return <main className={`gallery theme-${theme}`}>
    <div className="gallery-heading"><span className="eyebrow">FORMA / RIBBON</span><h1>The practice ribbon.</h1><p>The folded mark follows your session from the desktop timer to your notebook.</p></div>
    <div className="gallery-grid">{FENN_STATES.map(state => <section className="gallery-item" key={state}><RibbonMark size={56}/><strong>{stateLabels[state]}</strong></section>)}</div>
  </main>;

  const verdictBubble = verdictNotice && !snoozed && <aside className="recognition-bubble" role="status" aria-label="Codeforces verdict" data-interactive><div><span className="eyebrow">PLATFORM RESULT</span><strong title={verdictNotice.title}>{verdictNotice.title}</strong><p>{verdictNotice.message}</p></div><IconButton icon={X} label="Dismiss verdict" onClick={()=>void ui("attention-dismiss",verdictNotice.id)}/></aside>;
  const recognitionBubble = recognition && !snoozed && <aside className="recognition-bubble" role="status" aria-label="Problem recognition" data-interactive><div><span className="eyebrow">{recognition.status === "needs-choice" ? "ANOTHER SOLUTION" : recognition.status === "conflict" ? "ASSOCIATION NEEDS A CHOICE" : "RECOGNISED"}</span><strong title={recognition.title}>{recognition.title}</strong><p>{recognition.status === "recognised" ? `Recognised from ${recognition.source === "cph" ? "CPH" : recognition.source === "browser" ? "Chrome" : "your saved association"}` : recognition.message}</p></div><IconButton icon={X} label="Dismiss recognition" onClick={() => void ui("recognition-dismiss", recognition.id)}/><div className="recognition-actions">{recognition.status === "needs-choice" ? <><button onClick={() => void ui("recognition-dismiss", recognition.id)}>Keep current</button><button disabled={busy} onClick={() => { void ui("recognition-finish").then(result => { if (result !== undefined) setPanel("reflect"); }); }}>Finish current &amp; switch</button></> : recognition.status === "conflict" ? <><button onClick={() => void ui("recognition-dismiss", recognition.id)}>Keep current association</button><button disabled={busy} onClick={() => void ui("recognition-resolve")}>Use CPH association</button></> : !session && <button disabled={busy} onClick={() => void command("start", {}, "Session started.")}>Start a session <Play size={11}/></button>}</div></aside>;
  return <main className={`companion theme-${theme} ${reducedMotion?"is-reduced":""} ${previewMode ? "companion--preview" : ""}`}>
    {previewMode && <div className="preview-heading"><span className="eyebrow">FORMA COMPANION</span><p>A quieter kind of progress.</p><span className="preview-label">Browser preview · nothing is saved</span></div>}
    <div className={`companion-window ${panel==="tutor"&&expanded?"is-tutor":""} ${!expanded ? "is-collapsed" : ""} ${(recognition || verdictNotice) && !snoozed ? "has-recognition" : ""}`}>
      {!expanded && (recognitionBubble || verdictBubble)}
      <section className={`card ${panel==="today"?"card--glance":panel==="tutor"?"card--tutor":""}`} hidden={!expanded} style={expanded?undefined:{display:"none"}} aria-label="Forma Companion" aria-busy={busy}>
        <header className="card-header"><div className="brand"><RibbonMark size={27}/><span>forma<span className="brand-detail">ribbon</span></span></div><div className="header-actions">{panel !== "home" && <IconButton icon={ArrowLeft} label={panel === "tutor" && returnFromTutorToDesk ? "Back to problem desk" : "Back to practice"} onClick={() => openPanel(panel === "tutor" && returnFromTutorToDesk ? "desk" : "home")}/>}{snapshot && panel !== "rehearsal" && <IconButton icon={Search} label="Open command palette" onClick={() => openPalette()}/>}<IconButton icon={Settings2} label="Companion settings" active={panel === "settings"} onClick={() => openPanel(panel === "settings" ? "home" : "settings")}/><IconButton icon={X} label="Collapse to ribbon" onClick={() => void toggleExpanded(false)}/></div></header>
        <div className="card-body" ref={focusTarget} tabIndex={-1}>
          {panel === "home" && (recognitionBubble || verdictBubble)}
          {(panel === "thought" || panel === "reflect" || panel === "recall") && draftTargets[panel] && <p className="field-help">Draft for {draftTargets[panel]!.title}{draftTargets[panel]!.problemKey !== snapshot?.state.identity ? " · return to this problem to save; your draft is kept here." : ""}</p>}
          {!snapshot ? <div className="empty-state"><RibbonMark size={72}/><h1>{error ? "A small connection snag." : "Making a little space."}</h1><p>{error || "Opening your local notebook…"}</p></div> : <>
          {bridge&&snapshot&&<TutorPanel bridge={bridge} snapshot={snapshot} active={expanded&&panel==="tutor"} covered={!!palette} conversationRequest={tutorRequest} onActivity={setTutorActivity}/>}
          {panel === "rehearsal" && <RibbonRehearsal shortcut={previewMode ? undefined : snapshot.preferences.shortcut} shortcutPress={snapshot.presentation?.shortcutPress} onExit={() => openPanel(rehearsalReturn.current)}/>}
          {(panel === "home" || panel === "today") && !session && !snapshot.data.attempts.length && <button className="settings-link" onClick={rehearse}>Try a sample session <ArrowRight size={14}/></button>}
          {(panel === "home" || panel === "today") && thoughtVoice.recovery.takes.length > 0 &&
            <button type="button" className="settings-link" onClick={() => openPanel("thought")}>
              <Mic size={14}/> Recover spoken thoughts <span aria-hidden="true">{thoughtVoice.recovery.takes.length}</span>
            </button>}
          {panel === "today" && <><button className="text-button tutor-entry" onClick={()=>openPanel("tutor")}>Ask Tutor about this problem <ArrowRight size={12}/></button><div className="today-heading"><span className="eyebrow">TODAY’S PLAN</span>{!today?.items.length && <p>{today?.emptyMessage ?? "Today is unavailable. Reopen the local companion to try again."}</p>}</div>{today?.items.map((item,index)=><details open={index===0} className="today-choice" key={item.id}><summary>{index===0?"Suggested activity":`Another activity · ${item.title}`}</summary><section className="today-item" key={item.id}><span className="eyebrow">{item.resume?"UNFINISHED SESSION":item.activity==="coding"?"CODING":item.activity==="complexity"?"COMPLEXITY RECALL":"APPROACH RECALL"}{index?" · NEXT":""}</span><strong>{item.title}</strong><p>{item.reason}</p><small>{item.timeboxMinutes} min planned · {item.resume?"Your timer stays paused until you resume.":"Only tracked coding time counts."}</small><Button disabled={busy} onClick={()=>void chooseToday(item)} icon={ArrowRight}>{item.resume?"Continue current session":item.activity==="coding"?"Start & open problem":"Try recall"}</Button><button className="text-button" disabled={busy||!!snapshot.data.session} onClick={()=>void command("plan-later",{itemId:item.id,until:localDate(addDays(new Date(),1))},"Activity deferred until tomorrow.")}>Later · tomorrow</button></section></details>)}</>}
          {panel === "home" && <>
            <button className="tutor-entry text-button" onClick={()=>openPanel("tutor")}>Ask Tutor <Feather size={12}/></button>
            <button className="today-entry" onClick={()=>openPanel("today")}><span>Today’s plan</span><strong>{today?.items[0]?.title ?? "Open today’s plan"}</strong><ChevronRight size={14}/></button>
            {!!snapshot.state.followups?.length && <details className="verdict-history"><summary>Codeforces follow-up</summary>{snapshot.state.followups.slice(-5).reverse().map(f=><p key={f.id}><strong>{f.identity} · {f.handle}</strong><br/>{f.status==="searching"?"No matching submission observed on the latest fetched page":f.status==="expired"?"Follow-up expired · result remains unknown":f.status==="temporary-failure"?"Temporary check failure · result remains unknown":f.status==="pending"?"Submission pending":snapshot.state.submissions.filter(s=>s.sessionId===f.id).map(s=>s.verdict??"Pending").join(", ")}</p>)}<p>Checks cover the latest 100 public submissions. Missing evidence is not a failed submission.</p><button className="text-button" disabled={busy} onClick={()=>void ui("check-codeforces")}>Refresh public verdicts</button></details>}

            <div className="intro"><span className="eyebrow"><span className="tiny-line"/>{reflectionPending ? "A MOMENT TO REFLECT" : session?.running ? "IN YOUR OWN TIME" : "YOUR PRACTICE, REMEMBERED"}</span><h1>{reflectionPending ? <>What will you<br/><em>carry forward?</em></> : session?.running ? <>One thought<br/><em>at a time.</em></> : <>A little space<br/><em>to find your way.</em></>}</h1><p>{reflectionPending ? "The result is one part. Your experience is the other." : session?.running ? "Ribbon will keep the thread while you focus." : "A problem, a thought, and something to return to."}</p></div>
            {problem ? <>
              <div className="problem"><div className="problem-icon"><FileCode2 size={19} strokeWidth={1.4}/></div><div className="problem-copy"><span>CODEFORCES · {problem.problemCode || problem.cfKey || "ATTACHED"}</span><strong>{problem.title.replace(/^[A-Z]\d?\.\s*/, "")}</strong><small className="binding-source">{bindingFilename ? `${binding?.source === "cph" ? "CPH metadata" : "Confirmed file"} · ${bindingFilename}` : snapshot.state.bindings.some(item => item.problemId === problem.id) ? "No active solution file for this problem" : "Manually attached"}</small></div><IconButton icon={ArrowUpRight} label="Open problem on Codeforces" onClick={() => void ui("open-external", problem.url)}/></div>
              <div className="session-line"><span className={`session-state ${session?.running ? "session-state--running" : ""}`}><span className="status-dot"/>{reflectionPending ? "Ready for reflection" : session?.running ? "Session running" : session ? handoffPending ? "Paused for web handoff" : "Session paused" : "Problem attached"}</span>{session && <time aria-label="Tracked practice duration" className="session-time"><Clock3 size={12}/>{duration(session.elapsedMs)}</time>}</div>

              {reflectionPending ? <Button disabled={busy} onClick={() => openPanel("reflect")} icon={ArrowRight}>Capture the reflection</Button> : session ? <><Button disabled={busy} onClick={() => openPanel("thought")} icon={Plus}>Save a thought</Button><div className="split-actions"><button disabled={busy} onClick={() => void (session.running ? pausePractice() : resumePractice())}><span>{session.running ? <Pause size={13}/> : <Play size={13}/>}</span>{handoffPending ? "Review handoff" : session.running ? "Pause" : "Resume"}</button><button disabled={busy || handoffPending} onClick={() => void command("finish", {}, undefined, "reflect")}><Check size={14}/>Finish & reflect</button></div></> : <><Button disabled={busy} onClick={() => void command("start", {}, "Session started. Only explicitly tracked time counts.")} icon={Play}>Begin a session</Button><button className="text-button centered" onClick={() => openPanel("thought")}><Feather size={12}/>Just leave a thought</button></>}
              {handoffAction}
              <button type="button" className="desk-entry" onClick={() => openPanel("desk")}>
                <BookOpen size={15} aria-hidden="true"/>
                <span><strong>{session && !session.running && !reflectionPending ? "Pick up the thread" : "Open problem desk"}</strong>
                  {latestThread && <small>{latestThread.text}</small>}</span>
                <ChevronRight size={13} aria-hidden="true"/>
              </button>
              <div className="quiet-actions"><button onClick={() => openPanel("memory")}><BookOpen size={13}/>Open prior memory<ChevronRight size={12}/></button><div className="more-anchor"><IconButton icon={Ellipsis} label="More practice options" active={more} onClick={() => setMore(!more)}/>{more && <div className="more-menu"><button disabled={!!session} onClick={() => openPanel("attach")}><Link2 size={13}/>Advanced: attach a URL</button><button onClick={() => void ui("check-codeforces")} disabled={busy || !snapshot.state.handle}><Code2 size={13}/>Check Codeforces now</button><button onClick={() => { void ui("snooze", 60).then((result) => { if (result !== undefined) setNotice("Suggestions snoozed for an hour."); }); setMore(false); }}><Moon size={13}/>Snooze suggestions · 1 hour</button></div>}</div></div>
            </> : <div className="get-started"><div className="welcome-art"><RibbonMark size={108}/><span className="welcome-orbit orbit-one"/><span className="welcome-orbit orbit-two"/></div><Button onClick={() => void ui("open-vscode")} icon={FileCode2}>Open a solution in VS Code</Button><p>Pair once in Settings, select a practice folder, and choose “Recognise problems from CPH” in VS Code. For locally created problems, use Chrome’s “Use in Forma”.</p><button className="text-button centered" onClick={() => openPanel("settings")}>Connection &amp; setup</button><button className="text-button centered" onClick={() => openPanel("attach")}>Advanced: attach a URL</button></div>}
            {!!view?.due.length && !session?.running && !snoozed && <button className="recall-offer" onClick={() => void openRecall()}><span className="recall-icon"><BookOpen size={14}/></span><span><strong>A thought to revisit</strong><small>{view.due.length === 1 ? "One problem is ready when you are." : `${view.due.length} problems are ready when you are.`}</small></span><ArrowRight size={14}/></button>}
          </>}
          {panel === "attach" && <><PanelHeading eyebrow="MAKE THE CONNECTION" title={<>What are you<br/><em>working on?</em></>} description="Attach the exact Codeforces problem. Identification alone never records a solve."/><Form onSubmit={() => void command("attach", { url, ...(problemTitle.trim() ? { title: problemTitle.trim() } : {}) }, "Problem attached locally.", "home")}><label className="field-label" htmlFor="problem-url">Problem URL</label><div className="input-icon"><Link2 size={15}/><input id="problem-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="codeforces.com/problemset/problem/…" required autoComplete="off" autoFocus/></div><label className="field-label" htmlFor="problem-title">Title <span>optional</span></label><input id="problem-title" value={problemTitle} onChange={(event) => setProblemTitle(event.target.value)} maxLength={200} placeholder="A name to remember it by"/><p className="field-help">Contest and Gym identities stay separate. Your solution file can be connected from the VS Code extension.</p><Button type="submit" disabled={busy || !url.trim()} icon={ArrowRight}>Attach problem</Button></Form></>}
          {panel === "desk" && problem && <ProblemDesk
            key={problem.id}
            problemTitle={problem.title}
            elapsed={session && !reflectionPending ? duration(session.elapsedMs) : undefined}
            paused={!!session && !session.running && !reflectionPending}
            busy={busy || thoughtVoiceBusy}
            items={deskItems}
            editThread={editThread}
            threadDraft={threadDrafts[problem.id] ?? ""}
            onThreadDraftChange={changeThreadDraft}
            onEditThreadChange={open => {
              if (open) setDeskAssist(null);
              setThreadEditorProblem(open ? problem.id : null);
            }}
            onSave={saveDeskEntry}
            onRemove={itemId => command("desk-remove", { itemId, problemId: problem.id }, "Removed from this desk.")}
            onResume={session && !session.running && !reflectionPending && !handoffPending ? () => void resumePractice() : undefined}
            onOpenProblem={() => void ui("open-external", problem.url)}
            onOpenSolution={deskBinding ? () => void ui("open-solution", deskBinding.id) : undefined}
            voiceControls={renderVoiceControls(true)}
            handoffAction={handoffAction}
            hintButtonRef={hintButton}
            onToggleHint={window.forma && bridge ? () => {
              if (showDeskHint) closeDeskAssist("hint");
              else openDeskAssist("hint");
            } : undefined}
            hint={showDeskHint && bridge && <DeskHintFlow key={deskScope} bridge={bridge} problemId={problem.id}
              covered={!!palette}
              hypothesis={deskItems.findLast(item => item.kind === "hypothesis")?.text}
              onClose={() => closeDeskAssist("hint")}
              onOpenTutor={() => { setReturnFromTutorToDesk(true); openPanel("tutor"); }}
              onLeaveThread={() => openThreadFromAssist()}
              onKeep={openThreadFromAssist}
              onOpenLink={url => void ui("open-external", url)}
            />}
            ideaButtonRef={ideaButton}
            onToggleIdea={window.forma && bridge ? () => {
              if (showDeskIdea) closeDeskAssist("idea");
              else openDeskAssist("idea");
            } : undefined}
            idea={showDeskIdea && bridge && deskScope && <DeskIdeaFlow
              key={deskScope} bridge={bridge} problemId={problem.id}
              draft={ideaDraft?.scope === deskScope ? ideaDraft.value : emptyDeskIdeaDraft}
              onDraftChange={changeIdeaDraft}
              covered={!!palette || !visible} blocked={busy || thoughtVoiceBusy}
              savedRunEvidence={new Set(deskItems.filter(item => item.kind === "counterexample").map(item => item.text))}
              renderVoiceControls={(onTranscript, disabled) => renderVoiceControls(false, onTranscript, disabled)}
              onClose={() => closeDeskAssist("idea")}
              onOpenTutor={() => { setReturnFromTutorToDesk(true); openPanel("tutor"); }}
              onKeepOutline={text => saveDeskEntry({ kind: "hypothesis", text })}
              onKeepChallenge={openThreadFromAssist}
              onSaveRun={text => saveDeskEntry({ kind: "counterexample", text })}
            />}
          />}
          {panel === "desk" && !problem && <PanelHeading eyebrow="PROBLEM DESK" title="Attach a problem to begin." description="Your desk follows the problem you’re practicing."/>}
          {panel === "handoff" && bridge && <SessionHandoffPanel bridge={bridge}
            sessionId={session && !session.running && !reflectionPending ? session.id : undefined}
            problemTitle={problem?.title} elapsedMs={session?.elapsedMs}
            savedThread={latestThread?.text ?? ""} initialDraft={problem ? threadDrafts[problem.id] : undefined}
            onDraftChange={changeThreadDraft} onPrepare={prepareHandoff} onBack={() => openPanel("home")}/>}
          {panel === "thought" && <>
            <PanelHeading eyebrow="LEAVE YOURSELF A THREAD"
              title={<>Keep the thought.<br/><em>Find it later.</em></>}
              description="An observation, a question, or where to pick up next. In your own words."/>
            <Form onSubmit={() => { if (!thoughtVoiceBusy && thought.length <= thoughtLimit) void saveThought(); }}>
              {renderVoiceControls()}
              <label className="field-label" htmlFor="thought">Your thought</label>
              <textarea id="thought" value={thought} onChange={event => setThought(event.target.value)}
                placeholder="What I’m noticing is…" rows={5} required autoFocus={!thoughtVoiceBusy}/>
              <div className="field-meta">
                <span>{thought.length > thoughtLimit ? "Shorten your thought before saving" : "Private to your local notebook"}</span>
                <span>{thought.length.toLocaleString()} / {thoughtLimit.toLocaleString()}</span>
              </div>
              <Button type="submit" disabled={busy || thoughtVoiceBusy || !thoughtTarget || !thought.trim() || thought.length > thoughtLimit} icon={Feather}>
                Save thought locally
              </Button>
            </Form>
          </>}
          {panel === "reflect" && <><PanelHeading eyebrow="THE PART THAT STAYS" title={<>How did<br/><em>you get here?</em></>} description={snapshot.state.platform === "accepted" ? "Codeforces recorded Accepted. You choose what the learning record says." : "Your reflection gives this session its meaning."}/><Form onSubmit={() => void saveReflection()}>{!!snapshot.tutorAssistance?.shown&&<p className="tutor-context-warning">Tutor assistance was shown in this attempt{snapshot.tutorAssistance.hintLevels.length?` · levels ${snapshot.tutorAssistance.hintLevels.join(", ")}`:""}. You still choose the learning outcome.</p>}<fieldset className="outcome-group"><legend className="field-label">How did this attempt go?</legend><div className="outcome-grid">{(Object.keys(outcomeLabels) as Outcome[]).map((value, index) => <button key={value} type="button" aria-pressed={outcome === value} className={outcome === value ? "selected" : ""} onClick={() => setOutcome(value)}><span className="outcome-marker" aria-hidden="true">{outcome === value ? <Check size={12}/> : String(index + 1).padStart(2, "0")}</span>{outcomeLabels[value]}</button>)}</div></fieldset><label className="field-label" htmlFor="takeaway">One thing to carry forward <span>optional</span></label><textarea id="takeaway" value={takeaway} onChange={(event) => setTakeaway(event.target.value)} rows={3} placeholder="Next time, I’ll remember…" maxLength={300}/><Button type="submit" disabled={busy || !outcome} icon={Check}>Save reflection locally</Button><button type="button" className="text-button centered" onClick={() => { setPanel("home"); setNotice("Your session is waiting for reflection. Come back when you like."); }}>I’ll reflect later</button></Form></>}
          {panel === "memory" && <><PanelHeading eyebrow="YOUR OWN WORDS" title={<>Pick up<br/><em>the thread.</em></>} description="Only opened because you asked. These are your saved observations."/>{latestThought && <div className="memory-note"><span className="eyebrow">LAST THOUGHT</span><p>{latestThought.text}</p><small>{new Date(latestThought.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</small></div>}{view?.memory?.latestTakeaway ? <div className="memory-note"><span className="eyebrow">LAST TAKEAWAY</span><p>{view.memory.latestTakeaway}</p></div> : <div className="memory-empty"><BookOpen size={22}/><p>No earlier reflection for this problem yet.<br/>Your next takeaway can start the thread.</p></div>}<Button secondary onClick={() => openPanel("home")} icon={ArrowRight}>Back to the problem</Button></>}
          {panel === "recall" && <><PanelHeading eyebrow="A SMALL RETURN" title={<>What do<br/><em>you remember?</em></>} description="Try explaining the approach or invariant before opening your earlier notes."/><div className="recall-problem"><BookOpen size={14}/><strong>{draftTargets.recall?.title ?? problem?.title ?? "Choose an attached problem"}</strong></div><Form onSubmit={() => void command("recall", { activity: recallActivity, outcome: recallOutcome, response: recallResponse, cue: "" }, "Recall saved locally. Your next revisit has been scheduled.", "home")}><label className="field-label" htmlFor="recall-response">Your explanation</label><textarea id="recall-response" rows={4} value={recallResponse} onChange={(event) => setRecallResponse(event.target.value)} maxLength={2000} placeholder="The key idea was…" required/><label className="field-label" htmlFor="recall-outcome">How did recall feel?</label><select id="recall-outcome" value={recallOutcome} onChange={(event) => setRecallOutcome(event.target.value as typeof recallOutcome)}><option value="independent">Recalled independently</option><option value="cue">Needed a cue</option><option value="unrecalled">Could not recall yet</option></select><Button disabled={busy || !recallResponse.trim()} type="submit" icon={Check}>Save this recall</Button><div className="split-actions"><button type="button" onClick={() => openPanel("memory")}><BookOpen size={13}/>Open my memory</button><button type="button" disabled={busy} onClick={() => void command("defer", { until: localDate(addDays(new Date(), 1)) }, "Revisit deferred until tomorrow.", "home")}><Clock3 size={13}/>Tomorrow</button></div></Form></>}
          {panel === "settings" && <><PanelHeading eyebrow="MAKE YOURSELF AT HOME" title={<>A companion,<br/><em>on your terms.</em></>} description="Local first. Quiet by default."/><RibbonStudio saved={ribbon} reducedMotion={reducedMotion} onSave={async value => {if(!bridge)throw new Error("Reconnect the companion to save.");await bridge.ui("ribbon-options",value);setSnapshot(await bridge.getSnapshot());}} onRehearse={rehearse}/>{bridge && <SetupPanel bridge={bridge} snapshot={snapshot} pairing={pairing} disabled={busy} onPair={() => void ui("pair")} onRevoke={() => void ui("revoke-pairing")} onDismissPairing={() => setPairing(null)} onOpenVscode={() => void ui("open-vscode")} onProvider={() => { setTutorRequest({id: Date.now(), settings: true}); setPanel("tutor"); void toggleExpanded(true); }}/>}<div className="settings-section"><label className="field-label">Appearance</label><div className="theme-choice">{([{ value: "light", label: "Light", icon: Sun }, { value: "ink", label: "Ink", icon: Moon }, { value: "system", label: "System", icon: Settings2 }] as const).map(({ value, label, icon: Icon }) => <button key={value} className={snapshot.preferences.theme === value ? "selected" : ""} onClick={() => void ui("theme", value)} disabled={busy}><Icon size={14}/>{label}</button>)}</div><label className="toggle-row"><span><strong>Reduced motion</strong><small>Still poses, with every action available</small></span><input type="checkbox" checked={snapshot.preferences.reducedMotion} onChange={(event) => void ui("reduced-motion", event.target.checked)} disabled={busy}/></label></div><div className="settings-section"><label className="field-label" htmlFor="cf-handle">Codeforces handle</label><Form onSubmit={() => void command("set-handle", { handle: handle.trim() || null }, "Handle saved locally.")}><div className="handle-row"><input id="cf-handle" value={handle} onChange={(event) => setHandle(event.target.value)} maxLength={64} placeholder="Your public handle" autoComplete="off"/><button type="submit" className="small-button" disabled={busy}>Save</button></div></Form><p className="field-help">Public submission evidence never chooses a learning outcome for you.</p><button className="settings-link" onClick={() => void ui("check-codeforces")} disabled={busy || !snapshot.state.handle}><Code2 size={14}/>{snapshot.codeforces.checking ? "Checking public submissions…" : "Check submissions now"}<ArrowUpRight size={12}/></button><span className="freshness">{snapshot.codeforces.checkedAt ? `Last checked ${new Date(snapshot.codeforces.checkedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "No submission check yet. No idle polling."}</span>{snapshot.codeforces.error && <p className="inline-error">{snapshot.codeforces.error}</p>}</div>{bridge && <><BackupPanel bridge={bridge} disabled={busy} onRestored={() => { void bridge.getSnapshot().then(setSnapshot).catch(reason => setError(errorMessage(reason))); setDraftTargets({}); setThought(""); setThreadDrafts({}); setThreadEditorProblem(null); setTakeaway(""); setOutcome(null); setRecallResponse(""); }}/></>}<div className="settings-section"><label className="field-label" htmlFor="shortcut">Open companion shortcut</label><Form onSubmit={() => { void ui("shortcut", shortcut).then((result) => { if (result !== undefined) setNotice("Shortcut saved. The menu-bar icon is always available."); }); }}><div className="handle-row"><input id="shortcut" value={shortcut} onChange={(event) => setShortcut(event.target.value)} maxLength={100} placeholder="Control+Option+F"/><button type="submit" className="small-button" disabled={busy || !shortcut.trim()}>Save</button></div></Form><p className="field-help">Use Electron accelerator names, for example Control+Option+F. Conflicts are checked before replacing your shortcut.</p></div>{window.forma && <ThoughtShortcutSettings key={thoughtShortcut ?? "off"}
                shortcut={thoughtShortcut} available={!!snapshot.presentation?.thoughtShortcutAvailable} busy={busy}
                onSave={value => void ui("thought-shortcut", value).then(result => {
                  if (result !== undefined) setNotice(value ? "Recording shortcut saved." : "Recording shortcut turned off.");
                })}/>}
              {window.forma && <PaletteShortcutSettings key={paletteShortcut ?? "off"}
                shortcut={paletteShortcut} available={!!snapshot.presentation?.paletteShortcutAvailable} busy={busy}
                onSave={value => void ui("palette-shortcut", value).then(result => {
                  if (result !== undefined) setNotice(value ? "Command palette shortcut saved." : "Global command palette shortcut turned off.");
                })}/>}
              <div className="settings-section last">{snoozed && <button className="settings-link" onClick={() => void ui("snooze", false)} disabled={busy}><Sun size={14}/>Resume suggestions</button>}<button className="settings-link" onClick={() => void ui("snooze", 60)} disabled={busy}><Moon size={14}/>Snooze suggestions for an hour</button><button className="settings-link" onClick={() => void ui("hide")} disabled={busy}><X size={14}/>Hide ribbon · recover from the menu bar</button><p className="settings-footnote">Tutor is optional. Only explicitly included context goes to your configured provider. No automatic learning credit. Recover the ribbon from the menu-bar icon at any time.</p></div></>}
          </>}
          {error && snapshot && <div className="feedback feedback--error" role="alert"><CircleHelp size={15}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={12}/></button></div>}
          {notice && <div className="feedback" role="status"><Check size={14}/><span>{notice}</span></div>}
        </div>{footer}
      </section>
      <div className="ribbon-native-dock" data-folded={folded} data-tucked={!!tucked} data-still={reducedMotion || ribbon.motion === "still"} data-state={semanticState}>
        <button type="button" className="ribbon-open" title={petStatus}
          aria-label={expanded ? "Collapse companion card" : `Open companion. ${petStatus}`}
          onClick={() => { if (!expanded && !session && panel !== "tutor") openPanel("today"); else void toggleExpanded(!expanded); }}>
          <DesktopRibbonMark size={34} focusing={!!session?.running}
            tucked={tucked && ribbon.edge !== "free" ? ribbon.edge : undefined}
            recording={thoughtVoice.phase === "recording"} meterRef={thoughtVoice.levelRef}
            feedback={ribbonFeedback?.problemId === problem?.id ? ribbonFeedback : null}/>
          {!folded && <span>{reflectionPending ? "Reflect" : session ? duration(session.elapsedMs) : "Ribbon"}</span>}
        </button>
        {!folded && session && !reflectionPending && <button className="ribbon-pause" type="button" disabled={busy}
          aria-label={handoffPending ? "Review web handoff" : session.running ? "Pause from ribbon" : "Resume from ribbon"}
          onClick={() => void (session.running ? pausePractice() : resumePractice())}>
          {handoffPending ? <Globe2 size={16}/> : session.running ? <Pause size={16}/> : <Play size={16}/>}
        </button>}
        {!folded && canDictate && (!expanded || (panel !== "thought" && !(panel === "desk" && editThread))) && <button type="button" className="ribbon-mic"
          aria-label="Speak a thought" title="Speak a thought" onClick={speakThought} disabled={busy}>
          <Mic size={16}/>
        </button>}
        <span className="drag-handle" aria-label="Drag to move companion" title="Drag to move companion"><span/><span/><span/></span>
      </div>
    </div>
    {palette && expanded && snapshot && <CommandPaletteFlow
      snapshot={snapshot} commands={paletteCommands}
      shortcutLabel={snapshot.presentation?.paletteShortcutAvailable ? paletteShortcut ?? undefined : undefined}
      onClose={() => closePalette()} onOpenDesk={() => openPaletteDesk()}
      onOpenProblem={url => { closePalette(); void ui("open-external", url); }}
    />}
    {previewMode && <div className="preview-footer"><span>SMALL PRESENCE. LASTING LEARNING.</span><a href={`?preview=1&gallery=1${theme === "ink" ? "&theme=ink" : ""}`}>View ribbon states <ArrowUpRight size={11}/></a></div>}
  </main>;
}
function PanelHeading({ eyebrow, title, description }: { eyebrow: string; title: ReactNode; description: string }) { return <div className="intro panel-intro"><span className="eyebrow"><span className="tiny-line"/>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>; }
