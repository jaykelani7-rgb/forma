/** Device presentation preferences are independent of notebook backups and account sync. */
export interface RibbonOptions {
  shape: "strip" | "fold";
  motion: "gentle" | "still";
  edge: "free" | "left" | "right";
}

export const defaultRibbon: RibbonOptions = {
  shape: "strip",
  edge: "free",
  motion: "gentle",
};

export function readRibbonOptions(value: unknown): RibbonOptions {
  if (!value || typeof value !== "object")
    throw new Error("Choose a valid ribbon appearance.");
  const { shape, edge, motion } = value as Record<string, unknown>;
  if (
    (shape !== "strip" && shape !== "fold") ||
    (motion !== "gentle" && motion !== "still") ||
    (edge !== "free" && edge !== "left" && edge !== "right")
  )
    throw new Error("Choose a valid ribbon shape and resting place.");
  return { shape, edge, motion };
}
