import type { Metadata } from "next";
import { MacPreview } from "../../components/mac-site";
import { macDownloadUrl } from "../../lib/site-links";
import "../../../../packages/ribbon/studio.css";

export const metadata: Metadata = {
  title: "Try Forma in your browser",
  description: "Explore Forma’s real companion components: session timing, Problem Desk, idea review, small hints, reflections, and recall in a sample practice workspace.",
};

export default function PreviewPage() {
  return <MacPreview releaseAvailable={macDownloadUrl() !== null} />;
}
