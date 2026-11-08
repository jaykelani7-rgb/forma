/* eslint-disable @next/next/no-img-element -- Electron previews local data URLs without a Next.js server. */
import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import {
  ArrowUpRight, ChevronDown, Clock3, Code2, Feather, FileCode2, ImagePlus, Lightbulb, Pencil, Play, Plus, Trash2,
} from "lucide-react";
import { DESK_IMAGE_LIMIT, DESK_THREAD_LIMIT, validateDeskEntry, type DeskEntry } from "../../../packages/contracts/src";
import { RibbonMark } from "../../../packages/ribbon/RibbonMark";
import "./problem-desk.css";

export interface DeskItem extends DeskEntry {
  id: string;
  createdAt: string;
}

interface ProblemDeskProps {
  problemTitle: string;
  elapsed?: string;
  paused?: boolean;
  busy?: boolean;
  items: readonly DeskItem[];
  editThread?: boolean;
  threadDraft: string;
  onThreadDraftChange: (text: string) => void;
  onEditThreadChange: (open: boolean) => void;
  onSave: (item: DeskEntry) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  onResume?: () => void;
  onOpenProblem: () => void;
  onOpenSolution?: () => void;
  voiceControls?: ReactNode;
  hint?: ReactNode;
  onToggleHint?: () => void;
  hintButtonRef?: RefObject<HTMLButtonElement | null>;
}

const TEXT_LIMIT = 10_000;
const SCREENSHOT_SOURCE_LIMIT = 12 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg"];
const tools = [
  { kind: "hypothesis", label: "Hypothesis", icon: Pencil, prompt: "What do you think might work?" },
  { kind: "counterexample", label: "Failing input", icon: Code2, prompt: "Input that breaks the current idea" },
  { kind: "screenshot", label: "Screenshot", icon: ImagePlus, prompt: "What should you notice in this image?" },
] as const;
const codeTool = { label: "VS Code selection", icon: FileCode2 };
const threadTool = { label: "Earlier thread", icon: Feather };
type ToolKind = (typeof tools)[number]["kind"];

function readScreenshot(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Forma couldn’t read that screenshot. Choose it again."));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Forma couldn’t read that screenshot. Choose it again."));
    reader.readAsDataURL(file);
  });
}

function encodeScreenshot(canvas: HTMLCanvasElement, mime: string): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, mime, 0.86));
}

function decodeScreenshot(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file).catch(() => {
    throw new Error("Forma couldn’t open this screenshot. Choose a valid PNG or JPEG.");
  });
}

async function optimizeScreenshot(file: File): Promise<Blob> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const signature = file.type === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255];
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Choose a valid PNG or JPEG screenshot.");
  }
  const image = await decodeScreenshot(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Forma couldn’t resize this screenshot.");
    for (const maxEdge of [1600, 1200, 900, 720]) {
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.imageSmoothingQuality = "high";
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await encodeScreenshot(canvas, file.type === "image/png" && maxEdge === 1600 ? "image/png" : "image/jpeg");
      if (blob && blob.size <= DESK_IMAGE_LIMIT) return blob;
    }
    throw new Error("This screenshot is still too large after resizing. Try a smaller crop.");
  } finally {
    image.close();
  }
}

