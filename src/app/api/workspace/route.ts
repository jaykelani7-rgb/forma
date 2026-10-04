import { createCloudHandlers } from "@/lib/cloud-server";
export const dynamic = "force-dynamic";
const handlers = createCloudHandlers();
export const GET = handlers.read;
export const POST = handlers.write;
