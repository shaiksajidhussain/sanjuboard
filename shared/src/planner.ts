import { analyzeDiagram } from "./analyze";
import type { DiagramOperation, SceneNode } from "./schema";

export type AssistantInput = {
  instruction: string;
  scene: SceneNode[];
  selectionIds?: string[];
};

const FILL: Record<"rectangle" | "ellipse" | "diamond", string> = {
  rectangle: "#d0ebff",
  ellipse: "#d3f9d8",
  diamond: "#fff3bf",
};

function freshId(used: Set<string>, base: string): string {
  const cleaned = base.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  let id = /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `n${cleaned}`;
  if (!id) id = "node";
  let candidate = id;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${id}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function findNode(scene: readonly SceneNode[], name: string): SceneNode | undefined {
  const needle = name.trim().toLowerCase().replace(/[.?!]+$/g, "");
  const shapes = scene.filter((node) => node.type !== "arrow" && node.type !== "line");
  return (
    shapes.find((node) => node.text?.trim().toLowerCase() === needle) ??
    shapes.find((node) => node.text?.toLowerCase().includes(needle))
  );
}

function shapeOp(
  used: Set<string>,
  idBase: string,
  type: "rectangle" | "ellipse" | "diamond",
  text: string,
  x: number,
  y: number,
  width = 180,
  height = type === "diamond" ? 120 : 88,
  backgroundColor = FILL[type],
): Extract<DiagramOperation, { op: "add_shape" }> {
  return {
    op: "add_shape",
    id: freshId(used, idBase),
    type,
    x,
    y,
    width,
    height,
    text,
    backgroundColor,
    strokeColor: "#1e1e1e",
  };
}

function arrowOp(
  used: Set<string>,
  fromId: string,
  toId: string,
  label?: string,
): DiagramOperation {
  return {
    op: "add_arrow",
    id: freshId(used, `arrow_${fromId}_${toId}`),
    fromId,
    toId,
    label,
    strokeColor: "#1e1e1e",
  };
}

function chain(
  used: Set<string>,
  items: Array<{ id: string; type: "rectangle" | "ellipse" | "diamond"; text: string; width?: number; height?: number }>,
  y = 180,
): DiagramOperation[] {
  const ops: DiagramOperation[] = [];
  const ids: string[] = [];
  items.forEach((item, index) => {
    const op = shapeOp(
      used,
      item.id,
      item.type,
      item.text,
      80 + index * 260,
      y,
      item.width,
      item.height,
    );
    if (op.op === "add_shape") ids.push(op.id);
    ops.push(op);
  });
  for (let index = 0; index < ids.length - 1; index += 1) {
    const from = ids[index];
    const to = ids[index + 1];
    if (from && to) ops.push(arrowOp(used, from, to));
  }
  return ops;
}

function nameOf(node: SceneNode): string {
  return node.text?.trim() || node.id;
}

function explain(scene: readonly SceneNode[]): string {
  const boxes = scene.filter((node) => node.type !== "arrow" && node.type !== "line");
  if (boxes.length === 0) {
    return "The canvas is empty, so there is no architecture to explain yet.";
  }
  const lines = boxes.map((node) => `- ${nameOf(node)} (${node.type})`);
  const links = scene
    .filter((node) => node.type === "arrow" && node.fromId && node.toId)
    .map((arrow) => {
      const from = scene.find((node) => node.id === arrow.fromId);
      const to = scene.find((node) => node.id === arrow.toId);
      const label = arrow.text ? ` (${arrow.text})` : "";
      return `- ${from ? nameOf(from) : arrow.fromId} → ${to ? nameOf(to) : arrow.toId}${label}`;
    });
  return [
    `This diagram has ${boxes.length} component${boxes.length === 1 ? "" : "s"}.`,
    ...lines,
    links.length > 0 ? "Connections:" : "There are no arrows connecting these components yet.",
    ...links,
  ].join("\n");
}

function toMermaid(scene: readonly SceneNode[]): string {
  const boxes = scene.filter((node) => node.type !== "arrow" && node.type !== "line");
  const ids = new Map<string, string>();
  boxes.forEach((node, index) => {
    ids.set(node.id, `n${index}_${node.id.replace(/[^A-Za-z0-9_]/g, "_")}`);
  });
  const lines = ["flowchart TD"];
  for (const node of boxes) {
    const id = ids.get(node.id);
    const label = (node.text?.trim() || node.type).replace(/"/g, "'");
    if (node.type === "diamond") lines.push(`  ${id}{"${label}"}`);
    else if (node.type === "ellipse") lines.push(`  ${id}(["${label}"])`);
    else lines.push(`  ${id}["${label}"]`);
  }
  for (const arrow of scene.filter((node) => node.type === "arrow" && node.fromId && node.toId)) {
    const from = ids.get(arrow.fromId!);
    const to = ids.get(arrow.toId!);
    if (!from || !to) continue;
    const label = arrow.text?.trim().replace(/"/g, "'");
    lines.push(label ? `  ${from} -->|"${label}"| ${to}` : `  ${from} --> ${to}`);
  }
  return lines.join("\n");
}

function issuesText(scene: readonly SceneNode[]): string {
  const issues = analyzeDiagram(scene);
  if (issues.length === 0) {
    return "Deterministic checks did not find unlabeled shapes, dangling arrows, overlaps, or incomplete decisions.";
  }
  return issues.map((issue) => `- ${issue.message}`).join("\n");
}

export function planLocally(input: AssistantInput): { operations: DiagramOperation[] } {
  const instruction = input.instruction.trim();
  const lower = instruction.toLowerCase();
  const used = new Set(input.scene.map((node) => node.id));

  if (/mermaid/.test(lower)) {
    return {
      operations: [{ op: "comment", kind: "mermaid", text: toMermaid(input.scene) }],
    };
  }

  if (/explain|simple english|what does this|describe this/.test(lower)) {
    return {
      operations: [{ op: "comment", kind: "explanation", text: explain(input.scene) }],
    };
  }

  if (/missing connection|find missing|what.s missing|incomplete/.test(lower)) {
    return {
      operations: [{ op: "comment", kind: "suggestion", text: issuesText(input.scene) }],
    };
  }

  if (/add labels|unlabeled/.test(lower)) {
    const operations: DiagramOperation[] = [];
    let count = 1;
    for (const node of input.scene) {
      if ((node.type === "rectangle" || node.type === "ellipse" || node.type === "diamond") && !node.text?.trim()) {
        operations.push({
          op: "update_shape",
          id: node.id,
          text: `Component ${count}`,
        });
        count += 1;
      }
    }
    if (operations.length === 0) {
      operations.push({
        op: "comment",
        kind: "suggestion",
        text: "Every shape already has a label.",
      });
    }
    return { operations };
  }

  if (/easier to understand|clean up|clarify/.test(lower)) {
    const operations: DiagramOperation[] = [];
    let count = 1;
    for (const node of input.scene) {
      if ((node.type === "rectangle" || node.type === "ellipse" || node.type === "diamond") && !node.text?.trim()) {
        operations.push({ op: "update_shape", id: node.id, text: `Component ${count}` });
        count += 1;
      }
    }
    operations.push({
      op: "comment",
      kind: "suggestion",
      text: `Deterministic review:\n${issuesText(input.scene)}`,
    });
    return { operations };
  }

  const between = instruction.match(
    /add (?:a |an )?(.+?) between (?:the )?(.+?) and (?:the )?(.+?)\.?$/i,
  );
  if (between) {
    const [, rawLabel, rawFrom, rawTo] = between;
    const label = titleCase(rawLabel ?? "Service");
    const from = findNode(input.scene, rawFrom ?? "");
    const to = findNode(input.scene, rawTo ?? "");
    if (from && to) {
      const x = Math.round((from.x + from.width + to.x) / 2 - 90);
      const y = Math.round(Math.min(from.y, to.y));
      const created = shapeOp(used, slug(label), "rectangle", label, x, y);
      const createdId = created.op === "add_shape" ? created.id : freshId(used, "inserted");
      return {
        operations: [
          created,
          arrowOp(used, from.id, createdId),
          arrowOp(used, createdId, to.id),
          {
            op: "comment",
            kind: "suggestion",
            text: `Inserts ${label} between ${nameOf(from)} and ${nameOf(to)}. Existing arrows are left in place.`,
          },
        ],
      };
    }
    return {
      operations: chain(used, [
        { id: slug(rawFrom ?? "source"), type: "rectangle", text: titleCase(rawFrom ?? "Source") },
        { id: slug(label), type: "rectangle", text: label },
        { id: slug(rawTo ?? "destination"), type: "rectangle", text: titleCase(rawTo ?? "Destination") },
      ]),
    };
  }

  if (/login flow|sign-?in flow/.test(lower)) {
    const flow = chain(used, [
      { id: "login_user", type: "ellipse", text: "User" },
      { id: "login_form", type: "rectangle", text: "Login form" },
      { id: "login_validate", type: "diamond", text: "Valid?", width: 180, height: 140 },
    ]);
    const validate = flow.find(
      (op): op is Extract<DiagramOperation, { op: "add_shape" }> =>
        op.op === "add_shape" && op.text === "Credentials valid?",
    );
    const success = shapeOp(used, "login_success", "rectangle", "Open session", 860, 40);
    const failure = shapeOp(
      used,
      "login_error",
      "rectangle",
      "Show error",
      860,
      300,
      180,
      88,
      "#ffc9c9",
    );
    return {
      operations: [
        ...flow,
        success,
        failure,
        arrowOp(used, validate?.id ?? "login_validate", success.id, "yes"),
        arrowOp(used, validate?.id ?? "login_validate", failure.id, "no"),
      ],
    };
  }

  if (/payment gateway|payments?/.test(lower) && /add|insert|include/.test(lower)) {
    const anchor =
      findNode(input.scene, "checkout") ??
      findNode(input.scene, "api") ??
      findNode(input.scene, "client") ??
      rightmostShape(input.scene);
    if (!anchor) {
      return {
        operations: chain(used, [
          { id: "pay_client", type: "rectangle", text: "Client" },
          { id: "pay_api", type: "rectangle", text: "API" },
          { id: "pay_gateway", type: "rectangle", text: "Payment gateway" },
          { id: "pay_bank", type: "rectangle", text: "Bank" },
        ]),
      };
    }
    const created = shapeOp(
      used,
      "payment_gateway",
      "rectangle",
      "Payment gateway",
      anchor.x + anchor.width + 80,
      anchor.y,
    );
    const createdId = created.op === "add_shape" ? created.id : "payment_gateway";
    return { operations: [created, arrowOp(used, anchor.id, createdId)] };
  }

  const connect = instruction.match(/connect (?:the )?(.+?) to (?:the )?(.+?)\.?$/i);
  if (connect) {
    const from = findNode(input.scene, connect[1] ?? "");
    const to = findNode(input.scene, connect[2] ?? "");
    if (!from || !to) {
      return {
        operations: [
          {
            op: "comment",
            kind: "suggestion",
            text: "I could not find both shapes named in that connection. Nothing was changed.",
          },
        ],
      };
    }
    return { operations: [arrowOp(used, from.id, to.id)] };
  }

  const labeled = instruction.match(
    /add (?:a |an )?(rectangle|ellipse|diamond|text)(?: labeled| called| named)? ["“]?([^"”]+)["”]?\.?$/i,
  );
  if (labeled) {
    const type = (labeled[1] ?? "rectangle").toLowerCase() as "rectangle" | "ellipse" | "diamond" | "text";
    const text = (labeled[2] ?? "Label").trim().replace(/[.?!]+$/g, "");
    const spot = nextSpot(input.scene);
    if (type === "text") {
      return {
        operations: [
          {
            op: "add_shape",
            id: freshId(used, slug(text)),
            type: "text",
            x: spot.x,
            y: spot.y,
            text,
            strokeColor: "#1e1e1e",
          },
        ],
      };
    }
    return { operations: [shapeOp(used, slug(text), type, text, spot.x, spot.y)] };
  }

  const remove = instruction.match(/^(?:delete|remove) (?:the )?(.+?)\.?$/i);
  if (remove) {
    const node = findNode(input.scene, remove[1] ?? "");
    if (!node) {
      return {
        operations: [
          {
            op: "comment",
            kind: "suggestion",
            text: `I could not find “${remove[1]}” to delete. Nothing was changed.`,
          },
        ],
      };
    }
    return { operations: [{ op: "delete_shape", id: node.id, confirmDelete: true }] };
  }

  if (/^group\b/.test(lower)) {
    const ids = input.scene
      .filter((node) => node.type !== "arrow" && node.type !== "line")
      .map((node) => node.id);
    if (ids.length < 2) {
      return {
        operations: [
          {
            op: "comment",
            kind: "suggestion",
            text: "Grouping needs at least two shapes.",
          },
        ],
      };
    }
    return { operations: [{ op: "group", ids, groupId: freshId(used, "group_main") }] };
  }

  return {
    operations: [
      {
        op: "comment",
        kind: "suggestion",
        text: [
          "The local planner did not recognize that instruction, so the canvas was left unchanged.",
          "Set OPENAI_API_KEY or ANTHROPIC_API_KEY for open-ended edits.",
          "This planner can add a shape between two named components, create a login flow, add a payment gateway, label unlabeled shapes, explain the diagram, or export Mermaid.",
        ].join(" "),
      },
    ],
  };
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned || "node";
}

function titleCase(value: string): string {
  const trimmed = value.trim().replace(/[.?!]+$/g, "");
  if (!trimmed) return "Service";
  return trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function rightmostShape(scene: readonly SceneNode[]): SceneNode | undefined {
  return scene
    .filter((node) => node.type === "rectangle" || node.type === "ellipse" || node.type === "diamond")
    .reduce<SceneNode | undefined>((best, node) => {
      if (!best || node.x > best.x) return node;
      return best;
    }, undefined);
}

function nextSpot(scene: readonly SceneNode[]): { x: number; y: number } {
  const boxes = scene.filter((node) => node.type !== "arrow" && node.type !== "line");
  if (boxes.length === 0) return { x: 120, y: 180 };
  const maxRight = Math.max(...boxes.map((node) => node.x + node.width));
  return { x: maxRight + 80, y: boxes[0]?.y ?? 180 };
}

export const localAssistant = {
  name: "local",
  async propose(input: AssistantInput): Promise<unknown> {
    return planLocally(input);
  },
};
