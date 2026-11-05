import { WebRehearsal } from "@/components/web-ribbon-settings";

export default async function RehearsalPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  return (
    <WebRehearsal fromSettings={(await searchParams).from === "settings"} />
  );
}
