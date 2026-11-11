"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceProvider } from "./provider";
import { Shell } from "./shell";
import { InstallSupport } from "./install";

export function WorkspaceBoundary({ children, publicHome = false }: { children: ReactNode; publicHome?: boolean }) {
  const path = usePathname();
  // Public browsing and rehearsal never initialize, reconcile or sync a notebook.
  if (path === "/preview" || path === "/download" || (publicHome && path === "/") || path.startsWith("/share/")) {
    return children;
  }
  return (
    <WorkspaceProvider todayHref={publicHome ? "/today" : "/"}>
      <Shell>{children}</Shell>
      <InstallSupport />
    </WorkspaceProvider>
  );
}
