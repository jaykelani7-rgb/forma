"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceProvider } from "./provider";
import { Shell } from "./shell";
import { InstallSupport } from "./install";

export function WorkspaceBoundary({ children }: { children: ReactNode }) {
  const path = usePathname();
  // An unlisted curriculum preview does not open a notebook.
  if (path.startsWith("/share/")) return children;
  return (
    <WorkspaceProvider>
      <Shell>{children}</Shell>
      <InstallSupport />
    </WorkspaceProvider>
  );
}
