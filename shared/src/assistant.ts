import { validateProposal } from "./apply";
import type { Proposal, SceneNode } from "./schema";

export type AssistantResult =
  | { ok: true; proposal: Proposal; provider: string }
  | { ok: false; error: string; status: number };

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The model returned an empty response.");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const sliced = start >= 0 && end > start ? trimmed.slice(start, end + 1) : "";
  for (const candidate of [trimmed, fenced, sliced]) {
    const parsed = parseModelJson(candidate);
    if (parsed !== undefined) return parsed;
  }
  const salvaged = salvageOperations(fenced || trimmed);
  if (salvaged) return salvaged;
  throw new Error("The model response was not JSON.");
}

function parseModelJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(value.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

function salvageOperations(text: string): { operations: unknown[] } | null {
  const marker = text.indexOf('"operations"');
  const start = text.indexOf("[", marker === -1 ? 0 : marker);
  if (start < 0) return null;
  const operations: unknown[] = [];
  let index = start + 1;
  while (index < text.length) {
    while (index < text.length && /[\s,]/.test(text[index] ?? "")) index += 1;
    if (index >= text.length || text[index] === "]") break;
    if (text[index] !== "{") break;
    const end = matchingBrace(text, index);
    if (end < 0) break;
    const parsed = parseModelJson(text.slice(index, end + 1));
    if (!parsed || typeof parsed !== "object") break;
    operations.push(parsed);
    index = end + 1;
  }
  return operations.length > 0 ? { operations } : null;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') quote = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function assistantSystemPrompt(): string {
  return [
    "You edit engineering diagrams for Sanju.",
    "Return one JSON object and nothing else: {\"operations\": [...]}",
    "Allowed operations:",
    "- add_shape { op, id, type: rectangle|ellipse|diamond|triangle|text, x, y, width?, height?, text?, backgroundColor?, strokeColor? }",
    "- update_shape { op, id, and at least one of x, y, width, height, text, backgroundColor, strokeColor }",
    "- add_arrow { op, id, fromId, toId, label?, strokeColor? }",
    "- delete_shape { op, id, confirmDelete: true } only when the user explicitly asks to remove something",
    "- move_shape { op, id, x, y }",
    "- group { op, ids, groupId? }",
    "- comment { op, kind: explanation|mermaid|suggestion, text }",
    "Rules:",
    "- Ids are 1-80 characters and use only letters, numbers, underscores, and hyphens.",
    "- New ids must not collide with existing ids.",
    "- Arrows must reference ids that exist now or that you add earlier in the array.",
    "- A system diagram is incomplete without arrows. Add one add_arrow for every relationship, after the shapes it connects. fromId and toId are shape ids.",
    "- Lay systems out left to right: clients, gateway, services, then data and external systems.",
    "- Give each box a backgroundColor: #d0ebff clients, #e5dbff services, #fff3bf decisions, #d3f9d8 data, #ffe8cc external systems. Stroke is #1e1e1e.",
    "- Write the full label. Use width 220 and height 84 or larger so words are not cut off.",
    "- Do not delete or restyle elements the user did not mention.",
    "- For explanations and Mermaid, return a comment and do not edit the canvas.",
    "- Shape type must be rectangle, ellipse, diamond, triangle, or text. Draw circles as ellipse and squares as rectangle.",
    "- Colors are #RRGGBB. Coordinates are finite numbers.",
    "- At most 40 operations.",
    "- Return compact JSON. Do not put a comma after the last item.",
    "- Never return code, shell commands, HTML, or Markdown outside the JSON object.",
  ].join("\n");
}

export function assistantUserPrompt(input: {
  instruction: string;
  scene: readonly SceneNode[];
  selectionIds?: readonly string[];
}): string {
  const compact = input.scene.map((node) => ({
    id: node.id,
    type: node.type,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    text: node.text,
    fromId: node.fromId,
    toId: node.toId,
  }));
  return JSON.stringify({
    instruction: input.instruction,
    selectedIds: input.selectionIds ?? [],
    elements: compact,
  });
}

export function interpretModelOutput(
  scene: readonly SceneNode[],
  payload: unknown,
): { ok: true; proposal: Proposal } | { ok: false; error: string } {
  return validateProposal(scene, payload);
}

export async function requestProposal(
  fetcher: typeof fetch,
  body: { instruction: string; scene: SceneNode[]; selectionIds?: string[] },
): Promise<AssistantResult> {
  try {
    const response = await fetcher("/api/ai/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; proposal?: Proposal; provider?: string }
      | null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: payload?.error || `The assistant request failed (${response.status}). The canvas was not changed.`,
      };
    }
    if (!payload?.proposal) {
      return { ok: false, status: 502, error: "The assistant response was incomplete. The canvas was not changed." };
    }
    const checked = validateProposal(body.scene, { operations: payload.proposal.operations });
    if (!checked.ok) return { ok: false, status: 422, error: checked.error };
    return { ok: true, proposal: checked.proposal, provider: payload.provider ?? "unknown" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return {
      ok: false,
      status: 0,
      error: `Could not reach the assistant (${message}). The canvas was not changed.`,
    };
  }
}
