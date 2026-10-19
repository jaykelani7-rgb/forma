import type { Metadata } from "next";
import { PublicTrack } from "@/components/public-track";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared practice track · Forma",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <PublicTrack token={(await params).token} />;
}
