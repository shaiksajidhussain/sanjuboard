import type { SceneNode } from "./schema";

export type DiagramIssue = {
  id: string;
  severity: "info" | "warning";
  source: "deterministic";
  code:
    | "unlabeled"
    | "unconnected"
    | "overlap"
    | "dangling-arrow"
    | "incomplete-flow"
    | "duplicate-label";
  message: string;
  elementIds: string[];
};

const SHAPES = new Set(["rectangle", "ellipse", "diamond", "triangle"]);

function shapes(scene: readonly SceneNode[]): SceneNode[] {
  return scene.filter((node) => SHAPES.has(node.type));
}

function intersects(a: SceneNode, b: SceneNode): boolean {
  const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (overlapWidth <= 0 || overlapHeight <= 0) return false;
  const overlap = overlapWidth * overlapHeight;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 && overlap / smaller > 0.55;
}

export function analyzeDiagram(scene: readonly SceneNode[]): DiagramIssue[] {
  const issues: DiagramIssue[] = [];
  const boxes = shapes(scene);
  const arrows = scene.filter((node) => node.type === "arrow");

  for (const node of boxes) {
    if (!node.text?.trim()) {
      issues.push({
        id: `unlabeled:${node.id}`,
        severity: "warning",
        source: "deterministic",
        code: "unlabeled",
        message: `This ${node.type} has no label.`,
        elementIds: [node.id],
      });
    }
  }

  if (boxes.length > 1) {
    for (const node of boxes) {
      const connected = arrows.some((arrow) => arrow.fromId === node.id || arrow.toId === node.id);
      if (!connected) {
        issues.push({
          id: `unconnected:${node.id}`,
          severity: "info",
          source: "deterministic",
          code: "unconnected",
          message: `“${node.text?.trim() || "Unlabeled " + node.type}” is not connected to anything.`,
          elementIds: [node.id],
        });
      }
    }
  }

  for (const arrow of arrows) {
    if (!arrow.fromId || !arrow.toId || arrow.fromId === arrow.toId) {
      issues.push({
        id: `dangling:${arrow.id}`,
        severity: "warning",
        source: "deterministic",
        code: "dangling-arrow",
        message: "This arrow is missing one of its endpoints.",
        elementIds: [arrow.id],
      });
    }
  }

  for (let index = 0; index < boxes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < boxes.length; otherIndex += 1) {
      const left = boxes[index];
      const right = boxes[otherIndex];
      if (left && right && intersects(left, right)) {
        issues.push({
          id: `overlap:${left.id}:${right.id}`,
          severity: "info",
          source: "deterministic",
          code: "overlap",
          message: `“${left.text || left.id}” overlaps “${right.text || right.id}”.`,
          elementIds: [left.id, right.id],
        });
      }
    }
  }

  const labels = new Map<string, SceneNode[]>();
  for (const node of boxes) {
    const key = node.text?.trim().toLowerCase();
    if (!key) continue;
    labels.set(key, [...(labels.get(key) ?? []), node]);
  }
  for (const [label, group] of labels) {
    if (group.length > 1) {
      issues.push({
        id: `duplicate:${label}`,
        severity: "info",
        source: "deterministic",
        code: "duplicate-label",
        message: `${group.length} shapes share the label “${group[0]?.text}”.`,
        elementIds: group.map((node) => node.id),
      });
    }
  }

  for (const node of boxes.filter((item) => item.type === "diamond")) {
    const outgoing = arrows.filter((arrow) => arrow.fromId === node.id);
    if (outgoing.length < 2) {
      issues.push({
        id: `flow:${node.id}`,
        severity: "warning",
        source: "deterministic",
        code: "incomplete-flow",
        message: `Decision “${node.text?.trim() || "Untitled"}” has fewer than two outgoing paths.`,
        elementIds: [node.id],
      });
    }
  }

  return issues;
}
