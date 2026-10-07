import { Tracks } from "@/components/tracks";
export default async function Page({
  params,
}: {
  params: Promise<{ trackId: string; stageId: string }>;
}) {
  const { trackId, stageId } = await params;
  return <Tracks trackId={trackId} stageId={stageId} />;
}
