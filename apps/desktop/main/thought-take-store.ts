import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const THOUGHT_AUDIO_LIMIT = 8 * 1024 * 1024;
const ENCRYPTED_TAKE_LIMIT = 12 * 1024 * 1024;
const TAKE_LIMIT = 4;

export interface ThoughtTakeMetadata {
  id: string;
  problemKey: string;
  title: string;
  recordedAt: string;
}

export interface ThoughtTakeScope {
  problemId: string;
  profileKey: string | null;
  recoveryEpoch: string;
}

export interface ThoughtTake extends ThoughtTakeMetadata, ThoughtTakeScope {
  bytes: Uint8Array;
  mime: string;
}

interface TakeProtection {
  available(): boolean;
  encrypt(value: string): Uint8Array;
  decrypt(value: Uint8Array): string;
}

export type ThoughtTakes = Pick<ThoughtTakeStore, "list" | "keep" | "read" | "remove">;

export function isThoughtAudio(bytes: unknown, mime: unknown): bytes is Uint8Array {
  return bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= THOUGHT_AUDIO_LIMIT
    && typeof mime === "string" && mime.length <= 128
    && ["audio/webm", "audio/mp4"].includes(mime.split(";")[0].trim().toLowerCase());
}

/** A separate profile-local database. Portable notebooks and backups never read it. */
export class ThoughtTakeStore {
  private db: DatabaseSync | null = null;

  constructor(private readonly path: string, private readonly protection: TakeProtection) {}

  list(): ThoughtTakeMetadata[] {
    if (!existsSync(this.path)) return [];
    return this.connection().prepare(`SELECT id, problem_key AS problemKey, title, recorded_at AS recordedAt
      FROM thought_takes ORDER BY recorded_at DESC, id`).all() as unknown as ThoughtTakeMetadata[];
  }

  keep(take: ThoughtTake): void {
    if (!this.protection.available()) throw new Error("Protected recording storage is unavailable.");
    const { id, problemKey, title, recordedAt, problemId, profileKey, recoveryEpoch, bytes, mime } = take;
    if (!isThoughtAudio(bytes, mime)) throw new Error("This recording could not be protected.");
    let sealed: Uint8Array;
    try {
      sealed = this.protection.encrypt(JSON.stringify({
        id, problemKey, problemId, profileKey, recoveryEpoch, mime, audio: Buffer.from(bytes).toString("base64"),
      }));
      if (!sealed.byteLength || sealed.byteLength > ENCRYPTED_TAKE_LIMIT) throw new Error();
    } catch {
      throw new Error("This recording could not be protected.");
    }
    const result = this.connection().prepare(`INSERT INTO thought_takes (id,problem_key,title,recorded_at,sealed)
      SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM thought_takes) < ?`)
      .run(id, problemKey, title, recordedAt, sealed, TAKE_LIMIT);
    if (!result.changes) throw new Error(`The ${TAKE_LIMIT} saved recording slots are full. Discard or retry a saved recording to make room.`);
  }

  read(id: string): ThoughtTake | null {
    if (!existsSync(this.path)) return null;
    const row = this.connection().prepare(`SELECT id, problem_key AS problemKey, title, recorded_at AS recordedAt, sealed
      FROM thought_takes WHERE id=?`).get(id) as (ThoughtTakeMetadata & { sealed: Uint8Array }) | undefined;
    if (!row) return null;
    if (!this.protection.available()) throw new Error("Unlock protected recording storage on this device to retry.");
    try {
      if (!(row.sealed instanceof Uint8Array) || row.sealed.byteLength > ENCRYPTED_TAKE_LIMIT) throw new Error();
      const { id: sealedId, problemKey, problemId, profileKey, recoveryEpoch, mime, audio } = JSON.parse(this.protection.decrypt(row.sealed));
      if (sealedId !== id || problemKey !== row.problemKey || typeof problemId !== "string" || !problemId
        || (profileKey !== null && typeof profileKey !== "string") || typeof recoveryEpoch !== "string" || !recoveryEpoch
        || typeof mime !== "string" || typeof audio !== "string" || audio.length > Math.ceil(THOUGHT_AUDIO_LIMIT / 3) * 4) throw new Error();
      const bytes = Buffer.from(audio, "base64");
      if (bytes.toString("base64") !== audio || !isThoughtAudio(bytes, mime)) throw new Error();
      return { id, problemKey, title: row.title, recordedAt: row.recordedAt, problemId, profileKey, recoveryEpoch, bytes, mime };
    } catch {
      throw new Error("This saved recording could not be opened. Discard it or record again.");
    }
  }

  remove(id: string): void {
    if (existsSync(this.path)) this.connection().prepare("DELETE FROM thought_takes WHERE id=?").run(id);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private connection(): DatabaseSync {
    if (this.db) return this.db;
    const db = new DatabaseSync(this.path);
    try {
      chmodSync(this.path, 0o600);
      db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
        CREATE TABLE IF NOT EXISTS thought_takes (
          id TEXT PRIMARY KEY, problem_key TEXT NOT NULL, title TEXT NOT NULL, recorded_at TEXT NOT NULL,
          sealed BLOB NOT NULL CHECK(length(sealed) BETWEEN 1 AND ${ENCRYPTED_TAKE_LIMIT})
        );`);
      this.db = db;
      return db;
    } catch {
      db.close();
      throw new Error("Local recording storage could not be opened.");
    }
  }
}
