import { defaultRibbon, readRibbonOptions, type RibbonOptions } from "../../../packages/ribbon/options";
export const DEFAULT_THOUGHT_SHORTCUT = "Control+Option+R";
export const DEFAULT_PALETTE_SHORTCUT = "Control+Option+K";

export interface CompanionPreferences {
  theme: "light" | "ink" | "system";
  reducedMotion: boolean;
  snoozedUntil: string | null;
  shortcut: string;
  thoughtShortcut: string | null;
  paletteShortcut: string | null;
  ribbon: RibbonOptions;
  position?: { x: number; y: number };
}

export const defaultPreferences = (): CompanionPreferences => ({
  theme: "system",
  reducedMotion: false,
  ribbon: {...defaultRibbon},
  snoozedUntil: null,
  shortcut: "Control+Option+F",
  thoughtShortcut: DEFAULT_THOUGHT_SHORTCUT,
  paletteShortcut: DEFAULT_PALETTE_SHORTCUT,
});

export function validateModifiedShortcut(value: unknown, example: string): string | null {
  if (value === null) return null;
  const modifiers = /^(cmd|command|ctrl|control|commandorcontrol|cmdorctrl|alt|option|super|meta)$/i;
  if (typeof value === "string" && value.length <= 100 && /^[A-Za-z0-9+]+$/.test(value)) {
    const parts = value.split("+");
    const key = parts.at(-1);
    if (parts.every(Boolean) && key && !modifiers.test(key) && !/^shift$/i.test(key) &&
        parts.slice(0, -1).some(part => modifiers.test(part))) return value;
  }
  throw new Error(`Enter a shortcut with a modifier and a key, such as ${example}.`);
}

export function validatePreferences(value: unknown): CompanionPreferences {
  if (!value || typeof value !== "object") throw new Error("Invalid companion preferences.");
  const p = value as Record<string, unknown>;
  if (!['light', 'ink', 'system'].includes(String(p.theme)) ||
    typeof p.reducedMotion !== 'boolean' ||
    !(p.snoozedUntil === null || (typeof p.snoozedUntil === 'string' && Number.isFinite(Date.parse(p.snoozedUntil)))) ||
    typeof p.shortcut !== 'string' || p.shortcut.length > 100 ||
    !/^[A-Za-z0-9+]+$/.test(p.shortcut)) throw new Error("Invalid companion preferences.");
  const thoughtShortcut = validateModifiedShortcut(p.thoughtShortcut === undefined
    ? DEFAULT_THOUGHT_SHORTCUT : p.thoughtShortcut, DEFAULT_THOUGHT_SHORTCUT);
  const paletteShortcut = validateModifiedShortcut(p.paletteShortcut === undefined
    ? DEFAULT_PALETTE_SHORTCUT : p.paletteShortcut, DEFAULT_PALETTE_SHORTCUT);
  let position: CompanionPreferences['position'];
  if (p.position !== undefined) {
    const at = p.position as { x?: unknown; y?: unknown };
    if (!at || typeof at.x !== 'number' || typeof at.y !== 'number' || !Number.isFinite(at.x) || !Number.isFinite(at.y))
      throw new Error("Invalid window position.");
    position = { x: Math.round(at.x), y: Math.round(at.y) };
  }
  return { ribbon: p.ribbon === undefined ? {...defaultRibbon} : readRibbonOptions(p.ribbon), theme: p.theme as CompanionPreferences['theme'], reducedMotion: p.reducedMotion, snoozedUntil: p.snoozedUntil as string | null, shortcut: p.shortcut, thoughtShortcut, paletteShortcut, ...(position ? {position} : {}) };
}

export function clampPosition(position: {x:number;y:number}, size: {width:number;height:number}, area: {x:number;y:number;width:number;height:number}) {
  return { x: Math.round(Math.max(area.x, Math.min(position.x, area.x + area.width - size.width))),
    y: Math.round(Math.max(area.y, Math.min(position.y, area.y + area.height - size.height))) };
}
