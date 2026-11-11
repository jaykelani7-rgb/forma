"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWebRibbon, saveWebRibbon } from "./use-web-ribbon";
import { useWorkspace } from "./provider";

import { RibbonStudio } from "../../packages/ribbon/RibbonStudio";
import { RibbonRehearsal } from "../../packages/ribbon/RibbonRehearsal";

export function WebRibbonSettings() {
  const saved = useWebRibbon();
  const router = useRouter();
  return (
    <RibbonStudio
      saved={saved}
      onRehearse={() => router.push("/rehearsal?from=settings")}
      onSave={async (value) => {
        saveWebRibbon(value);
      }}
    />
  );
}
export function WebRehearsal({ fromSettings }: { fromSettings: boolean }) {
  const router = useRouter();
  const { todayHref } = useWorkspace();
  const back = fromSettings ? "/settings" : todayHref;
  return (
    <div>
      <Link href={back} className="text-link">
        {fromSettings ? "Back to Settings" : "Back to Today"}
      </Link>
      <RibbonRehearsal onExit={() => router.push(back)} />
    </div>
  );
}
