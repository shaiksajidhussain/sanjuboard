import { z } from "zod";

export const elementIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,80}$/, "Element ids must be 1-80 letters, numbers, underscores, or hyphens");

const hexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const sceneNodeSchema = z.object({
  id: elementIdSchema,
  type: z.enum(["rectangle", "ellipse", "diamond", "triangle", "text", "arrow", "line"]),
  x: z.number().finite().min(-20000).max(20000),
  y: z.number().finite().min(-20000).max(20000),
  width: z.number().finite().positive().max(8000),
  height: z.number().finite().positive().max(8000),
  text: z.string().max(500).optional(),
  fromId: elementIdSchema.optional(),
  toId: elementIdSchema.optional(),
  backgroundColor: hexSchema.optional(),
  strokeColor: hexSchema.optional(),
  groupIds: z.array(elementIdSchema).max(8).default([]),
});

export type SceneNode = z.output<typeof sceneNodeSchema>;

const updateFields = {
  x: z.number().finite().min(-20000).max(20000).optional(),
  y: z.number().finite().min(-20000).max(20000).optional(),
  width: z.number().finite().positive().max(8000).optional(),
  height: z.number().finite().positive().max(8000).optional(),
  text: z.string().max(500).optional(),
  backgroundColor: hexSchema.optional(),
  strokeColor: hexSchema.optional(),
} as const;

export const operationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_shape"),
    id: elementIdSchema,
    type: z.enum(["rectangle", "ellipse", "diamond", "triangle", "text", "line"]),
    x: z.number().finite().min(-20000).max(20000),
    y: z.number().finite().min(-20000).max(20000),
    width: z.number().finite().positive().max(8000).optional(),
    height: z.number().finite().positive().max(8000).optional(),
    text: z.string().max(500).optional(),
    backgroundColor: hexSchema.optional(),
    strokeColor: hexSchema.optional(),
  }),
  z.object({
    op: z.literal("update_shape"),
    id: elementIdSchema,
    ...updateFields,
  }),
  z.object({
    op: z.literal("add_arrow"),
    id: elementIdSchema,
    fromId: elementIdSchema,
    toId: elementIdSchema,
    label: z.string().max(200).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    strokeColor: hexSchema.optional(),
  }),
  z.object({
    op: z.literal("delete_shape"),
    id: elementIdSchema,
    confirmDelete: z.literal(true),
  }),
  z.object({
    op: z.literal("move_shape"),
    id: elementIdSchema,
    x: z.number().finite().min(-20000).max(20000),
    y: z.number().finite().min(-20000).max(20000),
  }),
  z.object({
    op: z.literal("group"),
    ids: z.array(elementIdSchema).min(2).max(40),
    groupId: elementIdSchema.optional(),
  }),
  z.object({
    op: z.literal("comment"),
    kind: z.enum(["explanation", "mermaid", "suggestion"]),
    text: z.string().min(1).max(8000),
  }),
]);

export type DiagramOperation = z.output<typeof operationSchema>;

const SHAPE_ALIASES: Record<string, "rectangle" | "ellipse" | "diamond" | "triangle" | "text"> = {
  rectangle: "rectangle",
  square: "rectangle",
  box: "rectangle",
  rect: "rectangle",
  ellipse: "ellipse",
  circle: "ellipse",
  oval: "ellipse",
  diamond: "diamond",
  rhombus: "diamond",
  triangle: "triangle",
  pyramid: "triangle",
  text: "text",
  label: "text",
};

const NAMED_COLORS: Record<string, string | null> = {
  transparent: null,
  black: "#1e1e1e",
  white: "#ffffff",
  red: "#e03131",
  green: "#2f9e44",
  blue: "#1971c2",
  yellow: "#ffd43b",
  orange: "#f08c00",
  gray: "#868e96",
  grey: "#868e96",
};

function elementToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return trimmed;
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return slug || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim().replace(/px$/i, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  if (raw in NAMED_COLORS) return NAMED_COLORS[raw] ?? undefined;
  const hex = raw.startsWith("#") ? raw.slice(1) : "";
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${hex.split("").map((char) => char + char).join("")}`;
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{8}$/.test(hex)) return `#${hex.slice(0, 6)}`;
  return undefined;
}

