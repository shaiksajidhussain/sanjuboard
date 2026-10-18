import { describe, expect, it } from "vitest";
import { analyzeDiagram } from "./analyze";
import { commitScene, restoreScene, sceneSignature, validateProposal } from "./apply";
import { extractJson, requestProposal } from "./assistant";
import { planLocally } from "./planner";
import type { SceneNode } from "./schema";

const api: SceneNode = {
  id: "api",
  type: "rectangle",
  x: 80,
  y: 160,
  width: 180,
  height: 88,
  text: "API",
  groupIds: [],
  backgroundColor: "#d0ebff",
  strokeColor: "#1e1e1e",
};

const database: SceneNode = {
  id: "db",
  type: "ellipse",
  x: 560,
  y: 160,
  width: 180,
  height: 88,
  text: "PostgreSQL",
  groupIds: [],
  backgroundColor: "#d3f9d8",
  strokeColor: "#1e1e1e",
};

const bystander: SceneNode = {
  id: "notes",
  type: "rectangle",
  x: 80,
  y: 420,
  width: 160,
  height: 80,
  text: "Notes",
  groupIds: [],
};

function snapshot(scene: readonly SceneNode[]): SceneNode[] {
  return scene.map((node) => ({ ...node, groupIds: [...node.groupIds] }));
}

