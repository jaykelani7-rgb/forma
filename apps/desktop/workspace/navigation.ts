import { useSyncExternalStore } from "react";

const changed = "forma:navigation";

function subscribe(listener: () => void) {
  window.addEventListener(changed, listener);
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
  };
}

function locationPath() {
  const path = window.location.hash.slice(1);
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export function useWorkspaceLocation() {
  return useSyncExternalStore(subscribe, locationPath);
}

export function usePathname() {
  return useWorkspaceLocation().split(/[?#]/, 1)[0];
}

export function navigate(path: string, replace = false, scroll = true) {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  if (path === locationPath()) return;
  if (replace) history.replaceState(null, "", `#${path}`);
  else history.pushState(null, "", `#${path}`);
  window.dispatchEvent(new Event(changed));
  if (scroll) window.scrollTo(0, 0);
}

const router = {
  push: (path: string, options?: { scroll?: boolean }) => navigate(path, false, options?.scroll),
  replace: (path: string, options?: { scroll?: boolean }) => navigate(path, true, options?.scroll),
  back: () => history.back(),
};

export function useRouter() { return router; }
