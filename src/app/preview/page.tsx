import type { Metadata } from "next";
import { MacPreview } from "@/components/mac-site";
import { macDownloadUrl } from "@/lib/mac-download";

export const metadata: Metadata = {
  title: "Try Forma in your browser",
  description: "Open the Ribbon, run a sample timer, and save a practice reflection in an interactive demo.",
};

export default function PreviewPage() {
  return <MacPreview releaseAvailable={macDownloadUrl() !== null} />;
}
