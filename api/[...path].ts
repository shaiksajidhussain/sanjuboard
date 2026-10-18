import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/src/app";

const app = createApp({ serveStatic: false });

export function toApiUrl(url: string | undefined): string {
  const value = url && url.length > 0 ? url : "/";
  const queryIndex = value.indexOf("?");
  const path = queryIndex === -1 ? value : value.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : value.slice(queryIndex);
  if (path === "/api" || path.startsWith("/api/")) return `${path}${query}`;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `/api${suffix}${query}`;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = toApiUrl(req.url);
  app(req, res);
}
