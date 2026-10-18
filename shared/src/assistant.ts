import { validateProposal } from "./apply";
import type { Proposal, SceneNode } from "./schema";

export type AssistantResult =
  | { ok: true; proposal: Proposal; provider: string }
  | { ok: false; error: string; status: number };

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The model returned an empty response.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1]);
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("The model response was not JSON.");
  }
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
    "- Do not delete or restyle elements the user did not mention.",
    "- For explanations and Mermaid, return a comment and do not edit the canvas.",
    "- Shape type must be rectangle, ellipse, diamond, triangle, or text. Draw circles as ellipse and squares as rectangle.",
    "- Colors are #RRGGBB. Coordinates are finite numbers.",
    "- At most 24 operations.",
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
