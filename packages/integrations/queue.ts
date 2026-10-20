import type { TransportCommand } from "./protocol";

export const MAX_QUEUED_COMMANDS = 128;
export const MAX_QUEUE_BYTES = 1024 * 1024;
export type QueuedCommand = { command: TransportCommand; enqueuedAt: number; attempts: number; nextAttemptAt: number; blocked?: string };

export function enqueueCommand(queue: QueuedCommand[], command: TransportCommand, now: number): QueuedCommand[] {
  if (queue.some((entry) => entry.command.id === command.id)) return queue;
  const next = [...queue, { command, enqueuedAt: now, attempts: 0, nextAttemptAt: now }];
  if (next.length > MAX_QUEUED_COMMANDS || Buffer.byteLength(JSON.stringify(next)) > MAX_QUEUE_BYTES) throw new Error("The local companion queue is full. Reconnect before capturing more.");
  return next;
}

export function retryCommand(entry: QueuedCommand, now: number): QueuedCommand {
  const attempts = Math.min(entry.attempts + 1, 100000);
  return { ...entry, attempts, nextAttemptAt: now + Math.min(60000, 1000 * 2 ** Math.min(attempts - 1, 6)) };
}

export function restoreQueue(value: unknown): QueuedCommand[] {
  if (!Array.isArray(value) || value.length > MAX_QUEUED_COMMANDS || Buffer.byteLength(JSON.stringify(value)) > MAX_QUEUE_BYTES) throw new Error("The local companion queue needs recovery; existing captures have been preserved.");
  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || !item.command || typeof item.command.id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(item.command.id) || ids.has(item.command.id) || typeof item.command.type !== "string" || typeof item.command.payload !== "object" || item.command.payload === null || Array.isArray(item.command.payload) || !Number.isFinite(item.enqueuedAt) || !Number.isSafeInteger(item.attempts) || item.attempts < 0 || !Number.isFinite(item.nextAttemptAt) || (item.blocked !== undefined && typeof item.blocked !== "string")) throw new Error("The local companion queue needs recovery; existing captures have been preserved.");
    ids.add(item.command.id);
  }
  return value as QueuedCommand[];
}
