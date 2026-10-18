import {
  type Change,
  type DiagramOperation,
  type Proposal,
  type SceneNode,
  modelResponseSchema,
  normalizeModelPayload,
} from "./schema";

const BINDABLE = new Set(["rectangle", "ellipse", "diamond", "triangle", "text"]);

function cloneScene(scene: readonly SceneNode[]): SceneNode[] {
  return scene.map((node) => ({ ...node, groupIds: [...node.groupIds] }));
}

function labelOf(node: SceneNode | undefined, fallback: string): string {
  return node?.text?.trim() || fallback;
}

export function validateProposal(
  scene: readonly SceneNode[],
  payload: unknown,
): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  const parsed = modelResponseSchema.safeParse(normalizeModelPayload(payload));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "operations";
    return {
      ok: false,
      error: `The assistant returned an unsupported edit (${path}: ${issue?.message ?? "invalid"}). Nothing was changed.`,
    };
  }

  const working = cloneScene(scene);
  const changes: Change[] = [];

  for (const operation of parsed.data.operations) {
    const applied = applyOperation(working, operation);
    if (!applied.ok) return applied;
    changes.push(...applied.changes);
  }

  return {
    ok: true,
    proposal: {
      operations: parsed.data.operations,
      changes,
      scene: working,
      convertIds: [...conversionClosure(working, seedIds(parsed.data.operations))],
    },
  };
}

function applyOperation(
  scene: SceneNode[],
  operation: DiagramOperation,
): { ok: true; changes: Change[] } | { ok: false; error: string } {
  switch (operation.op) {
    case "comment":
      return {
        ok: true,
        changes: [{ kind: "note", noteKind: operation.kind, text: operation.text }],
      };
    case "add_shape": {
      if (operation.type === "text" && !operation.text?.trim()) {
        return { ok: false, error: "A text shape needs text. Nothing was changed." };
      }
      if (scene.some((node) => node.id === operation.id)) {
        return { ok: false, error: `Cannot add "${operation.id}" because that id already exists.` };
      }
      const node: SceneNode = {
        id: operation.id,
        type: operation.type,
        x: operation.x,
        y: operation.y,
        width: operation.width ?? (operation.type === "text" ? 160 : 180),
        height:
          operation.height ??
          (operation.type === "diamond" || operation.type === "triangle" ? 140 : operation.type === "text" ? 40 : 88),
        text: operation.text,
        backgroundColor: operation.backgroundColor,
        strokeColor: operation.strokeColor,
        groupIds: [],
      };
      scene.push(node);
      return {
        ok: true,
        changes: [{ kind: "add", id: node.id, summary: `Add ${node.type} “${labelOf(node, node.id)}”` }],
      };
    }
    case "update_shape": {
      const hasPatch =
        operation.x !== undefined ||
        operation.y !== undefined ||
        operation.width !== undefined ||
        operation.height !== undefined ||
        operation.text !== undefined ||
        operation.backgroundColor !== undefined ||
        operation.strokeColor !== undefined;
      if (!hasPatch) {
        return { ok: false, error: "update_shape needs at least one property. Nothing was changed." };
      }
      const node = scene.find((item) => item.id === operation.id);
      if (!node) return { ok: false, error: `Cannot update missing element "${operation.id}".` };
      if (node.type === "arrow" || node.type === "line") {
        return { ok: false, error: `Use arrow operations to change "${operation.id}".` };
      }
      if (operation.x !== undefined) node.x = operation.x;
      if (operation.y !== undefined) node.y = operation.y;
      if (operation.width !== undefined) node.width = operation.width;
      if (operation.height !== undefined) node.height = operation.height;
      if (operation.text !== undefined) node.text = operation.text;
      if (operation.backgroundColor !== undefined) node.backgroundColor = operation.backgroundColor;
      if (operation.strokeColor !== undefined) node.strokeColor = operation.strokeColor;
      return {
        ok: true,
        changes: [{ kind: "update", id: node.id, summary: `Update “${labelOf(node, node.id)}”` }],
      };
    }
    case "move_shape": {
      const node = scene.find((item) => item.id === operation.id);
      if (!node) return { ok: false, error: `Cannot move missing element "${operation.id}".` };
      node.x = operation.x;
      node.y = operation.y;
      return {
        ok: true,
        changes: [{ kind: "update", id: node.id, summary: `Move “${labelOf(node, node.id)}”` }],
      };
    }
    case "add_arrow": {
      if (operation.fromId === operation.toId) {
        return { ok: false, error: "An arrow needs two different elements." };
      }
      if (scene.some((node) => node.id === operation.id)) {
        return { ok: false, error: `Cannot add arrow "${operation.id}" because that id already exists.` };
      }
      const from = scene.find((node) => node.id === operation.fromId);
      const to = scene.find((node) => node.id === operation.toId);
      if (!from || !to) {
        return {
          ok: false,
          error: `Arrow "${operation.id}" points at an element that is not on the canvas.`,
        };
      }
      if (!BINDABLE.has(from.type) || !BINDABLE.has(to.type)) {
        return { ok: false, error: "Arrows can only connect rectangles, ellipses, diamonds, triangles, and text." };
      }
      scene.push({
        id: operation.id,
        type: "arrow",
        x: operation.x ?? from.x + from.width,
        y: operation.y ?? from.y + from.height / 2,
        width: Math.max(Math.abs(to.x - from.x), 40),
        height: Math.max(Math.abs(to.y - from.y), 1),
        text: operation.label,
        fromId: from.id,
        toId: to.id,
        strokeColor: operation.strokeColor ?? "#1e1e1e",
        groupIds: [],
      });
      const via = operation.label ? ` labeled “${operation.label}”` : "";
      return {
        ok: true,
        changes: [
          {
            kind: "add",
            id: operation.id,
            summary: `Connect “${labelOf(from, from.id)}” to “${labelOf(to, to.id)}”${via}`,
          },
        ],
      };
    }
    case "delete_shape": {
      const node = scene.find((item) => item.id === operation.id);
      if (!node) return { ok: false, error: `Cannot delete missing element "${operation.id}".` };
      const removed = scene.filter(
        (item) =>
          item.id === operation.id ||
          item.fromId === operation.id ||
          item.toId === operation.id,
      );
      for (let index = scene.length - 1; index >= 0; index -= 1) {
        const item = scene[index];
        if (item && removed.some((candidate) => candidate.id === item.id)) scene.splice(index, 1);
      }
      return {
        ok: true,
        changes: removed.map((item) => ({
          kind: "delete" as const,
          id: item.id,
          summary:
            item.id === operation.id
              ? `Delete “${labelOf(item, item.id)}”`
              : `Remove connection “${labelOf(item, item.id)}” because it was attached to the deleted element`,
        })),
      };
    }
    case "group": {
      const missing = operation.ids.filter((id) => !scene.some((node) => node.id === id));
      if (missing.length > 0) {
        return { ok: false, error: `Cannot group missing element "${missing[0]}".` };
      }
      const groupId = operation.groupId ?? `group_${operation.ids[0]}`;
      for (const id of operation.ids) {
        const node = scene.find((item) => item.id === id);
        if (node && !node.groupIds.includes(groupId)) node.groupIds = [...node.groupIds, groupId];
      }
      return {
        ok: true,
        changes: [{ kind: "group", ids: [...operation.ids], summary: `Group ${operation.ids.length} elements` }],
      };
    }
    default:
      return { ok: false, error: "Unsupported operation." };
  }
}

