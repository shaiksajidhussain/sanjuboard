import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app";

const app = createApp({ serveStatic: false });

export function attach(route: string) {
  return function handler(req: IncomingMessage, res: ServerResponse) {
    const raw = req.url ?? "";
    const queryIndex = raw.indexOf("?");
    const query = queryIndex === -1 ? "" : raw.slice(queryIndex);
    req.url = `${route}${query}`;
    app(req, res);
  };
}
