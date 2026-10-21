/** Explain an unavailable local endpoint without hiding pairing or permission errors. */
export function companionConnectionError(error: Error): Error {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT" && code !== "ECONNREFUSED") return error;
  return Object.assign(new Error("Cannot connect to Forma Companion. Start Forma Companion, then retry this action.", { cause: error }), { code });
}
