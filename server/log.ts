import type { Session } from "@github/copilot-sdk/extension";

// The session isn't available until joinSession resolves, so callers set it once
// at startup. Before that, logs are silently dropped.
let session: Session | null = null;

export function setSession(s: Session): void {
  session = s;
}

export function log(message: string, level?: string): void {
  if (session) void session.log(message, level ? { level } : undefined).catch(() => {});
}