function seedIds(operations: readonly DiagramOperation[]): Set<string> {
  const ids = new Set<string>();
  for (const operation of operations) {
    if (operation.op === "comment" || operation.op === "group") continue;
    if (operation.op === "add_arrow") {
      ids.add(operation.id);
      ids.add(operation.fromId);
      ids.add(operation.toId);
      continue;
    }
    ids.add(operation.id);
  }
  return ids;
}

/** Rebuild a changed element together with the arrows and shapes it is bound to. */
export function conversionClosure(scene: readonly SceneNode[], seed: ReadonlySet<string>): Set<string> {
  const next = new Set<string>();
  const queue: string[] = [];
  for (const id of seed) {
    if (scene.some((node) => node.id === id)) {
      next.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const id = queue.pop()!;
    const node = scene.find((item) => item.id === id);
    const related = new Set<string>();
    if (node?.fromId) related.add(node.fromId);
    if (node?.toId) related.add(node.toId);
    for (const other of scene) {
      if (other.fromId === id || other.toId === id) related.add(other.id);
    }
    for (const relatedId of related) {
      if (!next.has(relatedId) && scene.some((item) => item.id === relatedId)) {
        next.add(relatedId);
        queue.push(relatedId);
      }
    }
  }
  return next;
}

export function restoreScene(before: readonly SceneNode[]): SceneNode[] {
  return before.map((node) => ({ ...node, groupIds: [...node.groupIds] }));
}

export function commitScene(
  current: readonly SceneNode[],
  proposal: Proposal,
  decision: "accept" | "reject",
): readonly SceneNode[] {
  return decision === "accept" ? proposal.scene : current;
}

export function sceneSignature(scene: readonly SceneNode[]): string {
  return scene
    .map(
      (node) =>
        `${node.id}:${node.type}:${Math.round(node.x)}:${Math.round(node.y)}:${node.text ?? ""}:${node.fromId ?? ""}:${node.toId ?? ""}`,
    )
    .sort()
    .join("|");
}

export type Mutation = Exclude<Change, { kind: "note" }>;

export function mutatingChanges(changes: readonly Change[]): Mutation[] {
  return changes.filter((change): change is Mutation => change.kind !== "note");
}
