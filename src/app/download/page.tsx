import type { Metadata } from "next";
import { MacDownload } from "@/components/mac-site";
import { macDownloadUrl } from "@/lib/mac-download";

export const metadata: Metadata = {
  title: "Download Forma for Mac",
  description: "Get Forma for Apple silicon Macs or try a sample practice session in the browser.",
};

export default function DownloadPage() {
  return <MacDownload downloadUrl={macDownloadUrl()} />;
}
