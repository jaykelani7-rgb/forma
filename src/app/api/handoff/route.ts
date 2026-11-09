import { createHandoffHandler } from "@/lib/handoff-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createHandoffHandler();
