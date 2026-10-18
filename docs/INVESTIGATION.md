# CanvasAI investigation

Date: 18 October 2026.

Target: [excalidraw.com](https://excalidraw.com/) and the public repository [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) at tag `v0.18.1` (`a2ec2889babf7d2295469c6d90ebe77fae57df84`).

This note separates what was observed, what was read in source, what is inferred, and what is unknown. It is the basis for the CanvasAI MVP in this directory. CanvasAI does not copy the Excalidraw application repository.

## REA status

REA skill version 42 is installed. `rea` is not on `PATH`. `npx -y rea-agents@6.5.0 doctor --client cursor --json` reported the Cursor registration missing at `/Users/sanju/.cursor/mcp.json` (`registration:cursor`, classification `config_drift`).

A read-only setup plan (`setup --client cursor --dry-run --json`) would create that registration and launch `npx -y rea-agents@6.5.0 mcp`, preserving unrelated MCP config. That write was not applied. It changes the user-level Cursor MCP file and still requires a client restart before tools appear in this session.

Excalidraw is a complete public source repository plus a live website. REA's own guidance says ordinary source-repository architecture analysis should use normal repository tools, not REA readiness or decompilers. Hopper is installed on this machine. Ghidra, IDA, and JADX are not configured. None of those engines apply to this web target.

Live UI notes below come from the Cursor browser on 18 October 2026. They are not REA Evidence records.

## What was verified

### Package and license

`npm view @excalidraw/excalidraw` on 18 October 2026:

- Version `0.18.1`
- License `MIT`
- Description: "Excalidraw as a React component"
- Peer dependencies: React and React DOM `^17.0.2 || ^18.2.0 || ^19.0.0`
- The package depends on RoughJS, Perfect Freehand, Jotai, and `@excalidraw/mermaid-to-excalidraw`
- Homepage: `packages/excalidraw` in the GitHub repository

The published component is the integration point. Rebuilding the drawing engine is unnecessary.

### Live UI (Cursor browser)

On an empty canvas at `https://excalidraw.com/`:

- Tools visible: lock, hand, selection (pressed by default), rectangle, diamond, ellipse, arrow, line, draw, text, sticky note, eraser, and More tools.
- Selecting the rectangle tool revealed Stroke and Background controls before any shape existed. Undo and redo were disabled.
- The welcome copy says drawings are saved in the browser's storage and can be cleared unexpectedly. Open is shown as Cmd+O. Help is `?`. Pan instructions: scroll wheel, or Space while dragging, or the hand tool.
- Zoom out, reset zoom, and zoom in are in the footer, next to undo and redo.
- Library and live collaboration are separate buttons. A Sign up link is present.
- More tools contains: Insert image (`9`), Frame (`F`), Web Embed, Draw to shape (`Shift+X`), Laser pointer (`K`), Bucket fill (`B`), Text to diagram (AI), Mermaid to Excalidraw, and Wireframe to code (AI).
- Text to diagram opens a dialog titled "Let's design your diagram" with tabs "Text to diagram" (marked AI Beta) and "Mermaid". The copy says it can generate Flowchart, Sequence, Class, State, and Entity Relationship diagrams from a prompt. The submit control starts disabled.

Pointer-drag drawing was not completed in this browser session. The Cursor drag tool does not drive Excalidraw's canvas pointer handlers, and the text-to-diagram dialog was covering the canvas during the later attempt. Drawing behavior below is therefore from source, not from a completed live stroke.

### Source findings (tag v0.18.1)

Entry and component API, `packages/excalidraw/index.tsx`:

- The package exports a React `Excalidraw` component.
- `aiEnabled` defaults to on (`aiEnabled !== false`) inside the component. The hosted text-to-diagram and diagram-to-code UI is composed by `excalidraw-app`, not by every embed.
- Public exports used by CanvasAI: `convertToExcalidrawElements`, `CaptureUpdateAction`, `exportToBlob`.

Imperative API, `packages/excalidraw/types.ts`:

- `updateScene`, `getSceneElements`, `getAppState`, `getFiles`, `addFiles`, `scrollToContent`, `setActiveTool`.
- `history` on that public API only exposes `clear`. Undo and redo exist on the internal history class and on the on-canvas buttons. Keyboard undo remains inside the editor. CanvasAI cannot call `api.history.undo()`.

`updateScene` history, documented in the v0.18 release notes and `CaptureUpdateAction`:

- `IMMEDIATELY` records an undo step.
- `NEVER` does not.
- The older `commitToHistory` flag is gone.

Programmatic elements, official docs at `docs.excalidraw.com` for `convertToExcalidrawElements`:

- The skeleton API is documented as beta.
- It supports rectangles, ellipses, diamonds, text, lines, arrows, labels, arrow bindings by id, sticky notes, and frames.
- Ids are regenerated unless `regenerateIds: false`.

Element model, `packages/excalidraw/element/types.ts`:

- Elements are JSON-serializable.
- Types include rectangle, diamond, ellipse, text, line, arrow, freedraw, image, frame, magicframe, iframe, and embeddable.
- Bound text is a separate text element with `containerId`. Arrow endpoints use `startBinding` and `endBinding`.

Rendering and state:

- RoughJS draws the hand-drawn look. Jotai holds editor state. History is a store snapshot stack, not a Git history.

Existing AI, `excalidraw-app/components/AI.tsx` and `packages/excalidraw/components/TTDDialog/TTDDialog.tsx`:

- Text to diagram posts `{ prompt }` to `${VITE_APP_AI_BACKEND}/v1/ai/text-to-diagram/generate` and expects `{ generatedResponse }` containing Mermaid. That string is parsed with `@excalidraw/mermaid-to-excalidraw` and inserted as elements.
- Diagram to code posts a JPEG of a frame plus extracted text to `/v1/ai/diagram-to-code/generate` and expects HTML.
- A maintainer comment on GitHub issue 7389 says the hosted AI backend is only meant for `*.excalidraw.com`. A self-hosted backend can return `{ generatedResponse }`.
- Mermaid to Excalidraw can run locally without that backend.
- These flows generate a new diagram or HTML. They do not show a structured diff, require accept/reject, or validate an operation schema before editing an existing scene.

Shortcuts verified in `packages/excalidraw/actions/shortcuts.ts` and `packages/excalidraw/shapes.tsx`:

- Tools: V/1 selection, R/2 rectangle, D/3 diamond, O/4 ellipse, A/5 arrow, L/6 line, P or X/7 draw, T/8 text, 9 image, E/0 eraser. Hand is H. Frame is F.
- Cmd/Ctrl+Z is the editor undo path (handled inside the component). Cmd/Ctrl+S saves, Cmd/Ctrl+O opens, Cmd/Ctrl+D duplicates, Delete removes the selection, Cmd/Ctrl+G groups.

## Feature inventory that matters for the MVP

Already in the editor we embed:

- Drawing tools, selection, multi-select, move, resize, rotate, duplicate, delete, grouping, text, stroke and fill, zoom, pan, undo/redo, copy/paste, library, image and frame tools, JSON and image export, browser persistence in the hosted app.

Already in Excalidraw, and not what CanvasAI needs to rebuild:

- Text-to-diagram via Mermaid, Mermaid paste, and wireframe-to-code. These call Excalidraw's own backend or convert Mermaid locally. They are whole-diagram generators.

Verified gaps relative to the requested product:

- No structured operation schema for incremental edits.
- No preview that leaves the current scene untouched until the user accepts.
- No validated reject path for a model that returns malformed JSON.
- No deterministic issues panel for unlabeled, unconnected, overlapping, or incomplete decision nodes.
- No separate log of accepted AI edits with a snapshot revert. Editor undo exists, but it is general canvas history, and the public API does not expose undo.

## Architecture choice

Embed `@excalidraw/excalidraw@0.18.1` and keep CanvasAI's own chrome around it.

- The editor remains the source of truth for drawing, selection, styling, zoom, pan, and keyboard undo.
- CanvasAI sends a compact scene summary (ids, types, geometry, labels, arrow endpoints). It does not send image bytes or the full app state.
- The model may only return the operation JSON. Zod validates it. A second pass checks that referenced ids exist. Deletes require `confirmDelete: true` and a visible Accept action.
- Accept calls `convertToExcalidrawElements(..., { regenerateIds: false })` and `updateScene` with `CaptureUpdateAction.IMMEDIATELY`.
- Shapes that are not in the changed connected component stay as the original element objects.
- Shapes an arrow binds to are recreated by the skeleton API so the binding stays valid. Their ids, labels, and geometry are carried through the logical scene. This is a limitation of the supported API, not a silent rewrite of unrelated shapes.
- `aiEnabled={false}` so this app does not call Excalidraw's hosted AI.

Local persistence is `localStorage` plus JSON import/export. There are no accounts, so PostgreSQL is not part of the MVP.

The AI provider is selected with `AI_PROVIDER`. OpenAI and Anthropic sit behind one interface. With no key, a deterministic local planner handles the example instructions and refuses everything else without touching the canvas.

## Risks

- The skeleton API is documented as beta.
- Recreating a connected component can change roughness seeds even when labels and positions are preserved.
- Public `history` cannot undo programmatically. CanvasAI records its own before-snapshot and also relies on `CaptureUpdateAction.IMMEDIATELY` so the editor undo stack can reverse the last accept if the user has not edited since.
- Excalidraw ids are nanoid strings. The operation schema allows that alphabet and rejects anything else, including code or shell text.
- Tailwind preflight is not loaded, because it resets button styles inside Excalidraw.

## Unknowns

- Live pointer-drag, resize, and rotate were not executed in the browser session described above.
- The exact current model names for OpenAI and Anthropic should be overridden with `OPENAI_MODEL` and `ANTHROPIC_MODEL` if the defaults are retired.
- Whether `convertToExcalidrawElements` preserves every binding field for freedraw, images, and frames was not exhaustively tested. Those element types are kept as original objects unless a validated operation addresses their id.
