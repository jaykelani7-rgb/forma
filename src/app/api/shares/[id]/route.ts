import { createShareHandlers } from "@/lib/share-links-server";
export const dynamic = "force-dynamic";
const handlers = createShareHandlers();
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handlers.revoke(request, (await params).id);
}
