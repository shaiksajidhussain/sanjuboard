import {
  type Change,
  type DiagramOperation,
  type Proposal,
  type SceneNode,
  modelResponseSchema,
  normalizeModelPayload,
} from "./schema";

const BINDABLE = new Set(["rectangle", "ellipse", "diamond", "triangle", "text"]);
const LAYER_COLORS = ["#d0ebff", "#e5dbff", "#fff3bf", "#d3f9d8", "#ffe8cc"];

function fitBox(
  type: SceneNode["type"],
  text: string | undefined,
  width: number,
  height: number,
): { width: number; height: number } {
  const label = text?.trim();
  if (!label || type === "text" || type === "arrow" || type === "line") return { width, height };
  const words = label.split(/\s+/);
  const longest = words.reduce((max, word) => Math.max(max, word.length), 1);
  const roomy = type === "diamond" || type === "triangle";
  const widthFit = Math.min(420, Math.max(width, longest * 11 + (roomy ? 72 : 40), roomy ? 180 : 168));
  const perLine = Math.max(1, Math.floor((widthFit - (roomy ? 64 : 32)) / 11));
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used === 0) used = word.length;
    else if (used + 1 + word.length <= perLine) used += 1 + word.length;
    else {
      lines += 1;
      used = word.length;
    }
  }
  const heightFit = Math.min(
    240,
    Math.max(height, lines * 26 + (roomy ? 56 : 32), roomy ? 128 : 72),
  );
  return { width: widthFit, height: heightFit };
}

function resolveNode(scene: readonly SceneNode[], id: string): SceneNode | undefined {
  const direct = scene.find((node) => node.id === id);
  if (direct) return direct;
  const needle = id.replace(/[_-]+/g, " ").trim().toLowerCase();
  return scene.find((node) => {
    const text = (node.text ?? "").trim().toLowerCase();
    return text === needle || text.replace(/[^a-z0-9]+/g, " ").trim() === needle;
  });
}

function linkUnconnected(scene: SceneNode[], operations: readonly DiagramOperation[]): DiagramOperation[] {
  const added = operations.filter((operation) => operation.op === "add_shape");
  if (added.length < 3 || added.length > 24 || operations.some((operation) => operation.op === "add_arrow")) {
    return [];
  }
  const shapes = added
    .map((operation) => scene.find((node) => node.id === operation.id))
    .filter((node): node is SceneNode => Boolean(node && BINDABLE.has(node.type)));
  if (shapes.length < 3) return [];

  const columns: SceneNode[][] = [];
  for (const node of [...shapes].sort((left, right) => left.x - right.x || left.y - right.y)) {
    const column = columns.find((group) => Math.abs((group[0]?.x ?? node.x) - node.x) < 170);
    if (column) column.push(node);
    else columns.push([node]);
  }
  for (const column of columns) column.sort((left, right) => left.y - right.y);
  columns.forEach((column, index) => {
    if (columns.length < 2) return;
    for (const node of column) {
      if (!node.backgroundColor) node.backgroundColor = LAYER_COLORS[index % LAYER_COLORS.length];
    }
  });

  const pairs: Array<readonly [SceneNode, SceneNode]> = [];
  if (columns.length < 2) {
    const ordered = [...shapes].sort((left, right) => left.y - right.y || left.x - right.x);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const from = ordered[index];
      const to = ordered[index + 1];
      if (from && to) pairs.push([from, to]);
    }
  } else {
    for (let index = 0; index < columns.length - 1; index += 1) {
      const fromColumn = columns[index] ?? [];
      const toColumn = columns[index + 1] ?? [];
      const fromLead = fromColumn[0];
      const toLead = toColumn[0];
      if (!fromLead || !toLead) continue;
      if (fromColumn.length === 1) {
        for (const to of toColumn) pairs.push([fromLead, to]);
      } else if (toColumn.length === 1) {
        for (const from of fromColumn) pairs.push([from, toLead]);
      } else {
        for (const from of fromColumn) {
          const to = [...toColumn].sort(
            (left, right) => Math.abs(left.y - from.y) - Math.abs(right.y - from.y),
          )[0];
          if (to) pairs.push([from, to]);
        }
      }
    }
  }

  const used = new Set(scene.map((node) => node.id));
  const arrows: DiagramOperation[] = [];
  for (const [from, to] of pairs) {
    if (arrows.length >= 24 || from.id === to.id) continue;
    let id = `link_${from.id}_${to.id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    let suffix = 2;
    while (!id || used.has(id)) {
      id = `link_${from.id}_${to.id}_${suffix}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
      suffix += 1;
    }
    used.add(id);
    arrows.push({ op: "add_arrow", id, fromId: from.id, toId: to.id, strokeColor: "#1e1e1e" });
  }
  return arrows;
}

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
  const operations = [...parsed.data.operations];

  for (const operation of parsed.data.operations) {
    const applied = applyOperation(working, operation);
    if (!applied.ok) return applied;
    changes.push(...applied.changes);
  }
  for (const operation of linkUnconnected(working, operations)) {
    const applied = applyOperation(working, operation);
    if (!applied.ok) continue;
    operations.push(operation);
    changes.push(...applied.changes);
  }

  return {
    ok: true,
    proposal: {
      operations,
      changes,
      scene: working,
      convertIds: [...conversionClosure(working, seedIds(operations))],
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
      const fitted = fitBox(
        operation.type,
        operation.text,
        operation.width ?? (operation.type === "text" ? 160 : 180),
        operation.height ??
          (operation.type === "diamond" || operation.type === "triangle" ? 140 : operation.type === "text" ? 40 : 88),
      );
      const node: SceneNode = {
        id: operation.id,
        type: operation.type,
        x: operation.x,
        y: operation.y,
        width: fitted.width,
        height: fitted.height,
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
      const from = resolveNode(scene, operation.fromId);
      const to = resolveNode(scene, operation.toId);
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

/** Apply a proposal only when the canvas still matches the scene that was reviewed. */
export function applyIfUnchanged(
  current: readonly SceneNode[],
  proposal: { operations: readonly DiagramOperation[] },
  baseSignature: string,
): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  if (sceneSignature(current) !== baseSignature) {
    return {
      ok: false,
      error: "The canvas changed after this proposal. Nothing was changed.",
    };
  }
  return validateProposal(current, { operations: proposal.operations });
}

export type SnapshotEntry = {
  id: string;
  afterSignature: string;
  beforeElements: unknown;
};

/** Restore one accepted edit. A later manual edit blocks restoration unless force is set. */
export function restoreSnapshot<T extends SnapshotEntry>(
  entries: readonly T[],
  id: string,
  currentSignature: string,
  force = false,
): { ok: true; entry: T; entries: T[] } | { ok: false; error: string } {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return { ok: false, error: "That snapshot is not in the history." };
  if (!force && currentSignature !== entry.afterSignature) {
    return { ok: false, error: "The canvas changed after this edit. Nothing was restored." };
  }
  return {
    ok: true,
    entry: structuredClone(entry),
    entries: entries.filter((item) => item.id !== id),
  };
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
        `${node.id}:${node.type}:${Math.round(node.x)}:${Math.round(node.y)}:${Math.round(node.width)}:${Math.round(node.height)}:${node.text ?? ""}:${node.backgroundColor ?? ""}:${node.strokeColor ?? ""}:${node.fromId ?? ""}:${node.toId ?? ""}`,
    )
    .sort()
    .join("|");
}

export type Mutation = Exclude<Change, { kind: "note" }>;

export function mutatingChanges(changes: readonly Change[]): Mutation[] {
  return changes.filter((change): change is Mutation => change.kind !== "note");
}
