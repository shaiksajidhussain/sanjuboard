import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { toApiUrl } from "../../api/[...path]";
import { createApp, type DiagramAssistant } from "./app";

const servers: Array<{ close: () => void }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close();
          resolve();
        }),
    ),
  );
});

async function listen(assistant?: DiagramAssistant) {
  const app = createApp(assistant ? { assistant } : {});
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  servers.push({
    close: () => server.close(),
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("AI endpoint", () => {
  it("returns valid operations from the local planner", async () => {
    const base = await listen({
      name: "local",
      async propose(input) {
        const { planLocally } = await import("@canvasai/shared");
        return planLocally(input);
      },
    });
    const response = await fetch(`${base}/api/ai/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: "Add a rectangle labeled Cache.",
        scene: [],
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proposal.operations[0]).toMatchObject({ op: "add_shape", text: "Cache" });
  });

  it("rejects invalid model output", async () => {
    const base = await listen({
      name: "bad-model",
      async propose() {
        return { operations: [{ op: "shell", command: "id" }] };
      },
    });
    const response = await fetch(`${base}/api/ai/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "Do something", scene: [] }),
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toMatch(/nothing was changed/i);
  });

  it("returns a provider error without an empty crash body", async () => {
    const base = await listen({
      name: "down",
      async propose() {
        throw new Error("upstream timeout");
      },
    });
    const response = await fetch(`${base}/api/ai/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "Add a box", scene: [] }),
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toMatch(/upstream timeout/);
    expect(body.error).toMatch(/not changed/i);
  });
});

describe("T10 server validation", () => {
  it("rejects a request that is missing an instruction", async () => {
    const base = await listen();
    const response = await fetch(`${base}/api/ai/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene: [] }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/not changed|invalid|required/i);
  });

  it("drops file bytes before the model sees the scene and does not echo a credential", async () => {
    const marker = "test-credential-marker";
    let seen: unknown;
    const base = await listen({
      name: "recorder",
      async propose(input) {
        seen = input;
        return { operations: [] };
      },
    });
    const response = await fetch(`${base}/api/ai/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${marker}` },
      body: JSON.stringify({
        instruction: "Add a label",
        scene: [
          {
            id: "api",
            type: "rectangle",
            x: 1,
            y: 2,
            width: 10,
            height: 10,
            text: "API",
            dataURL: "data:image/png;base64,AAAA",
            apiKey: marker,
          },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(seen)).not.toMatch(/dataURL|apiKey|AAAA/);
    expect(JSON.stringify(body)).not.toContain(marker);
    expect(JSON.stringify(await (await fetch(`${base}/api/health`)).json())).not.toContain(marker);
  });
});

describe("Vercel API paths", () => {
  it("keeps assistant routes under /api", () => {
    expect(toApiUrl("/api/health")).toBe("/api/health");
    expect(toApiUrl("/ai/propose?x=1")).toBe("/api/ai/propose?x=1");
    expect(toApiUrl(undefined)).toBe("/api/");
  });
});
