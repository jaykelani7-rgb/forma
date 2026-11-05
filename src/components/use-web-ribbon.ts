"use client";
import { useSyncExternalStore } from "react";
import {
  defaultRibbon,
  readRibbonOptions,
  type RibbonOptions,
} from "../../packages/ribbon/options";
const key = "forma.ribbon.appearance";
const changed = "forma:ribbon-appearance";

function read() {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function subscribe(callback: () => void) {
  function stored(e: StorageEvent) {
    if (e.key === key || e.key === null) callback();
  }
  window.addEventListener("storage", stored);
  window.addEventListener(changed, callback);
  return () => {
    window.removeEventListener("storage", stored);
    window.removeEventListener(changed, callback);
  };
}
export function useWebRibbon(): RibbonOptions {
  const json = useSyncExternalStore(subscribe, read, () => null);
  try {
    return json ? readRibbonOptions(JSON.parse(json)) : defaultRibbon;
  } catch {
    return defaultRibbon;
  }
}

export function saveWebRibbon(value: RibbonOptions) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error(
      "Your browser could not save this appearance. Please try again.",
    );
  }
  window.dispatchEvent(new Event(changed));
}
