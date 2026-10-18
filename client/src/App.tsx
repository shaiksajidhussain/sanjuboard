import { Excalidraw, CaptureUpdateAction, exportToBlob } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeDiagram,
  applyIfUnchanged,
  mutatingChanges,
  requestProposal,
  restoreSnapshot,
  sceneSignature,
  summarizeCanvas,
  type CanvasElement,
  type Proposal,
  type SceneNode,
} from "@canvasai/shared";
import { elementSignature, materializeScene } from "./scene/bridge";
import { SidePanel } from "./SidePanel";
import {
  loadHistory,
  loadProject,
  saveHistory,
  saveProject,
  type HistoryEntry,
} from "./storage";

type EditorApi = {
  getSceneElements: () => readonly CanvasElement[];
  updateScene: (scene: {
    elements?: readonly CanvasElement[];
    appState?: Record<string, unknown>;
    captureUpdate?: unknown;
  }) => void;
  getAppState: () => {
    viewBackgroundColor?: string;
    selectedElementIds?: Record<string, boolean>;
  };
  getFiles: () => Record<string, { id: string; mimeType: string; dataURL: string }>;
  scrollToContent: (target?: unknown) => void;
  addFiles: (files: { id: string; mimeType: string; dataURL: string }[]) => void;
};

type EditorFiles = ReturnType<EditorApi["getFiles"]>;
type SaveState = "Saved" | "Saving…" | "Not saved yet" | "Could not save";

const initialProject = loadProject();

