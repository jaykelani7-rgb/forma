export function macDownloadUrl(value = process.env.FORMA_MAC_DOWNLOAD_URL): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && !url.username && !url.password && !url.hash && /\.dmg$/i.test(url.pathname)) {
      return url.href;
    }
  } catch {
    // Missing or invalid release configuration keeps the web workspace at `/`.
  }
  return null;
}
