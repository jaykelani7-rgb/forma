import type { RecognitionView } from "../../../packages/integrations/recognition";
import type { Data } from "../../../src/lib/model";
import type { CompanionState } from "../../../packages/core/src/companion";
import type { CompanionCommand } from "../../../packages/contracts/src";

export interface CompanionSnapshot {
  today?: ReturnType<typeof import("../../../packages/core/src/companion-today").companionToday>;
  tutorAssistance?:{shown:number;hintLevels:number[];actions:string[]}|null;
  data: Data;
  state: CompanionState;
  revision: number;
  savedAt: string;
  integration: { connected: boolean; paired: boolean; browserEnabled?: boolean; browserSupported?: boolean; status: string };
  preferences: { theme: "light" | "ink" | "system"; reducedMotion: boolean; snoozedUntil: string | null; shortcut?: string };
  codeforces: { checking: boolean; checkedAt: string | null; error: string | null };
  presentation?: { expanded: boolean; verdict?: {id:string;title:string;message:string}|null; activeFileUri?: string | null; recognition?: RecognitionView; panelRequest?: { id: number; panel: "home" | "memory" | "today" | "tutor";conversationId?:string } };
}
export interface FormaBridge {
  getSnapshot(): Promise<CompanionSnapshot>;
  command(command: CompanionCommand): Promise<CompanionSnapshot>;
  subscribeTutor?(listener:(event:import("../../../packages/tutor/types").TutorEvent)=>void):()=>void;
  subscribe(listener: (snapshot: CompanionSnapshot) => void): () => void;
  ui(action: string, payload?: unknown): Promise<unknown>;
}
declare global { interface Window { forma?: FormaBridge } }
export const previewMode = new URLSearchParams(location.search).get("preview") === "1";

export async function connectBridge(): Promise<FormaBridge> {
  if (window.forma) return window.forma;
  if (previewMode) return (await import("./preview")).createPreviewBridge();
  throw new Error("The secure desktop connection is unavailable. Open Forma Companion from the desktop app or its menu-bar icon.");
}