function SavedItem({ item, busy, onRemove }: {
  item: DeskItem;
  busy: boolean;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const { label, icon: Icon } = item.kind === "thread"
    ? threadTool
    : tools.find(tool => tool.kind === item.kind) ?? codeTool;
  const structured = item.kind === "code" || item.kind === "counterexample";
  return (
    <li>
      <details className="desk-item">
        <summary>
          <span className="desk-item-icon"><Icon size={14} aria-hidden="true"/></span>
          <span className="desk-item-label">
            <strong>{label}</strong>
            <span>{item.text.trim() || "Saved image"}</span>
          </span>
          <ChevronDown size={14} className="desk-item-chevron" aria-hidden="true"/>
        </summary>
        <div className="desk-item-body">
          {item.attachment && <img className="desk-image" src={item.attachment} alt={item.text || "Saved problem screenshot"}/>}
          {item.text && (structured ? <pre>{item.text}</pre> : <p>{item.text}</p>)}
          <button type="button" className="desk-quiet" aria-label={`Remove ${label.toLowerCase()}`}
            disabled={busy} onClick={() => void onRemove(item.id)}>
            <Trash2 size={13} aria-hidden="true"/> Remove
          </button>
        </div>
      </details>
    </li>
  );
}

export function ProblemDesk({
  problemTitle, elapsed, paused = false, busy = false, items, editThread = false,
  threadDraft, onThreadDraftChange, onEditThreadChange, onSave, onRemove,
  onResume, onOpenProblem, onOpenSolution, voiceControls, hint, onToggleHint, hintButtonRef,
}: ProblemDeskProps) {
  const threadId = useId();
  const artifactId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<ToolKind | null>(null);
  const [drafts, setDrafts] = useState<Record<ToolKind, string>>({ hypothesis: "", counterexample: "", screenshot: "" });
  const [screenshot, setScreenshot] = useState<{ name: string; url: string; optimized: boolean } | null>(null);
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const readLock = useRef(false);
  const selected = tools.find(item => item.kind === tool);
  const [latestThread, ...previousThreads] = items.filter(item => item.kind === "thread").reverse();
  const artifacts = items.filter(item => item.kind !== "thread").reverse();

  async function chooseScreenshot(file: File | undefined) {
    if (!file || busy || readLock.current) return;
    setFileError("");
    if (!IMAGE_TYPES.includes(file.type) || !file.size || file.size > SCREENSHOT_SOURCE_LIMIT) {
      setFileError("Choose a PNG or JPEG screenshot up to 12 MB.");
      return;
    }
    readLock.current = true;
    setReading(true);
    try {
      const optimized = file.size > DESK_IMAGE_LIMIT;
      const url = await readScreenshot(optimized ? await optimizeScreenshot(file) : file);
      validateDeskEntry({ kind: "screenshot", text: "", attachment: url });
      if (!optimized) (await decodeScreenshot(file)).close();
      setScreenshot({ name: file.name, url, optimized });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Forma couldn’t read that screenshot.");
    } finally {
      readLock.current = false;
      setReading(false);
    }
  }

  async function saveThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !threadDraft.trim() || threadDraft.length > DESK_THREAD_LIMIT) return;
    if (await onSave({ kind: "thread", text: threadDraft })) {
      onThreadDraftChange("");
      onEditThreadChange(false);
    }
  }

  async function saveArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tool || busy || reading) return;
    const text = drafts[tool];
    if (tool === "screenshot" ? !screenshot : !text.trim()) return;
    const attachment = tool === "screenshot" ? screenshot?.url : undefined;
    if (await onSave({ kind: tool, text, ...(attachment ? { attachment } : {}) })) {
      setDrafts(current => ({ ...current, [tool]: "" }));
      if (attachment) {
        setScreenshot(null);
        setFileError("");
      }
      setTool(null);
    }
  }

  return (
    <div className="problem-desk">
      <header className="desk-heading">
        <div className="desk-eyebrow-row">
          <span className="eyebrow">PROBLEM DESK</span>
          {elapsed && <span className="desk-elapsed"><Clock3 size={12} aria-hidden="true"/>{paused && "Paused · "}{elapsed}</span>}
        </div>
        <h1>{problemTitle}</h1>
      </header>

      <section className="desk-thread" aria-label="Continue your thinking">
        <div className="desk-thread-label">
          <RibbonMark size={24}/>
          <span className="eyebrow">WHERE YOU LEFT OFF</span>
          {latestThread && <button type="button" className="desk-quiet desk-thread-remove" aria-label="Remove saved thread"
            title="Remove saved thread" disabled={busy} onClick={() => void onRemove(latestThread.id)}>
            <Trash2 size={13} aria-hidden="true"/>
          </button>}
        </div>
        {latestThread ? <>
          <blockquote>{latestThread.text}</blockquote>
          <time className="desk-saved-time" dateTime={latestThread.createdAt}>
            {new Date(latestThread.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </time>
        </> : <p className="desk-thread-empty">Leave a sentence for the next time you open this problem.</p>}
        {editThread ? (
          <form className="desk-editor" onSubmit={event => void saveThread(event)}>
            <label htmlFor={threadId}>What would you try next?</label>
            <textarea id={threadId} value={threadDraft} rows={3} maxLength={DESK_THREAD_LIMIT}
              placeholder="I’d test what happens when…" disabled={busy} autoFocus
              onChange={event => onThreadDraftChange(event.target.value)}/>
            {threadDraft.length > DESK_THREAD_LIMIT && <p className="inline-error" role="alert">Shorten your thread to 1,000 characters before saving.</p>}
            {voiceControls}
            <div className="desk-editor-actions">
              <button type="submit" className="desk-primary"
                disabled={busy || !threadDraft.trim() || threadDraft.length > DESK_THREAD_LIMIT}>Save thread</button>
              <button type="button" className="desk-quiet" disabled={busy} onClick={() => onEditThreadChange(false)}>Skip for now</button>
            </div>
          </form>
        ) : (
          <button type="button" className="desk-quiet desk-write-thread" disabled={busy} onClick={() => onEditThreadChange(true)}>
            <Pencil size={13} aria-hidden="true"/>{threadDraft ? "Continue draft" : latestThread ? "Leave a new thread" : "Leave a thread"}
          </button>
        )}
        {!!previousThreads.length && <details className="desk-thread-history">
          <summary>Earlier threads ({previousThreads.length})</summary>
          <ul className="desk-items">
            {previousThreads.map(item => <SavedItem key={item.id} item={item} busy={busy} onRemove={onRemove}/>)}
          </ul>
        </details>}
      </section>

      {onToggleHint && <div className="desk-hint-slot">
        <button ref={hintButtonRef} type="button" className="desk-tool desk-hint-trigger"
          aria-expanded={!!hint} disabled={busy} onClick={onToggleHint}>
          <Lightbulb size={15} aria-hidden="true"/> I’m stuck
        </button>
        {hint}
      </div>}

      <div className="desk-return">
        {onResume && <button type="button" className="button" disabled={busy} onClick={onResume}>
          Resume session <Play size={14} aria-hidden="true"/>
        </button>}
        <div className="desk-links">
          {onOpenSolution && <button type="button" className="desk-quiet" disabled={busy} onClick={onOpenSolution}>
            <FileCode2 size={14} aria-hidden="true"/> Open solution
          </button>}
          <button type="button" className="desk-quiet" disabled={busy} onClick={onOpenProblem}>
            Open problem <ArrowUpRight size={14} aria-hidden="true"/>
          </button>
        </div>
      </div>

      <section className="desk-working" aria-label="Working notes">
        <div className="desk-eyebrow-row">
          <h2 className="eyebrow">ON YOUR DESK</h2>
          <span className="desk-count">{artifacts.length} {artifacts.length === 1 ? "item" : "items"}</span>
        </div>
        {!!artifacts.length && <ul className="desk-items">
          {artifacts.map(item => <SavedItem key={item.id} item={item} busy={busy} onRemove={onRemove}/>)}
        </ul>}
        <div className="desk-tools" aria-label="Add to desk">
          {tools.map(({ kind, label, icon: Icon }) => (
            <button type="button" className="desk-tool" key={kind}
              aria-expanded={tool === kind} disabled={busy || reading}
              onClick={() => setTool(current => current === kind ? null : kind)}>
              <Icon size={13} aria-hidden="true"/> {label}
            </button>
          ))}
        </div>
        {selected && (
          <form className="desk-editor desk-artifact-editor" onSubmit={event => void saveArtifact(event)}>
            {selected.kind === "screenshot" && <>
              <div className="desk-drop" onDragOver={event => event.preventDefault()} onDrop={event => {
                event.preventDefault();
                void chooseScreenshot(event.dataTransfer.files[0]);
              }}>
                <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} aria-label="Choose screenshot file"
                  hidden disabled={busy || reading} onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void chooseScreenshot(file);
                  }}/>
                <button type="button" className="desk-quiet" disabled={busy || reading} onClick={() => fileInput.current?.click()}>
                  <ImagePlus size={15} aria-hidden="true"/> {screenshot ? "Choose another screenshot" : "Choose a screenshot"}
                </button>
                <span>or drop a PNG or JPEG up to 12 MB</span>
              </div>
              {reading && <p className="desk-file-name" role="status">Reading screenshot…</p>}
              {fileError && <p className="inline-error" role="alert">{fileError}</p>}
              {screenshot && <div className="desk-preview">
                <img className="desk-image" src={screenshot.url} alt="Screenshot to save"/>
                <span className="desk-file-name">{screenshot.name}</span>
                {screenshot.optimized && <span className="desk-file-name">Optimized on this device to fit the desk.</span>}
              </div>}
            </>}
            <label htmlFor={artifactId}>{selected.kind === "screenshot" ? "Caption (optional)" : selected.label}</label>
            <textarea id={artifactId} value={drafts[selected.kind]} placeholder={selected.prompt}
              rows={selected.kind === "screenshot" ? 2 : 3} maxLength={TEXT_LIMIT} disabled={busy}
              className={selected.kind === "counterexample" ? "desk-mono" : undefined}
              onChange={event => setDrafts(current => ({ ...current, [selected.kind]: event.target.value }))}/>
            <button type="submit" className="desk-primary"
              disabled={busy || reading || (selected.kind === "screenshot" ? !screenshot : !drafts[selected.kind].trim())}>
              <Plus size={13} aria-hidden="true"/> Save to desk
            </button>
          </form>
        )}
        <p className="desk-code-help"><FileCode2 size={14} aria-hidden="true"/>
          <span>In VS Code, select your code and run <strong>Forma: Pin Selection to Desk</strong>.</span>
        </p>
      </section>
    </div>
  );
}
