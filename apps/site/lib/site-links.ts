function httpUrl(value: string | undefined): URL | null {
  const address = value?.trim();
  if (!address) return null;
  try {
    const url = new URL(address);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function macDownloadUrl(value = process.env.FORMA_MAC_DOWNLOAD_URL): string | null {
  const url = httpUrl(value);
  return url?.protocol === "https:" && !url.hash && /\.dmg$/i.test(url.pathname) ? url.href : null;
}

export function webNotebookOrigin(value = process.env.FORMA_NOTEBOOK_ORIGIN): string | null {
  const url = httpUrl(value ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001" : undefined));
  return url?.pathname === "/" && !url.search && !url.hash ? url.origin : null;
}
