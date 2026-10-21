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

  it("accepts a diagram with more than 24 shapes and keeps the first 48", () => {
    const operations = Array.from({ length: 60 }, (_, index) => ({
      op: "add_shape" as const,
      id: `node_${index}`,
      type: "rectangle" as const,
      x: (index % 8) * 200,
      y: Math.floor(index / 8) * 120,
      text: `Part ${index}`,
    }));
    const result = validateProposal([], { operations });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.operations).toHaveLength(48);
    expect(result.proposal.scene.some((node) => node.text === "Part 30")).toBe(true);
  });

  it("lays a CI/CD pipeline left to right instead of stacking it like an architecture", () => {
    const names = [
      "PostgreSQL Database",
      "Monitoring and Alerts",
      "Jenkins CI/CD Server",
      "GitHub Repository",
      "Docker Image Builder",
      "Deployment Approval",
      "Staging Environment",
      "Developer",
    ];
    const result = validateProposal([], {
      operations: [
        ...names.map((text, index) => ({
          op: "add_shape" as const,
          id: `step_${index}`,
          type: "rectangle" as const,
          x: 40,
          y: index * 30,
          width: 80,
          height: 40,
          text,
        })),
        { op: "add_arrow" as const, id: "fail", fromId: "step_5", toId: "step_0", label: "Reject" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const find = (text: string) => result.proposal.scene.find((node) => node.text === text);
    const developer = find("Developer");
    const github = find("GitHub Repository");
    const jenkins = find("Jenkins CI/CD Server");
    const approval = find("Deployment Approval");
    const database = find("PostgreSQL Database");
    expect(developer && github && jenkins && approval && database).toBeTruthy();
    expect(github!.x).toBeGreaterThan(developer!.x + developer!.width);
    expect(jenkins!.x).toBeGreaterThan(github!.x);
    expect(approval!.type).toBe("diamond");
    expect(database!.type).toBe("ellipse");
    expect(database!.y).toBeGreaterThan(developer!.y + developer!.height);
    const boxes = result.proposal.scene.filter((node) => node.type !== "arrow");
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        const a = boxes[left];
        const b = boxes[right];
        if (!a || !b) continue;
        const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
    expect(result.proposal.scene.find((node) => node.id === "fail")?.strokeColor).toBe("#e03131");
  });

  it("separates a crowded architecture so boxes and the legend do not overlap", () => {
    const names = [
      "Customer Web App (React)",
      "Admin Dashboard (React)",
      "API Gateway (Node.js/Express)",
      "Authentication Service (JWT)",
      "Product Catalog Service",
      "Order Management Service",
      "PostgreSQL Database",
      "Redis Cache",
      "External Payment Gateway",
      "Monitoring System",
    ];
    const operations = [
      { op: "add_shape" as const, id: "swatch", type: "rectangle" as const, x: 20, y: 20, width: 80, height: 80 },
      {
        op: "add_shape" as const,
        id: "title",
        type: "text" as const,
        x: 40,
        y: 0,
        width: 80,
        height: 20,
        text: "E-Commerce Platform Architecture Diagram",
      },
      {
        op: "add_shape" as const,
        id: "legend",
        type: "text" as const,
        x: 400,
        y: 0,
        width: 80,
        height: 20,
        text: "Legend:\\n- Client Applications: #d0ebff\\n- Backend Services: #e5dbff",
      },
      ...names.map((text, index) => ({
        op: "add_shape" as const,
        id: `part_${index}`,
        type: "rectangle" as const,
        x: 80,
        y: 40 + index * 36,
        width: 90,
        height: 40,
        text,
      })),
      { op: "add_arrow" as const, id: "to_gateway", fromId: "part_0", toId: "part_2" },
      { op: "add_arrow" as const, id: "to_catalog", fromId: "part_2", toId: "part_4" },
      { op: "add_arrow" as const, id: "to_db", fromId: "part_4", toId: "part_6" },
    ];
    const result = validateProposal([], { operations });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const boxes = result.proposal.scene.filter((node) => node.type !== "arrow" && node.type !== "text");
    expect(result.proposal.scene.some((node) => node.id === "swatch")).toBe(false);
    expect(result.proposal.scene.find((node) => node.id === "legend")?.text).toBe(
      "Legend:\n- Client Applications: #d0ebff\n- Backend Services: #e5dbff",
    );
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        const a = boxes[left];
        const b = boxes[right];
        if (!a || !b) continue;
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
    const find = (text: string) => result.proposal.scene.find((node) => node.text === text);
    const customer = find("Customer Web App (React)");
    const gateway = find("API Gateway (Node.js/Express)");
    const catalog = find("Product Catalog Service");
    const database = find("PostgreSQL Database");
    const external = find("External Payment Gateway");
    expect(customer && gateway && catalog && database && external).toBeTruthy();
    expect(gateway!.x).toBeGreaterThan(customer!.x + customer!.width);
    expect(catalog!.x).toBeGreaterThan(gateway!.x + gateway!.width);
    expect(database!.x).toBeGreaterThan(catalog!.x + catalog!.width);
    expect(external!.x).toBeGreaterThan(database!.x);
    expect(find("E-Commerce Platform Architecture Diagram")!.y).toBeLessThan(customer!.y);
  });

  it("connects an unlinked system and keeps the full label", () => {
    const result = validateProposal([], {
      operations: [
        { op: "add_shape", id: "web", type: "rectangle", x: 40, y: 40, width: 80, height: 40, text: "Patient Web App" },
        { op: "add_shape", id: "doctor", type: "rectangle", x: 48, y: 180, width: 80, height: 40, text: "Doctor Portal" },
        { op: "add_shape", id: "gateway", type: "rectangle", x: 340, y: 100, width: 80, height: 40, text: "API Gateway" },
        {
          op: "add_shape",
          id: "auth",
          type: "rectangle",
          x: 640,
          y: 40,
          width: 90,
          height: 40,
          text: "Authentication Service",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const web = result.proposal.scene.find((node) => node.id === "web");
    expect(web?.width).toBeGreaterThanOrEqual(168);
    expect(web?.height).toBeGreaterThanOrEqual(72);
    expect(web?.text).toBe("Patient Web App");
    expect(web?.backgroundColor).toBe("#d0ebff");
    expect(
      result.proposal.scene.some((node) => node.type === "arrow" && node.fromId === "web" && node.toId === "gateway"),
    ).toBe(true);
    expect(
      result.proposal.scene.some((node) => node.type === "arrow" && node.fromId === "gateway" && node.toId === "auth"),
    ).toBe(true);
  });

  it("resolves an arrow that names the label instead of the id", () => {
    const result = validateProposal([], {
      operations: [
        { op: "add_shape", id: "web", type: "rectangle", x: 40, y: 40, text: "Patient Web App" },
        { op: "add_shape", id: "api", type: "rectangle", x: 360, y: 40, text: "API Gateway" },
        { op: "add_arrow", id: "edge", from: "Patient Web App", to: "API Gateway" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.scene.some((node) => node.type === "arrow" && node.fromId === "web" && node.toId === "api")).toBe(
      true,
    );
  });

  it("accepts coordinates that arrive as strings", () => {
    const result = validateProposal([], {
      operations: [
        { op: "add_shape", id: "git", type: "rectangle", x: "40", y: "120", width: "200", height: "80", text: "GitHub" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.scene[0]).toMatchObject({ x: 40, y: 120, text: "GitHub" });
  });

  it("fills in a missing shape type instead of rejecting the diagram", () => {
    const result = validateProposal([], {
      operations: [
        { op: "add_shape", id: "dev", type: "rectangle", x: 40, y: 40, text: "Developer" },
        { op: "add_shape", id: "git", x: 300, y: 40, text: "GitHub Repository" },
        { op: "add_shape", id: "edge", x: 180, y: 70, fromId: "dev", toId: "git" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.scene.find((node) => node.id === "git")).toMatchObject({ type: "rectangle", text: "GitHub Repository" });
    expect(result.proposal.scene.some((node) => node.type === "arrow" && node.fromId === "dev" && node.toId === "git")).toBe(
      true,
    );
  });

  it("accepts a line and turns one with two ends into an arrow", () => {
    const result = validateProposal([], {
      operations: [
        { op: "add_shape", id: "web", type: "rectangle", x: 40, y: 40, text: "Web" },
        { op: "add_shape", id: "api", type: "rectangle", x: 340, y: 40, text: "API" },
        { op: "add_shape", id: "edge", type: "line", x: 200, y: 70, fromId: "web", toId: "api" },
        { op: "add_shape", id: "rule", type: "line", x: 40, y: 220, width: 120, height: 4 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.scene.some((node) => node.type === "arrow" && node.fromId === "web" && node.toId === "api")).toBe(
      true,
    );
    expect(result.proposal.scene.some((node) => node.id === "rule" && node.type === "line")).toBe(true);
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

  it("keeps finished shapes when the model JSON is cut off", () => {
    const parsed = extractJson(
      '{"operations":[{"op":"add_shape","id":"api","type":"rectangle","x":40,"y":40,"text":"API"},{"op":"add_shape","id":"db"',
    ) as { operations: Array<{ id: string }> };
    expect(parsed.operations.map((operation) => operation.id)).toEqual(["api"]);
  });
});
