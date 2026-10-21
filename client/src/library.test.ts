import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiagram,
  deleteDiagram,
  duplicateDiagram,
  readLibrary,
  readTheme,
  renameDiagram,
  saveLibrary,
  writeTheme,
  type Library,
} from "./library";
import { HISTORY_KEY, PROJECT_KEY } from "./storage";

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

describe("diagram library", () => {
  it("keeps an older single-diagram save and does not drop it", () => {
    installMemory();
    memory.set(
      PROJECT_KEY,
      JSON.stringify({
        elements: [{ id: "api", type: "rectangle", x: 12, y: 8, width: 40, height: 20, text: "API" }],
        appState: { viewBackgroundColor: "#f7f5f1" },
      }),
    );
    memory.set(HISTORY_KEY, JSON.stringify([{ id: "ai_1", instruction: "Add API", at: 1, beforeElements: [], afterSignature: "a" }]));
    const library = readLibrary(localStorage);
    expect(library.diagrams).toHaveLength(1);
    expect(library.diagrams[0]?.elements[0]).toMatchObject({ id: "api", text: "API", x: 12 });
    expect(library.diagrams[0]?.history[0]?.instruction).toBe("Add API");
    expect(memory.get(PROJECT_KEY)).toContain('"api"');
  });

  it("renames, duplicates, and refuses to delete the last diagram", () => {
    installMemory();
    const first = readLibrary(localStorage);
    const named = renameDiagram(first, first.activeId, "Billing");
    const copied = duplicateDiagram(named, named.activeId);
    expect(copied?.diagrams).toHaveLength(2);
    expect(copied?.diagrams[0]?.name).toBe("Copy of Billing");
    expect(copied?.diagrams[0]?.elements).toEqual(named.diagrams[0]?.elements);
    const removed = deleteDiagram(copied as Library, copied?.diagrams[1]?.id ?? "");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(deleteDiagram(removed.library, removed.library.activeId).ok).toBe(false);
  });

  it("mirrors the open diagram to the legacy project key", () => {
    installMemory();
    const created = createDiagram(readLibrary(localStorage), "Notes");
    const withNotes = {
      ...created,
      diagrams: created.diagrams.map((diagram) =>
        diagram.id === created.activeId ? { ...diagram, notes: "# Why\n\nA boundary." } : diagram,
      ),
    };
    expect(saveLibrary(localStorage, withNotes).ok).toBe(true);
    const opened = readLibrary(localStorage);
    expect(opened.activeId).toBe(created.activeId);
    expect(opened.diagrams.find((diagram) => diagram.id === created.activeId)?.notes).toContain("boundary");
    const legacy = JSON.parse(memory.get(PROJECT_KEY) ?? "{}") as { notes?: string; elements?: unknown[] };
    expect(legacy.elements).toEqual([]);
    expect(legacy.notes).toBeUndefined();
  });

  it("stores the theme outside the diagram", () => {
    installMemory();
    const library = readLibrary(localStorage);
    saveLibrary(localStorage, library);
    writeTheme(localStorage, "dark");
    expect(readTheme(localStorage)).toBe("dark");
    expect(memory.get("canvasai.library.v1")).not.toContain("dark");
    expect(readTheme({ getItem: () => null }, true)).toBe("dark");
  });
});
