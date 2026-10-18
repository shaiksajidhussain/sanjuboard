import type { CanvasElement } from "@canvasai/shared";

const PROJECT_KEY = "canvasai.project.v1";
const HISTORY_KEY = "canvasai.history.v1";

export type StoredProject = {
  elements: CanvasElement[];
  appState?: { viewBackgroundColor?: string };
  files?: Record<string, { id: string; mimeType: string; dataURL: string }>;
};

export type HistoryEntry = {
  id: string;
  instruction: string;
  at: number;
  beforeElements: CanvasElement[];
  afterSignature: string;
};

export function loadProject(): StoredProject | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProject;
    if (!Array.isArray(parsed.elements)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProject(project: StoredProject): { ok: true } | { ok: false; error: string } {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage is full";
    return { ok: false, error: message };
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: readonly HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 8)));
  } catch {
    // History is optional. The diagram itself is stored separately.
  }
}
