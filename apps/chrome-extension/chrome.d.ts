declare const chrome: {
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string }[]> };
  scripting: { executeScript<T>(details: { target: { tabId: number }; func: () => T }): Promise<{ result?: T }[]> };
  runtime: { sendNativeMessage(host: string, message: unknown): Promise<{ ok: boolean; error?: string; proposalId?: string; status?: string; expiresAt?: number; targets?: { id: string; label: string }[] }> };
};
