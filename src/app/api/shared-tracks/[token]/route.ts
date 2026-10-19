import { createShareHandlers } from "@/lib/share-links-server";
export const dynamic = "force-dynamic";
const handlers = createShareHandlers();
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return handlers.read(request, (await params).token);
}
