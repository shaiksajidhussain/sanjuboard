import { describe, expect, it } from "vitest";
import { analyzeDiagram } from "./analyze";
import { blueprintForPrompt, blueprintOperations, openApiOperations } from "./blueprints";
import { planLocally } from "./planner";
import { validateProposal } from "./apply";
import type { SceneNode } from "./schema";

const box = (id: string, x: number, text = id): SceneNode => ({
  id,
  type: "rectangle",
  x,
  y: 40,
  width: 160,
  height: 80,
  text,
  groupIds: [],
});

describe("diagnostics", () => {
  it("marks a dependency cycle as a heuristic and keeps structural errors separate", () => {
    const issues = analyzeDiagram([
      box("api", 40, "API"),
      box("db", 240, "Database"),
      {
        id: "to-db",
        type: "arrow",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fromId: "api",
        toId: "db",
        groupIds: [],
      },
      {
        id: "back",
        type: "arrow",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fromId: "db",
        toId: "api",
        groupIds: [],
      },
      {
        id: "ghost",
        type: "arrow",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fromId: "api",
        toId: "missing",
        groupIds: [],
      },
      box("api", 400, "API again"),
    ]);
    expect(issues.find((issue) => issue.code === "cycle")?.kind).toBe("heuristic");
    expect(issues.find((issue) => issue.code === "missing-target")).toMatchObject({
      kind: "structural",
      severity: "error",
      elementIds: ["ghost"],
    });
    expect(issues.find((issue) => issue.code === "duplicate-id")?.suggestion).toMatch(/id/i);
  });
});

describe("templates and OpenAPI", () => {
  it("proposes a request-path template without applying it", () => {
    const scene = [box("kept", 40, "Kept")];
    const operations = blueprintOperations("request-path", "demo");
    const result = validateProposal(scene, { operations });
    expect(result.ok).toBe(true);
    expect(scene.map((node) => node.id)).toEqual(["kept"]);
    if (!result.ok) return;
    expect(result.proposal.scene.map((node) => node.text)).toEqual(
      expect.arrayContaining(["Kept", "Browser", "API", "Database"]),
    );
  });

  it("turns an OpenAPI document into a proposal and rejects a file with no paths", () => {
    const parsed = openApiOperations(
      JSON.stringify({
        info: { title: "Billing" },
        paths: { "/invoices": { get: {}, post: {} } },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = validateProposal([], { operations: parsed.operations });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.scene.map((node) => node.text)).toEqual(
      expect.arrayContaining(["Billing", "GET /invoices", "POST /invoices"]),
    );
    expect(blueprintForPrompt("Create a web application architecture with a browser and an API.")).toBe("web-app");
    const pipeline = validateProposal([], {
      operations: blueprintOperations("cicd", "pipe"),
    });
    expect(pipeline.ok).toBe(true);
    if (pipeline.ok) {
      const source = pipeline.proposal.scene.find((node) => node.text?.startsWith("Source Control"));
      const ci = pipeline.proposal.scene.find((node) => node.text?.includes("Jenkins"));
      const approval = pipeline.proposal.scene.find((node) => node.text === "Approved?");
      expect(source && ci && approval).toBeTruthy();
      expect(ci!.x).toBeGreaterThan(source!.x + source!.width);
      expect(approval!.type).toBe("diamond");
      expect(pipeline.proposal.scene.some((node) => node.type === "arrow" && node.strokeColor === "#e03131" && node.text === "Fail")).toBe(
        true,
      );
    }
    const architecture = blueprintOperations("web-app", "arch");
    const architectureProposal = validateProposal([], { operations: architecture });
    expect(architectureProposal.ok).toBe(true);
    if (architectureProposal.ok) {
      const shapes = architectureProposal.proposal.scene.filter((node) => node.type !== "arrow");
      expect(shapes.length).toBeGreaterThanOrEqual(8);
      expect(shapes.every((node) => node.width >= 140)).toBe(true);
    }
    const local = planLocally({
      instruction: "Create an ER diagram for patients, visits, and doctors.",
      scene: [],
    });
    const localResult = validateProposal([], local);
    expect(localResult.ok).toBe(true);
    expect(openApiOperations("{").ok).toBe(false);
    expect(openApiOperations('{"info":{}}').ok).toBe(false);
  });
});
