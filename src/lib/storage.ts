import { Data, emptyData, validateData } from "./model";

export type Mode = "personal" | "demo";
export const STORAGE_KEYS = { personal: "forma.personal.v1", demo: "forma.demo.v1", mode: "forma.mode", theme: "forma.theme" };
export interface StorageAdapter { load(mode: Mode): Data | null; save(mode: Mode, data: Data): void; }
// The only persistence boundary. Replace this adapter to add a backend later.
export const browserStorage: StorageAdapter = {
  load(mode) {
    const raw = localStorage.getItem(STORAGE_KEYS[mode]);
    return raw ? validateData(JSON.parse(raw)) : null;
  },
  save(mode, data) { localStorage.setItem(STORAGE_KEYS[mode], JSON.stringify(data)); },
};
export function loadPersonal(): { data: Data; error: string | null } {
  try { return { data: browserStorage.load("personal") ?? emptyData(), error: null }; }
  catch { return { data: emptyData(), error: "Saved data could not be read. Your original storage is preserved; new changes stay in this tab. Export a backup in Settings." }; }
}
