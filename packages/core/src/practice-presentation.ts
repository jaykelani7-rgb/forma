export const OUTCOMES = {
  independent: "Solved independently",
  hint: "Needed a hint",
  editorial: "Needed the editorial",
  unsolved: "Not solved yet",
} as const;

export type Outcome = keyof typeof OUTCOMES;

export function clockTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutesPart = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  const minutesAndSeconds = `${minutesPart}:${secondsPart}`;
  return hours ? `${String(hours).padStart(2, "0")}:${minutesAndSeconds}` : minutesAndSeconds;
}
