import { describe, expect, it } from "vitest";
import { analyzeDiagram } from "./analyze";
import {
  applyIfUnchanged,
  commitScene,
  restoreSnapshot,
  sceneSignature,
  validateProposal,
} from "./apply";
import { assistantUserPrompt, extractJson, requestProposal } from "./assistant";
import type { Proposal, SceneNode } from "./schema";

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

function copy(scene: readonly SceneNode[]): SceneNode[] {
  return scene.map((node) => ({ ...node, groupIds: [...node.groupIds] }));
}

describe("T01 malformed AI response", () => {
  const scene = [box("api", 40, "API")];

  it.each([
    ["invalid json", "not-json"],
    ["missing operations", {}],
    ["unknown operation", { operations: [{ op: "exec", command: "id" }] }],
    ["unsupported shape", { operations: [{ op: "add_shape", id: "p", type: "pentagon", x: 1, y: 1 }] }],
    ["invalid position", { operations: [{ op: "add_shape", id: "p", type: "rectangle", x: Number.POSITIVE_INFINITY, y: 1 }] }],
    ["invalid size", { operations: [{ op: "update_shape", id: "api", width: 0 }] }],
    ["unsafe id", { operations: [{ op: "add_shape", id: "bad id", type: "rectangle", x: 1, y: 1 }] }],
  ])("rejects %s and leaves the diagram unchanged", (_name, payload) => {
    const before = copy(scene);
    const result = typeof payload === "string" ? validateProposal(scene, payload) : validateProposal(scene, payload);
    expect(result.ok).toBe(false);
    expect(scene).toEqual(before);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("rejects model text that is not JSON", () => {
    expect(() => extractJson("Sure, here is a diagram")).toThrow(/not JSON|empty/i);
  });
});

describe("T02 mixed valid and invalid operations", () => {
  it("rejects the whole batch and does not keep the valid prefix", () => {
    const scene = [box("api", 40, "API")];
    const before = copy(scene);
    const result = validateProposal(scene, {
      operations: [
        { op: "add_shape", id: "cache", type: "rectangle", x: 240, y: 40, text: "Cache" },
        { op: "delete_shape", id: "missing", confirmDelete: true },
      ],
    });
    expect(result.ok).toBe(false);
    expect(scene).toEqual(before);
    if (!result.ok) expect(result.error).toMatch(/missing|Nothing was changed/i);
    expect("proposal" in result).toBe(false);
  });
});

describe("T03 unknown shape id", () => {
  it.each(["update_shape", "move_shape", "delete_shape"] as const)(
    "rejects %s for a missing element",
    (op) => {
      const scene = [box("api", 40, "API"), box("notes", 400, "Notes")];
      const before = copy(scene);
      const operation =
        op === "update_shape"
          ? { op, id: "ghost", text: "Changed" }
          : op === "move_shape"
            ? { op, id: "ghost", x: 10, y: 10 }
            : { op, id: "ghost", confirmDelete: true as const };
      const result = validateProposal(scene, { operations: [operation] });
      expect(result.ok).toBe(false);
      expect(scene).toEqual(before);
    },
  );
});

describe("T04 delete requires approval", () => {
  it("keeps the element until the proposal is accepted", () => {
    const scene = [box("api", 40, "API"), box("notes", 400, "Notes")];
    const before = copy(scene);
    const result = validateProposal(scene, {
      operations: [{ op: "delete_shape", id: "notes", confirmDelete: true }],
    });
    expect(result.ok).toBe(true);
    expect(scene).toEqual(before);
    if (!result.ok) return;
    expect(result.proposal.changes.some((change) => change.kind === "delete" && change.id === "notes")).toBe(true);
    expect(commitScene(scene, result.proposal, "reject")).toEqual(before);
    const accepted = commitScene(scene, result.proposal, "accept");
    expect(accepted.some((node) => node.id === "notes")).toBe(false);
    expect(accepted.find((node) => node.id === "api")).toMatchObject({ text: "API", x: 40 });
  });

  it("rejects a deletion that is not confirmed", () => {
    const scene = [box("api", 40, "API")];
    const result = validateProposal(scene, { operations: [{ op: "delete_shape", id: "api" }] });
    expect(result.ok).toBe(false);
    expect(scene.map((node) => node.id)).toEqual(["api"]);
  });
});

describe("T05 restore multiple snapshots", () => {
  it("restores each accepted edit back to that edit's exact prior state", () => {
    const original = [box("api", 40, "API")];
    const added = commitScene(
      original,
      accepted(validateProposal(original, { operations: [{ op: "add_shape", id: "cache", type: "rectangle", x: 240, y: 40, text: "Cache" }] })),
      "accept",
    );
    const moved = commitScene(
      added,
      accepted(validateProposal(added, { operations: [{ op: "move_shape", id: "cache", x: 300, y: 80 }] })),
      "accept",
    );
    const recolored = commitScene(
      moved,
      accepted(validateProposal(moved, { operations: [{ op: "update_shape", id: "api", backgroundColor: "#d0ebff" }] })),
      "accept",
    );
    const deleted = commitScene(
      recolored,
      accepted(validateProposal(recolored, { operations: [{ op: "delete_shape", id: "cache", confirmDelete: true }] })),
      "accept",
    );

    const history = [
      { id: "delete", afterSignature: sceneSignature(deleted), beforeElements: copy(recolored) },
      { id: "color", afterSignature: sceneSignature(recolored), beforeElements: copy(moved) },
      { id: "move", afterSignature: sceneSignature(moved), beforeElements: copy(added) },
      { id: "add", afterSignature: sceneSignature(added), beforeElements: copy(original) },
    ];

    const first = restoreSnapshot(history, "delete", sceneSignature(deleted));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entry.beforeElements).toEqual(recolored);

    const second = restoreSnapshot(first.entries, "color", sceneSignature(first.entry.beforeElements));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.entry.beforeElements).toEqual(moved);

    const manual = second.entry.beforeElements.map((node) =>
      node.id === "api" ? { ...node, x: 999 } : node,
    );
    const blocked = restoreSnapshot(second.entries, "move", sceneSignature(manual));
    expect(blocked.ok).toBe(false);
    expect(manual.find((node) => node.id === "api")?.x).toBe(999);

    const forced = restoreSnapshot(second.entries, "move", sceneSignature(manual), true);
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.entry.beforeElements).toEqual(added);
  });
});

