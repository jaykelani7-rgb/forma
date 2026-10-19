import { Tracks } from "@/components/tracks";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ share?: string | string[] }>;
}) {
  const { share } = await searchParams;
  return <Tracks linkedToken={typeof share === "string" ? share : undefined} />;
}
