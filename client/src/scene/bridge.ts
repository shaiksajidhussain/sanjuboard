import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  isModeledElementType,
  type CanvasElement,
  type SceneNode,
} from "@canvasai/shared";

export function nodeToSkeleton(node: SceneNode, scene: ReadonlyMap<string, SceneNode> = new Map()) {
  const groupIds = node.groupIds.length > 0 ? node.groupIds : undefined;
  if (node.type === "arrow") {
    const from = node.fromId ? scene.get(node.fromId) : undefined;
    const to = node.toId ? scene.get(node.toId) : undefined;
    const loose = from?.type === "triangle" || to?.type === "triangle";
    if (loose && from && to) {
      const startX = from.x + from.width / 2;
      const startY = from.y + from.height / 2;
      const endX = to.x + to.width / 2;
      const endY = to.y + to.height / 2;
      return {
        type: "arrow" as const,
        id: node.id,
        x: startX,
        y: startY,
        width: endX - startX,
        height: endY - startY,
        points: [
          [0, 0],
          [endX - startX, endY - startY],
        ],
        strokeColor: node.strokeColor ?? "#1e1e1e",
        roughness: 0,
        strokeWidth: 2,
        groupIds,
        label: node.text ? { text: node.text, fontSize: 20, fontFamily: 2 } : undefined,
        customData: { fromId: from.id, toId: to.id },
      };
    }
    return {
      type: "arrow" as const,
      id: node.id,
      x: node.x,
      y: node.y,
      strokeColor: node.strokeColor ?? "#1e1e1e",
      roughness: 0,
      strokeWidth: 2,
      groupIds,
      label: node.text ? { text: node.text, fontSize: 20, fontFamily: 2 } : undefined,
      start: node.fromId ? { id: node.fromId } : undefined,
      end: node.toId ? { id: node.toId } : undefined,
    };
  }
  if (node.type === "triangle") {
    const width = node.width;
    const height = node.height;
    return {
      type: "line" as const,
      id: node.id,
      x: node.x,
      y: node.y,
      width,
      height,
      points: [
        [width / 2, 0],
        [width, height],
        [0, height],
        [width / 2, 0],
      ],
      strokeColor: node.strokeColor ?? "#1e1e1e",
      backgroundColor: node.backgroundColor ?? "transparent",
      roughness: 0,
      strokeWidth: 2,
      groupIds,
      label: node.text ? { text: node.text, fontSize: 20, fontFamily: 2 } : undefined,
      customData: { sanjuShape: "triangle" as const },
    };
  }
  if (node.type === "line") {
    return {
      type: "line" as const,
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      strokeColor: node.strokeColor ?? "#1e1e1e",
      groupIds,
    };
  }
  if (node.type === "text") {
    return {
      type: "text" as const,
      id: node.id,
      x: node.x,
      y: node.y,
      text: node.text ?? "",
      strokeColor: node.strokeColor ?? "#1e1e1e",
      groupIds,
    };
  }
  return {
    type: node.type,
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    backgroundColor: node.backgroundColor ?? "#fff",
    strokeColor: node.strokeColor ?? "#1e1e1e",
    roughness: 0,
    strokeWidth: 2,
    roundness: { type: 3 as const },
    groupIds,
    label: node.text ? { text: node.text, fontSize: 20, fontFamily: 2 } : undefined,
  };
}

function sameGroups(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function materializeScene(
  current: readonly CanvasElement[],
  next: readonly SceneNode[],
  convertIds: readonly string[],
): CanvasElement[] {
  const convertSet = new Set(convertIds);
  const nextById = new Map(next.map((node) => [node.id, node]));
  const keepIds = new Set(next.filter((node) => !convertSet.has(node.id)).map((node) => node.id));

  const kept = current
    .filter((element) => {
      if (element.isDeleted) return false;
      if (keepIds.has(element.id)) return true;
      if (element.containerId && keepIds.has(element.containerId)) return true;
      if (!isModeledElementType(element.type)) return true;
      return false;
    })
    .map((element) => {
      const node = nextById.get(element.id);
      if (!node) return element;
      const groups = [...(element.groupIds ?? [])];
      if (sameGroups(groups, node.groupIds)) return element;
      return {
        ...element,
        groupIds: [...node.groupIds],
        version: (element.version ?? 1) + 1,
      };
    });

  const skeletons = convertIds
    .map((id) => nextById.get(id))
    .filter((node): node is SceneNode => Boolean(node))
    .map((node) => nodeToSkeleton(node, nextById));

  const created =
    skeletons.length > 0
      ? (convertToExcalidrawElements(skeletons, {
          regenerateIds: false,
        }) as CanvasElement[])
      : [];

  return [...kept, ...created];
}

export function elementSignature(elements: readonly CanvasElement[]): string {
  return elements
    .filter((element) => !element.isDeleted)
    .map(
      (element) =>
        `${element.id}:${element.type}:${Math.round(element.x / 4)}:${Math.round(element.y / 4)}:${element.text ?? ""}:${element.containerId ?? ""}`,
    )
    .sort()
    .join("|");
}