describe("T06 assistant failures", () => {
  it("reports a server error once and does not retry", async () => {
    let calls = 0;
    const result = await requestProposal(async () => {
      calls += 1;
      return new Response("nope", { status: 500 });
    }, { instruction: "Add a box", scene: [] });
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not changed|failed/i);
  });

  it("reports a timeout without changing state", async () => {
    const result = await requestProposal(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }, { instruction: "Add a box", scene: [box("api", 40, "API")] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(0);
    expect(result.error).toMatch(/not changed/i);
  });

  it("rejects a malformed success body", async () => {
    const result = await requestProposal(async () => new Response("[]", { status: 200 }), {
      instruction: "Add a box",
      scene: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe("T07 stale proposals", () => {
  it("refuses an older proposal after the canvas changes", () => {
    const reviewed = [box("api", 40, "API")];
    const proposal = accepted(
      validateProposal(reviewed, {
        operations: [{ op: "move_shape", id: "api", x: 500, y: 40 }],
      }),
    );
    const edited = reviewed.map((node) => ({ ...node, x: 90, text: "API v2" }));
    const stale = applyIfUnchanged(edited, proposal, sceneSignature(reviewed));
    expect(stale.ok).toBe(false);
    expect(edited).toEqual([expect.objectContaining({ x: 90, text: "API v2" })]);
    if (!stale.ok) expect(stale.error).toMatch(/Nothing was changed/);
  });

  it("applies a proposal when the canvas is still the reviewed scene", () => {
    const reviewed = [box("api", 40, "API")];
    const proposal = accepted(
      validateProposal(reviewed, {
        operations: [{ op: "add_shape", id: "cache", type: "rectangle", x: 240, y: 40, text: "Cache" }],
      }),
    );
    const fresh = applyIfUnchanged(copy(reviewed), proposal, sceneSignature(reviewed));
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.proposal.scene.map((node) => node.id)).toEqual(["api", "cache"]);
    expect(reviewed.map((node) => node.id)).toEqual(["api"]);
  });
});

describe("T09 deterministic issues after edits", () => {
  it("clears an unconnected finding when a validated arrow is accepted", () => {
    const scene = [box("api", 40, "API"), box("db", 320, "PostgreSQL")];
    expect(analyzeDiagram(scene).some((issue) => issue.code === "unconnected")).toBe(true);
    const linked = commitScene(
      scene,
      accepted(
        validateProposal(scene, {
          operations: [{ op: "add_arrow", id: "link", fromId: "api", toId: "db" }],
        }),
      ),
      "accept",
    );
    const issues = analyzeDiagram(linked);
    expect(issues.some((issue) => issue.code === "unconnected")).toBe(false);
    expect(issues.every((issue) => issue.source === "deterministic")).toBe(true);
  });
});

describe("T10 payload minimization", () => {
  it("sends geometry and labels only", () => {
    const prompt = JSON.parse(
      assistantUserPrompt({
        instruction: "Label this",
        scene: [box("api", 40, "API")],
        selectionIds: ["api"],
      }),
    ) as { elements: Record<string, unknown>[] };
    expect(Object.keys(prompt.elements[0] ?? {}).sort()).toEqual(
      ["height", "id", "text", "type", "width", "x", "y"].sort(),
    );
    expect(JSON.stringify(prompt)).not.toMatch(/dataURL|apiKey|authorization/i);
  });
});

function accepted(result: { ok: true; proposal: Proposal } | { ok: false; error: string }): Proposal {
  if (!result.ok) throw new Error(result.error);
  return result.proposal;
}
