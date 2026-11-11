"use client";

import { useRouter } from "next/navigation";
import { RibbonRehearsal } from "../../packages/ribbon/RibbonRehearsal";

export function MacPreviewSession({ exitHref }: { exitHref: "/" | "/download" }) {
  const router = useRouter();
  return <RibbonRehearsal focusOnOpen={false} onExit={() => router.push(exitHref)} />;
}
