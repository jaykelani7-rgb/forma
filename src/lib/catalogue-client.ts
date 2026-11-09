import { validateCatalogue, type ProblemCatalogue } from "./discovery";

// The catalogue is public and shared across workspaces. Reuse the response
// across client navigations as well as concurrent requests.
let cachedCatalogue: ProblemCatalogue | null = null;
let catalogueRequest: Promise<ProblemCatalogue> | null = null;

export function getCachedCatalogue() {
  return cachedCatalogue;
}

export async function getCatalogue(): Promise<ProblemCatalogue> {
  if (
    cachedCatalogue &&
    Date.now() - Date.parse(cachedCatalogue.fetchedAt) < 24 * 60 * 60 * 1000
  )
    return cachedCatalogue;
  if (catalogueRequest) return catalogueRequest;
  catalogueRequest = (async () => {
    try {
      const response = await fetch("/api/catalogue", {
        signal: AbortSignal.timeout(30000),
        credentials: "omit",
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error("Unavailable catalogue");
      cachedCatalogue = validateCatalogue(body);
      return cachedCatalogue;
    } catch {
      throw new Error(
        "Fresh discovery is unavailable right now. Your saved problems and revisits are still available.",
      );
    }
  })();
  try {
    return await catalogueRequest;
  } finally {
    catalogueRequest = null;
  }
}
