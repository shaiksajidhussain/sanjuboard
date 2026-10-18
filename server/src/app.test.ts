import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
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
