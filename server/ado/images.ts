import https from "node:https";
import { adoAccessToken } from "./client.ts";

export interface FetchedImage {
  status: number;
  contentType: string;
  body: Buffer;
}

// Only ADO hosts are proxied, so this can't be turned into an open relay.
export function isAllowedImageHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.endsWith("visualstudio.com") || host.endsWith("dev.azure.com");
  } catch {
    return false;
  }
}

function getOnce(url: string, token: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  const headers: Record<string, string> = { Accept: "image/*" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
  });
}

// Fetch an ADO attachment with the user's bearer token, following redirects (up
// to 3). The bearer is only sent to allowlisted ADO hosts; a redirect to blob
// storage is followed without the auth header.
export async function fetchAdoImage(url: string): Promise<FetchedImage> {
  const token = await adoAccessToken();
  let current = url;
  for (let i = 0; i < 4; i++) {
    const sendAuth = isAllowedImageHost(current);
    const r = await getOnce(current, sendAuth ? token : "");
    const loc = r.headers.location;
    if (r.status >= 300 && r.status < 400 && typeof loc === "string") {
      current = new URL(loc, current).toString();
      continue;
    }
    const contentType = (r.headers["content-type"] as string) || "application/octet-stream";
    return { status: r.status, contentType, body: r.body };
  }
  throw new Error("too many redirects");
}
