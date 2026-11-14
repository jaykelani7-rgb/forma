import { MacHome } from "../components/mac-site";
import { macDownloadUrl } from "../lib/site-links";

export default function HomePage() {
  return <MacHome downloadUrl={macDownloadUrl()} />;
}
