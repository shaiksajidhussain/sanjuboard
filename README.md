# Sanju Board

An AI-assisted diagram editor. The canvas is the official Excalidraw React component (`@excalidraw/excalidraw` 0.18.1, MIT). CanvasAI adds a preview-before-apply assistant, validated diagram operations, deterministic issue checks, and a short history of accepted AI edits.

CanvasAI is an independent project. It does not use Excalidraw branding and it does not call Excalidraw's hosted AI backend.

The investigation notes are in [docs/INVESTIGATION.md](docs/INVESTIGATION.md).

## Run it locally

Requirements: Node.js 22 or newer.

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173. The API listens on http://127.0.0.1:8787. The Vite dev server proxies `/api` to it.

With no API key, the assistant uses a local planner. It can run the example instructions in the side panel. Set a key in `.env` for open-ended instructions.

```bash
# .env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

or

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5
```

`AI_PROVIDER` may be `local`, `openai`, or `anthropic`. If it is empty, CanvasAI uses OpenAI when `OPENAI_API_KEY` is set, otherwise Anthropic, otherwise the local planner.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API and Vite together |
| `npm test` | Unit tests for operations, the local planner, and the API |
| `npm run typecheck` | Typecheck the client and the server |
| `npm run build` | Production client bundle in `client/dist` |
| `npm start` | Serve the API and, when `NODE_ENV=production`, the built client |

Production:

```bash
npm run build
npm start
```

Then open http://127.0.0.1:8787.

Docker:

```bash
docker compose up --build
```

The container listens on port 8787. Pass provider keys with the environment variables above.

## Deploy on Vercel

One Vercel project serves the board and the assistant. Import `shaiksajidhussain/sanjuboard` with root directory `./` and preset Other. Leave the build fields empty so `vercel.json` is used: it builds the client and routes `/api` to the assistant.

Add these environment variables in the Vercel project. Do not commit the key.

```
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-nano
```

After deploy, open the Vercel URL. The page and `/api/health` come from the same site.

## How an edit works

1. The editor summarizes the canvas to ids, types, geometry, labels, and arrow endpoints. Image bytes and app state are not sent.
2. `POST /api/ai/propose` asks the configured provider for JSON operations.
3. Zod validates the payload. A second pass checks that every referenced id exists and that deletes set `confirmDelete: true`.
4. The side panel lists additions, updates, and deletions. The canvas is not modified.
5. Accept rebuilds only the changed connected component through `convertToExcalidrawElements` and applies it with `updateScene` and `CaptureUpdateAction.IMMEDIATELY`.
6. Reject discards the proposal.
7. The editor's own undo reverses the accept. The History tab can also restore the snapshot taken before that accept.

Allowed operations: `add_shape`, `update_shape`, `add_arrow`, `delete_shape`, `move_shape`, `group`, and `comment` (explanation, Mermaid, or suggestion). Comments do not change the canvas.

## Layout

- `shared/` — schemas, validation, analysis, and the local planner
- `server/` — Express API and provider adapters
- `client/` — Vite, React, and the Excalidraw embed
- `docs/INVESTIGATION.md` — what was verified about Excalidraw

Keyboard: Alt+A toggles the assistant. Escape closes it when focus is not in a text field. Drawing shortcuts are Excalidraw's (for example R or 2 for rectangle, Cmd/Ctrl+Z for undo).

Diagrams are stored in `localStorage` under `canvasai.project.v1`. Import and Export JSON use an Excalidraw-compatible file. Export PNG uses Excalidraw's `exportToBlob`.

## Tests executed on 18 October 2026

`npm test` — 15 tests passed (12 shared, 3 server).

`npm run typecheck` — passed.

`npm run build` — passed. The production bundle is large because Excalidraw ships its own editor and Mermaid-related chunks. Vite prints a chunk-size warning. That does not fail the build.

Production process on port 8799:

- `GET /api/health` returned `{"ok":true,"provider":"local"}`
- `GET /` returned the built `index.html` (HTTP 200)
- `POST /api/ai/propose` with "Add a rectangle labeled Cache." returned a validated `add_shape` operation

Browser, http://localhost:5173, local planner:

- The editor loaded with Excalidraw's toolbar, zoom, undo, and redo.
- "Create a login flow with validation and error handling." produced a preview while Undo stayed disabled.
- Reject removed the preview and left Undo disabled.
- Accept drew the flow (User, Login form, decision, Open session, Show error, yes/no arrows). The save state became Saved. History showed the instruction and Revert.
- Undo cleared that edit and enabled Redo. Redo restored it.
- After a refresh, the saved labels were still in `localStorage` and the User → Login form connection was on the canvas.
- The rectangle tool could be selected. Selecting a shape opened stroke, fill, opacity, layer, duplicate, and delete controls. Delete removed the selected shape.
- The Issues tab listed deterministic findings for an unlabeled shape, and showed "No issues found" after that shape was deleted. The copy on that tab says the checks are deterministic.

Invalid model output and provider failures were executed in Vitest, not by calling a live model. A fake provider that returned `{ op: "shell" }` got HTTP 422. A provider that threw got HTTP 502. In both cases the response says the canvas was not changed. `requestProposal` turns network failures into an error result instead of throwing.

A full pointer-drag to draw a new rectangle was not completed in the embedded browser. The rectangle tool and the property panel were exercised. Drawing with the mouse in a normal browser uses Excalidraw's own handlers.

## Known limitations

- The local planner only covers the example instructions and a few direct commands (add a labeled shape, connect A to B, delete a named shape, group). Anything else returns a suggestion and does not edit the canvas.
- Open-ended editing needs an API key. The model is still restricted to the operation schema.
- Accepting an edit rebuilds the changed shape and the arrows attached to it, so roughness can shift slightly on that connected component. Shapes that are not connected to the change stay as the original elements.
- Excalidraw's public `history` API does not expose undo. CanvasAI uses `CaptureUpdateAction.IMMEDIATELY` so the on-canvas Undo button can reverse an accept, and it keeps its own before-snapshot in the History tab.
- There are no accounts and no server-side diagram database. Persistence is this browser's `localStorage`, plus import and export.
- Grouping uses Excalidraw `groupIds`. Frames, images, and freedraw strokes are preserved as original elements and are not generated by the assistant.
- REA's Cursor MCP server was not registered in this session. See the investigation note. Architecture came from the public Excalidraw 0.18.1 source and the live site.
