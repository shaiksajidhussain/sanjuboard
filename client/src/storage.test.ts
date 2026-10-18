import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHistory, loadProject, saveHistory, saveProject, type HistoryEntry } from "./storage";

const memory = new Map<string, string>();

function installMemory() {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("T08 save and reopen", () => {
  it("round-trips elements, labels, and arrow endpoints", () => {
    installMemory();
    const saved = saveProject({
      elements: [
        { id: "api", type: "rectangle", x: 12, y: 24, width: 100, height: 40, text: "API" },
        {
          id: "link",
          type: "arrow",
          x: 80,
          y: 40,
          width: 40,
          height: 1,
          startBinding: { elementId: "api" },
          endBinding: { elementId: "db" },
        },
      ],
      appState: { viewBackgroundColor: "#f7f5f1" },
    });
    expect(saved.ok).toBe(true);
    const opened = loadProject();
    expect(opened?.elements.map((element) => [element.id, element.type, element.x, element.text])).toEqual([
      ["api", "rectangle", 12, "API"],
      ["link", "arrow", 80, undefined],
    ]);
    expect(opened?.elements[1]).toMatchObject({
      startBinding: { elementId: "api" },
      endBinding: { elementId: "db" },
    });
    expect(opened?.appState?.viewBackgroundColor).toBe("#f7f5f1");
  });

  it("recovers from corrupt storage without throwing", () => {
    installMemory();
    memory.set("canvasai.project.v1", "{");
    memory.set("canvasai.history.v1", "null");
    expect(loadProject()).toBeNull();
    expect(loadHistory()).toEqual([]);
  });

  it("keeps only the eight newest history entries", () => {
    installMemory();
    const entries: HistoryEntry[] = Array.from({ length: 10 }, (_, index) => ({
      id: `ai_${index}`,
      instruction: `edit ${index}`,
      at: index,
      beforeElements: [],
      afterSignature: String(index),
    }));
    saveHistory(entries);
    expect(loadHistory()).toHaveLength(8);
    expect(loadHistory()[0]?.id).toBe("ai_0");
  });

  it("reports a failed save without discarding the previous value", () => {
    installMemory();
    saveProject({ elements: [{ id: "api", type: "rectangle", x: 1, y: 2, width: 3, height: 4 }] });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    });
    const failed = saveProject({ elements: [] });
    expect(failed.ok).toBe(false);
    expect(loadProject()?.elements).toHaveLength(1);
  });
});
