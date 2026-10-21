import type { CanvasElement } from "@canvasai/shared";
import { HISTORY_KEY, PROJECT_KEY, type HistoryEntry, type StoredProject } from "./storage";

export const LIBRARY_KEY = "canvasai.library.v1";
export const THEME_KEY = "canvasai.theme.v1";

export type ThemeName = "light" | "dark";

export type SourceReference = {
  elementId: string;
  path: string;
};

export type DiagramRecord = {
  id: string;
  name: string;
  updatedAt: number;
  elements: CanvasElement[];
  appState?: { viewBackgroundColor?: string };
  files?: StoredProject["files"];
  notes: string;
  history: HistoryEntry[];
  references: SourceReference[];
};

export type Library = {
  version: 1;
  activeId: string;
  diagrams: DiagramRecord[];
};

export function readTheme(storage: Pick<Storage, "getItem">, prefersDark = false): ThemeName {
  const stored = storage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return prefersDark ? "dark" : "light";
}

export function writeTheme(storage: Pick<Storage, "setItem">, theme: ThemeName): void {
  storage.setItem(THEME_KEY, theme);
}

export function readLibrary(storage: Pick<Storage, "getItem">): Library {
  const raw = storage.getItem(LIBRARY_KEY);
  if (raw) {
    const parsed = parseLibrary(raw);
    if (parsed) return parsed;
  }
  return libraryFromLegacy(storage);
}

export function saveLibrary(storage: Pick<Storage, "setItem">, library: Library): { ok: true } | { ok: false; error: string } {
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(library));
    const active = activeDiagram(library);
    storage.setItem(
      PROJECT_KEY,
      JSON.stringify({
        elements: active.elements,
        appState: active.appState,
        files: active.files,
      } satisfies StoredProject),
    );
    storage.setItem(HISTORY_KEY, JSON.stringify(active.history.slice(0, 8)));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage is full";
    return { ok: false, error: message };
  }
}

export function activeDiagram(library: Library): DiagramRecord {
  return library.diagrams.find((diagram) => diagram.id === library.activeId) ?? library.diagrams[0];
}

export function writeActive(library: Library, patch: Partial<Omit<DiagramRecord, "id">>): Library {
  const current = activeDiagram(library);
  return {
    version: 1,
    activeId: current.id,
    diagrams: library.diagrams.map((diagram) =>
      diagram.id === current.id ? { ...diagram, ...patch, id: diagram.id, updatedAt: Date.now() } : diagram,
    ),
  };
}

export function createDiagram(library: Library, name = "Untitled diagram"): Library {
  const diagram = blankDiagram(name);
  return { version: 1, activeId: diagram.id, diagrams: [diagram, ...library.diagrams] };
}

export function renameDiagram(library: Library, id: string, name: string): Library {
  const nextName = cleanName(name);
  return {
    ...library,
    diagrams: library.diagrams.map((diagram) =>
      diagram.id === id ? { ...diagram, name: nextName, updatedAt: Date.now() } : diagram,
    ),
  };
}

export function duplicateDiagram(library: Library, id: string): Library | null {
  const source = library.diagrams.find((diagram) => diagram.id === id);
  if (!source) return null;
  const copy = blankDiagram(`Copy of ${source.name}`);
  copy.elements = structuredClone(source.elements);
  copy.appState = source.appState ? { ...source.appState } : undefined;
  copy.files = source.files ? structuredClone(source.files) : undefined;
  copy.notes = source.notes;
  copy.history = structuredClone(source.history);
  copy.references = structuredClone(source.references);
  return { version: 1, activeId: copy.id, diagrams: [copy, ...library.diagrams] };
}

export function deleteDiagram(
  library: Library,
  id: string,
): { ok: true; library: Library } | { ok: false; error: string } {
  if (library.diagrams.length <= 1) {
    return { ok: false, error: "Keep at least one diagram." };
  }
  const diagrams = library.diagrams.filter((diagram) => diagram.id !== id);
  const activeId = library.activeId === id ? diagrams[0].id : library.activeId;
  return { ok: true, library: { version: 1, activeId, diagrams } };
}

export function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, 80);
  return trimmed || "Untitled diagram";
}

function libraryFromLegacy(storage: Pick<Storage, "getItem">): Library {
  const diagram = blankDiagram("Untitled diagram");
  const projectRaw = storage.getItem(PROJECT_KEY);
  if (projectRaw) {
    try {
      const project = JSON.parse(projectRaw) as StoredProject;
      if (Array.isArray(project.elements)) {
        diagram.elements = project.elements;
        diagram.appState = project.appState;
        diagram.files = project.files;
        diagram.name = "Saved diagram";
      }
    } catch {
      // Keep the blank diagram. The corrupt legacy value stays untouched.
    }
  }
  const historyRaw = storage.getItem(HISTORY_KEY);
  if (historyRaw) {
    try {
      const history = JSON.parse(historyRaw) as HistoryEntry[];
      if (Array.isArray(history)) diagram.history = history.slice(0, 8);
    } catch {
      diagram.history = [];
    }
  }
  return { version: 1, activeId: diagram.id, diagrams: [diagram] };
}

function parseLibrary(raw: string): Library | null {
  try {
    const parsed = JSON.parse(raw) as Library;
    if (parsed.version !== 1 || !Array.isArray(parsed.diagrams) || parsed.diagrams.length === 0) return null;
    const diagrams = parsed.diagrams.filter((diagram) => diagram && Array.isArray(diagram.elements) && diagram.id);
    if (diagrams.length === 0) return null;
    const normalized = diagrams.map((diagram) => ({
      id: String(diagram.id),
      name: cleanName(diagram.name ?? ""),
      updatedAt: Number(diagram.updatedAt) || Date.now(),
      elements: diagram.elements,
      appState: diagram.appState,
      files: diagram.files,
      notes: typeof diagram.notes === "string" ? diagram.notes : "",
      history: Array.isArray(diagram.history) ? diagram.history.slice(0, 8) : [],
      references: Array.isArray(diagram.references)
        ? diagram.references.filter((item) => item && typeof item.elementId === "string" && typeof item.path === "string")
        : [],
    }));
    const activeId = normalized.some((diagram) => diagram.id === parsed.activeId) ? parsed.activeId : normalized[0].id;
    return { version: 1, activeId, diagrams: normalized };
  } catch {
    return null;
  }
}

function blankDiagram(name: string): DiagramRecord {
  return {
    id: `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName(name),
    updatedAt: Date.now(),
    elements: [],
    appState: { viewBackgroundColor: "#f7f5f1" },
    notes: "",
    history: [],
    references: [],
  };
}