describe("structured diagram operations", () => {
  it("turns a natural-language instruction into valid operations", () => {
    const scene = [api, database, bystander];
    const before = snapshot(scene);
    const planned = planLocally({
      instruction: "Add a Redis cache between the API and PostgreSQL.",
      scene,
    });
    const result = validateProposal(scene, planned);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(scene).toEqual(before);
    expect(result.proposal.changes.some((change) => change.kind === "add" && change.summary.includes("Redis"))).toBe(
      true,
    );
    expect(result.proposal.scene.some((node) => /redis/i.test(node.text ?? ""))).toBe(true);
    expect(result.proposal.scene.find((node) => node.id === "api")).toMatchObject({ x: 80, y: 160, text: "API" });
    expect(result.proposal.scene.find((node) => node.id === "notes")).toEqual(bystander);
    expect(result.proposal.convertIds).not.toContain("notes");
    expect(result.proposal.convertIds).toContain("api");
    expect(result.proposal.convertIds).toContain("db");
  });

  it("accepts a triangle and maps circle and square names", () => {
    const result = validateProposal([], {
      operations: [
        { op: "add_shape", id: "warn", type: "triangle", x: 40, y: 40, text: "Alert" },
        { op: "add_shape", id: "user", type: "circle", x: 240, y: 40, text: "User" },
        { op: "add_shape", id: "box", type: "square", x: 440, y: 40, text: "Service" },
        { op: "add_arrow", id: "link", fromId: "warn", toId: "user" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.scene.map((node) => node.type)).toEqual(["triangle", "ellipse", "rectangle", "arrow"]);
    expect(result.proposal.changes[0]?.summary).toMatch(/triangle/i);
  });

  it("keeps a triangle when the model sends a loose color", () => {
    const result = validateProposal([], {
      operations: [
        {
          op: "add_shape",
          id: "warn",
          type: "triangle",
          x: 40,
          y: 40,
          text: "Alert",
          backgroundColor: "yellow",
          strokeColor: "#000",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.scene[0]).toMatchObject({
      type: "triangle",
      backgroundColor: "#ffd43b",
      strokeColor: "#000000",
    });
  });

  it("rejects malformed operations and leaves the scene untouched", () => {
    const scene = [api];
    const before = snapshot(scene);
    const result = validateProposal(scene, {
      operations: [{ op: "exec", command: "rm -rf /" }],
    });
    expect(result.ok).toBe(false);
    expect(scene).toEqual(before);
    if (result.ok) return;
    expect(result.error).toMatch(/Nothing was changed/);
  });

  it("rejects a delete that names an unknown element", () => {
    const result = validateProposal([api], {
      operations: [{ op: "delete_shape", id: "missing", confirmDelete: true }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a delete that is not explicitly confirmed", () => {
    const result = validateProposal([api], {
      operations: [{ op: "delete_shape", id: "api" }],
    });
    expect(result.ok).toBe(false);
  });

  it("keeps the original scene when a proposal is rejected", () => {
    const scene = [api, database];
    const planned = planLocally({
      instruction: "Add a Redis cache between the API and PostgreSQL.",
      scene,
    });
    const result = validateProposal(scene, planned);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(commitScene(scene, result.proposal, "reject")).toBe(scene);
  });

  it("applies an accepted proposal only to the intended elements", () => {
    const scene = [api, database, bystander];
    const result = validateProposal(
      scene,
      planLocally({ instruction: "Add a Redis cache between the API and PostgreSQL.", scene }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = commitScene(scene, result.proposal, "accept");
    expect(next).not.toBe(scene);
    expect(next.find((node) => node.id === "notes")).toEqual(bystander);
    expect(next.find((node) => node.id === "api")).toMatchObject({ text: "API", x: 80 });
    expect(next.filter((node) => /redis/i.test(node.text ?? ""))).toHaveLength(1);
    const redis = next.find((node) => /redis/i.test(node.text ?? ""));
    expect(next.some((node) => node.type === "arrow" && node.fromId === "api" && node.toId === redis?.id)).toBe(
      true,
    );
  });

  it("restores the scene captured before an accepted AI edit", () => {
    const scene = [api, database];
    const before = snapshot(scene);
    const result = validateProposal(
      scene,
      planLocally({ instruction: "Create a login flow with validation and error handling.", scene: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const accepted = commitScene([], result.proposal, "accept");
    const restored = restoreScene(before);
    expect(sceneSignature(restored)).toBe(sceneSignature(before));
    expect(sceneSignature(accepted)).not.toBe(sceneSignature(restored));
    expect(scene).toEqual(before);
  });

  it("builds a login flow with a decision and both outcomes", () => {
    const planned = planLocally({
      instruction: "Create a login flow with validation and error handling.",
      scene: [],
    });
    const result = validateProposal([], planned);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decision = result.proposal.scene.find((node) => node.type === "diamond");
    expect(decision?.text).toMatch(/valid/i);
    const outgoing = result.proposal.scene.filter((node) => node.fromId === decision?.id);
    expect(outgoing.map((node) => node.text).sort()).toEqual(["no", "yes"]);
  });
});

describe("diagram intelligence", () => {
  it("flags unlabeled, unconnected, and incomplete decision nodes", () => {
    const issues = analyzeDiagram([
      { ...api, text: undefined },
      bystander,
      {
        id: "choice",
        type: "diamond",
        x: 300,
        y: 160,
        width: 160,
        height: 120,
        text: "Valid?",
        groupIds: [],
      },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["unlabeled", "unconnected", "incomplete-flow"]),
    );
    expect(issues.every((issue) => issue.source === "deterministic")).toBe(true);
    expect(issues.find((issue) => issue.code === "unlabeled")?.elementIds).toEqual(["api"]);
  });
});

describe("assistant transport", () => {
  it("rejects invalid model JSON without throwing", async () => {
    const result = await requestProposal(
      async () =>
        new Response(JSON.stringify({ proposal: { operations: [{ op: "drop_table" }] }, provider: "test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      { instruction: "Add a box", scene: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Nothing was changed|unsupported edit/i);
  });

  it("returns an error result when the API fails", async () => {
    const result = await requestProposal(async () => {
      throw new Error("connect ECONNREFUSED");
    }, { instruction: "Add a box", scene: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/canvas was not changed/i);
  });

  it("reads a fenced model payload", () => {
    expect(extractJson('```json\n{"operations":[]}\n```')).toEqual({ operations: [] });
  });
});
