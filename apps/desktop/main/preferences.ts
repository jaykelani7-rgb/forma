export interface CompanionPreferences {
  theme: "light" | "ink" | "system";
  reducedMotion: boolean;
  snoozedUntil: string | null;
  shortcut: string;
  position?: { x: number; y: number };
}

export const defaultPreferences = (): CompanionPreferences => ({
  theme: "system",
  reducedMotion: false,
  snoozedUntil: null,
  shortcut: "Control+Option+F",
});

export function validatePreferences(value: unknown): CompanionPreferences {
  if (!value || typeof value !== "object") throw new Error("Invalid companion preferences.");
  const p = value as Record<string, unknown>;
  if (!['light', 'ink', 'system'].includes(String(p.theme)) ||
    typeof p.reducedMotion !== 'boolean' ||
    !(p.snoozedUntil === null || (typeof p.snoozedUntil === 'string' && Number.isFinite(Date.parse(p.snoozedUntil)))) ||
    typeof p.shortcut !== 'string' || p.shortcut.length > 100 ||
    !/^[A-Za-z0-9+]+$/.test(p.shortcut)) throw new Error("Invalid companion preferences.");
  let position: CompanionPreferences['position'];
  if (p.position !== undefined) {
    const at = p.position as { x?: unknown; y?: unknown };
    if (!at || typeof at.x !== 'number' || typeof at.y !== 'number' || !Number.isFinite(at.x) || !Number.isFinite(at.y))
      throw new Error("Invalid window position.");
    position = { x: Math.round(at.x), y: Math.round(at.y) };
  }
  return { theme: p.theme as CompanionPreferences['theme'], reducedMotion: p.reducedMotion, snoozedUntil: p.snoozedUntil as string | null, shortcut: p.shortcut, ...(position ? {position} : {}) };
}

export function clampPosition(position: {x:number;y:number}, size: {width:number;height:number}, area: {x:number;y:number;width:number;height:number}) {
  return { x: Math.round(Math.max(area.x, Math.min(position.x, area.x + area.width - size.width))),
    y: Math.round(Math.max(area.y, Math.min(position.y, area.y + area.height - size.height))) };
}
