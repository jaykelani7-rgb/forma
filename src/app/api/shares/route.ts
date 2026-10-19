import { createShareHandlers } from "@/lib/share-links-server";
export const dynamic = "force-dynamic";
const handlers = createShareHandlers();
export const GET = handlers.list;
export const POST = handlers.publish;
