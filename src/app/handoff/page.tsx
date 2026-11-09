import type { Metadata } from "next";
import { SessionHandoff } from "@/components/session-handoff";

export const metadata: Metadata = {
  title: "Continue in the browser · Forma",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SessionHandoff />;
}
