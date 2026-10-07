import { Tracks } from "@/components/tracks";
export default async function Page({
  params,
}: {
  params: Promise<{ trackId: string }>;
}) {
  const { trackId } = await params;
  return <Tracks trackId={trackId} />;
}