export function normalizeModelPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { operations?: unknown }).operations)) {
    return payload;
  }
  const body = payload as { operations: unknown[] };
  const operations = body.operations.slice(0, 48).map((operation) => {
      if (!operation || typeof operation !== "object") return operation;
      const record = { ...(operation as Record<string, unknown>) };
      if (record.op === "add_shape" && (typeof record.type !== "string" || !record.type.trim())) {
        const hinted = record.shape ?? record.shapeType;
        if (typeof hinted === "string" && hinted.trim()) {
          record.type = hinted;
        } else {
          const from = elementToken(record.fromId ?? record.from ?? record.sourceId ?? record.source);
          const to = elementToken(record.toId ?? record.to ?? record.targetId ?? record.target);
          if (from && to) {
            record.op = "add_arrow";
            record.fromId = from;
            record.toId = to;
            if (typeof record.text === "string" && record.label == null) record.label = record.text;
          } else {
            record.type = "rectangle";
          }
        }
      }
      if (record.op === "add_shape" && typeof record.type === "string") {
        const rawType = record.type.trim().toLowerCase();
        if (rawType === "line" || rawType === "connector" || rawType === "edge" || rawType === "arrow") {
          const from = elementToken(record.fromId ?? record.from ?? record.sourceId ?? record.source);
          const to = elementToken(record.toId ?? record.to ?? record.targetId ?? record.target);
          if (from && to) {
            record.op = "add_arrow";
            record.fromId = from;
            record.toId = to;
            if (typeof record.text === "string" && record.label == null) record.label = record.text;
            delete record.type;
            delete record.text;
            delete record.width;
            delete record.height;
          } else {
            record.type = "line";
          }
        } else {
          const alias = SHAPE_ALIASES[rawType];
          if (alias) record.type = alias;
        }
      }
      if (record.op === "connect" || record.op === "arrow") record.op = "add_arrow";
      if (record.op === "add_arrow") {
        const id = elementToken(record.id);
        if (id) record.id = id;
      }
      if (record.op === "add_arrow") {
        const from = elementToken(record.fromId ?? record.from ?? record.sourceId ?? record.source);
        const to = elementToken(record.toId ?? record.to ?? record.targetId ?? record.target);
        if (from) record.fromId = from;
        if (to) record.toId = to;
        delete record.from;
        delete record.to;
        delete record.source;
        delete record.target;
        delete record.sourceId;
        delete record.targetId;
      }
      for (const key of ["x", "y", "width", "height"] as const) {
        if (!(key in record)) continue;
        const number = finiteNumber(record[key]);
        if (number !== undefined) record[key] = number;
      }
      for (const key of ["backgroundColor", "strokeColor"] as const) {
        if (!(key in record)) continue;
        const color = normalizeColor(record[key]);
        if (color) record[key] = color;
        else delete record[key];
      }
      return record;
    });
  return { ...body, operations };
}

export const modelResponseSchema = z.object({
  operations: z.array(operationSchema).max(48),
});

export const proposeRequestSchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
  scene: z.array(sceneNodeSchema).max(200),
  selectionIds: z.array(elementIdSchema).max(200).optional(),
});

export type ProposeRequest = z.output<typeof proposeRequestSchema>;

export type Change =
  | { kind: "add"; id: string; summary: string }
  | { kind: "update"; id: string; summary: string }
  | { kind: "delete"; id: string; summary: string }
  | { kind: "group"; ids: string[]; summary: string }
  | { kind: "note"; noteKind: "explanation" | "mermaid" | "suggestion"; text: string };

export type Proposal = {
  operations: DiagramOperation[];
  changes: Change[];
  scene: SceneNode[];
  convertIds: string[];
};

export type CanvasElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  isDeleted?: boolean;
  containerId?: string | null;
  startBinding?: { elementId?: string | null } | null;
  endBinding?: { elementId?: string | null } | null;
  backgroundColor?: string;
  strokeColor?: string;
  groupIds?: readonly string[];
  version?: number;
  customData?: { sanjuShape?: "triangle"; fromId?: string; toId?: string } | null;
};

const MODELED = new Set(["rectangle", "ellipse", "diamond", "triangle", "text", "arrow", "line"]);

function hexOrUndefined(value: string | undefined): string | undefined {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
}

export function summarizeCanvas(elements: readonly CanvasElement[]): SceneNode[] {
  const labels = new Map<string, string>();
  for (const element of elements) {
    if (element.isDeleted) continue;
    if (element.type === "text" && element.containerId && element.text) {
      labels.set(element.containerId, element.text.slice(0, 500));
    }
  }

  const nodes: SceneNode[] = [];
  for (const element of elements) {
    if (element.isDeleted || !MODELED.has(element.type)) continue;
    if (element.type === "text" && element.containerId) continue;
    const rawText =
      element.type === "text" ? element.text : labels.get(element.id) ?? element.text;
    const text = rawText?.slice(0, 500);
    const type =
      element.type === "line" && element.customData?.sanjuShape === "triangle" ? "triangle" : element.type;
    const parsed = sceneNodeSchema.safeParse({
      id: element.id,
      type,
      x: Number.isFinite(element.x) ? element.x : 0,
      y: Number.isFinite(element.y) ? element.y : 0,
      width: Math.max(element.width || 0, 1),
      height: Math.max(element.height || 0, 1),
      text: text || undefined,
      fromId: element.startBinding?.elementId || element.customData?.fromId || undefined,
      toId: element.endBinding?.elementId || element.customData?.toId || undefined,
      backgroundColor: hexOrUndefined(element.backgroundColor),
      strokeColor: hexOrUndefined(element.strokeColor),
      groupIds: [...(element.groupIds ?? [])].filter((id) =>
        /^[A-Za-z0-9_-]{1,80}$/.test(id),
      ),
    });
    if (parsed.success) nodes.push(parsed.data);
  }
  return nodes;
}

export function isModeledElementType(type: string): boolean {
  return MODELED.has(type);
}
