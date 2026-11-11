import { Today } from "@/components/today";
import { MacHome } from "@/components/mac-site";
import { macDownloadUrl } from "@/lib/mac-download";

export default function Page() {
  const downloadUrl = macDownloadUrl();
  return downloadUrl ? <MacHome downloadUrl={downloadUrl} /> : <Today />;
}