export default function App() {
  const apiRef = useRef<EditorApi | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<"assistant" | "issues" | "history">("assistant");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalBase, setProposalBase] = useState("");
  const [provider, setProvider] = useState("…");
  const [saveState, setSaveState] = useState<SaveState>(initialProject ? "Saved" : "Not saved yet");
  const [sceneNodes, setSceneNodes] = useState<SceneNode[]>(() =>
    summarizeCanvas(initialProject?.elements ?? []),
  );
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [signature, setSignature] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const bindApi = useCallback((api: unknown) => {
    apiRef.current = api as EditorApi;
  }, []);

  const initialData = useMemo(
    () => ({
      elements: initialProject?.elements ?? [],
      appState: {
        viewBackgroundColor: initialProject?.appState?.viewBackgroundColor ?? "#f7f5f1",
      },
      files: initialProject?.files,
      scrollToContent: true,
    }),
    [],
  );

  const issues = useMemo(() => analyzeDiagram(sceneNodes), [sceneNodes]);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((body: { provider?: string }) => setProvider(body.provider ?? "offline"))
      .catch(() => setProvider("offline"));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.altKey && event.key.toLowerCase() === "a" && !typing) {
        event.preventDefault();
        setPanelOpen((open) => !open);
        setTab("assistant");
      } else if (event.key === "Escape" && panelOpen && !typing) {
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const persist = useCallback((elements: readonly CanvasElement[], files: EditorFiles, background?: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveState("Saving…");
    saveTimer.current = window.setTimeout(() => {
      const result = saveProject({
        elements: structuredClone([...elements]),
        appState: { viewBackgroundColor: background },
        files,
      });
      setSaveState(result.ok ? "Saved" : "Could not save");
    }, 400);
  }, []);

  const rememberElements = useCallback((elements: readonly CanvasElement[]) => {
    setSceneNodes(summarizeCanvas(elements));
    setSignature(elementSignature(elements));
  }, []);

  const onChange = useCallback(
    (elements: readonly CanvasElement[], appState: { viewBackgroundColor?: string }, files: EditorFiles) => {
      rememberElements(elements);
      persist(elements, files, appState.viewBackgroundColor);
    },
    [persist, rememberElements],
  );

  async function submit() {
    const api = apiRef.current;
    if (!api) return;
    setBusy(true);
    setError(null);
    const elements = api.getSceneElements();
    const scene = summarizeCanvas(elements);
    const selected = Object.entries(api.getAppState().selectedElementIds ?? {})
      .filter(([, isSelected]) => isSelected)
      .map(([id]) => id);
    const result = await requestProposal(fetch, {
      instruction,
      scene,
      selectionIds: selected,
    });
    setBusy(false);
    if (!result.ok) {
      setProposal(null);
      setError(result.error);
      return;
    }
    setProposal(result.proposal);
    setProposalBase(sceneSignature(scene));
    setProvider(result.provider);
  }

  function reject() {
    setProposal(null);
    setProposalBase("");
    setError(null);
  }

  function accept() {
    const api = apiRef.current;
    if (!api || !proposal) return;
    const current = [...api.getSceneElements()];
    const checked = applyIfUnchanged(summarizeCanvas(current), proposal, proposalBase);
    if (!checked.ok) {
      setError(checked.error);
      setProposal(null);
      setProposalBase("");
      return;
    }
    if (mutatingChanges(checked.proposal.changes).length === 0) {
      setProposal(null);
      setProposalBase("");
      return;
    }
    try {
      const beforeElements = structuredClone(current);
      const next = materializeScene(current, checked.proposal.scene, checked.proposal.convertIds);
      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.scrollToContent();
      const entry: HistoryEntry = {
        id: `ai_${Date.now()}`,
        instruction: instruction.trim() || "Assistant edit",
        at: Date.now(),
        beforeElements,
        afterSignature: elementSignature(api.getSceneElements()),
      };
      const nextHistory = [entry, ...history].slice(0, 8);
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setProposal(null);
      setProposalBase("");
      setError(null);
      setTab("history");
      rememberElements(api.getSceneElements());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The edit could not be applied.";
      setError(`${message} The canvas was not changed.`);
    }
  }

  function revert(id: string, force = false) {
    const api = apiRef.current;
    if (!api) return;
    const restored = restoreSnapshot(history, id, elementSignature(api.getSceneElements()), force);
    if (!restored.ok) return;
    api.updateScene({
      elements: structuredClone(restored.entry.beforeElements),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setHistory(restored.entries);
    saveHistory(restored.entries);
    rememberElements(api.getSceneElements());
  }

  function focusElement(id: string) {
    const api = apiRef.current;
    if (!api || !id) return;
    const element = api.getSceneElements().find((item) => item.id === id);
    api.updateScene({
      appState: { selectedElementIds: { [id]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    if (element) api.scrollToContent(element);
  }

  function exportJson() {
    const api = apiRef.current;
    if (!api) return;
    const payload = {
      type: "excalidraw",
      version: 2,
      source: "canvasai",
      elements: api.getSceneElements(),
      appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
      files: api.getFiles(),
    };
    download(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "sanju.excalidraw");
  }

  async function exportPng() {
    const api = apiRef.current;
    if (!api) return;
    const blob = await exportToBlob({
      elements: api.getSceneElements() as never,
      appState: {
        ...api.getAppState(),
        exportBackground: true,
      } as never,
      files: api.getFiles() as never,
      mimeType: "image/png",
    });
    download(blob, "sanju.png");
  }

  async function importJson(file: File) {
    const api = apiRef.current;
    if (!api) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        elements?: CanvasElement[];
        files?: EditorFiles;
        appState?: { viewBackgroundColor?: string };
      };
      if (!Array.isArray(parsed.elements)) {
        setError("That file does not contain a diagram.");
        return;
      }
      const files = parsed.files ? Object.values(parsed.files) : [];
      if (files.length > 0) api.addFiles(files);
      api.updateScene({
        elements: parsed.elements,
        appState: parsed.appState?.viewBackgroundColor
          ? { viewBackgroundColor: parsed.appState.viewBackgroundColor }
          : undefined,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.scrollToContent();
      setError(null);
    } catch {
      setError("Could not read that file. The canvas was not changed.");
    }
  }

  const historyView = history.map((entry) => ({
    id: entry.id,
    instruction: entry.instruction,
    at: entry.at,
    canRevert: signature === entry.afterSignature,
  }));

  return (
    <div className="shell flex h-full min-h-0 flex-col">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            S
          </span>
          <div>
            <div className="wordmark">Sanju</div>
            <div className="brand-sub">Board</div>
          </div>
        </div>
        <div className="actions">
          <span className="save" data-testid="save-state">
            {saveState}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
            Import
          </button>
          <button type="button" className="btn btn-ghost" aria-label="Export JSON" onClick={exportJson}>
            JSON
          </button>
          <button type="button" className="btn btn-ghost" aria-label="Export PNG" onClick={() => void exportPng()}>
            PNG
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setTab("issues");
              setPanelOpen(true);
            }}
          >
            Issues
          </button>
          <button
            type="button"
            aria-pressed={panelOpen}
            className="btn btn-primary"
            onClick={() => {
              setTab("assistant");
              setPanelOpen((open) => !open);
            }}
          >
            Assistant
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.excalidraw,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importJson(file);
            event.target.value = "";
          }}
        />
      </header>
      {proposal && mutatingChanges(proposal.changes).length > 0 && (
        <div data-testid="preview-banner" className="banner">
          Preview ready. The diagram stays unchanged until you accept.
        </div>
      )}
      <div className="stage">
        <div className="canvas-shell" data-testid="canvas-shell">
          <div>
            <Excalidraw
              excalidrawAPI={bindApi}
              initialData={initialData as never}
              onChange={onChange as never}
              aiEnabled={false}
            />
          </div>
        </div>
        <SidePanel
          open={panelOpen}
          tab={tab}
          onTab={setTab}
          onClose={() => setPanelOpen(false)}
          provider={provider}
          instruction={instruction}
          onInstruction={setInstruction}
          onSubmit={() => void submit()}
          busy={busy}
          error={error}
          proposal={proposal}
          onAccept={accept}
          onReject={reject}
          issues={issues}
          onFocus={focusElement}
          history={historyView}
          onRevert={(id) => revert(id)}
          onRestoreAnyway={(id) => revert(id, true)}
        />
      </div>
    </div>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
