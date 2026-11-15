import type { Metadata } from "next";
import { MacDownload } from "../../components/mac-site";
import { macDownloadUrl } from "../../lib/site-links";

export const metadata: Metadata = {
  title: "Download Forma for Mac",
  description:
    "Forma for Mac is ready. Join the waitlist for Forma for Windows, now in development.",
};

export default function DownloadPage() {
  return <MacDownload downloadUrl={macDownloadUrl()} />;
}
