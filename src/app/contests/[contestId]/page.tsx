import { ContestLab } from "@/components/contest-lab";
export default async function Page({
  params,
}: {
  params: Promise<{ contestId: string }>;
}) {
  const { contestId } = await params;
  return <ContestLab contestId={contestId} />;
}
