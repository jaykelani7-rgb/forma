import { catalogueCache } from "@/lib/catalogue";
import { CodeforcesError } from "@/lib/codeforces-api";

export const runtime = "nodejs";
export async function GET(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length)
    return Response.json(
      { error: "The public catalogue does not accept query parameters." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const catalogue = await catalogueCache.get();
    return Response.json(catalogue, {
      headers: {
        "Cache-Control": catalogue.stale
          ? "public, max-age=60"
          : "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          "Fresh discovery is unavailable right now. Your saved problems and revisits are still available.",
      },
      {
        status: error instanceof CodeforcesError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
