import { useState } from "react";
import {
  mutatingChanges,
  type Change,
  type DiagramIssue,
  type Proposal,
} from "@canvasai/shared";

const EXAMPLES = [
  "Add a Redis cache between the API and PostgreSQL.",
  "Create a login flow with validation and error handling.",
  "Explain this architecture in simple English.",
  "Add a payment gateway to this system.",
  "Find missing connections in this diagram.",
  "Make this diagram easier to understand.",
  "Add labels to the unlabeled components.",
  "Generate a Mermaid diagram from this drawing.",
];

type Tab = "assistant" | "issues" | "history";

export type HistoryView = {
  id: string;
  instruction: string;
  at: number;
  canRevert: boolean;
};

type SidePanelProps = {
  open: boolean;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onClose: () => void;
  provider: string;
  instruction: string;
  onInstruction: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
  proposal: Proposal | null;
  onAccept: () => void;
  onReject: () => void;
  issues: DiagramIssue[];
  onFocus: (id: string) => void;
  history: HistoryView[];
  onRevert: (id: string) => void;
  onRestoreAnyway: (id: string) => void;
};

export function SidePanel(props: SidePanelProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const mutations = props.proposal ? mutatingChanges(props.proposal.changes) : [];
  const notes = props.proposal?.changes.filter((change) => change.kind === "note") ?? [];
  const deletes = mutations.filter((change) => change.kind === "delete");

  if (!props.open) return null;

  return (
    <aside className="panel" aria-label="Sanju assistant">
      <div className="panel-head">
        <div>
          <div className="panel-kicker">Sanju</div>
          <h2 className="panel-title">Assistant</h2>
          <p className="provider">
            {props.provider === "local" ? "Local planner" : props.provider}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ["assistant", "Edit"],
            ["issues", `Issues${props.issues.length ? ` ${props.issues.length}` : ""}`],
            ["history", "History"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={props.tab === id}
            className="tab"
            onClick={() => props.onTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {props.tab === "assistant" && (
          <div className="stack">
            <label className="label" htmlFor="assistant-input">
              Instruction
            </label>
            <textarea
              id="assistant-input"
              data-testid="assistant-input"
              className="field"
              placeholder="Describe the change. Nothing is drawn until you accept."
              value={props.instruction}
              onChange={(event) => props.onInstruction(event.target.value)}
              disabled={props.busy}
            />
            <button
              type="button"
              data-testid="assistant-submit"
              className="btn btn-primary"
              onClick={props.onSubmit}
              disabled={props.busy || props.instruction.trim().length === 0 || Boolean(props.proposal)}
            >
              {props.busy ? "Reading the diagram…" : "Propose changes"}
            </button>
            <div className="examples">
              <div className="examples-label">Try</div>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className="chip"
                  onClick={() => props.onInstruction(example)}
                >
                  {example}
                </button>
              ))}
            </div>
            {props.error && (
              <p role="alert" data-testid="assistant-error" className="alert">
                {props.error}
              </p>
            )}
            {!props.proposal && !props.error && !props.busy && (
              <p className="quiet">
                A proposal stays in this panel until you accept it.
              </p>
            )}
            {props.proposal && (
              <div data-testid="proposal" className="preview">
                <h3>Preview</h3>
                <p className="quiet">The diagram has not been modified.</p>
                <ul className="change-list">
                  {mutations.map((change, index) => (
                    <li key={`${change.kind}-${index}`} className={`change ${tone(change)}`}>
                      {change.summary}
                    </li>
                  ))}
                  {mutations.length === 0 && <li className="quiet">No canvas edits in this proposal.</li>}
                </ul>
                {notes.map((change, index) =>
                  change.kind === "note" ? (
                    <pre key={index} className="note">
                      {change.text}
                    </pre>
                  ) : null,
                )}
                <div className="row">
                  {mutations.length > 0 && (
                    <button type="button" data-testid="accept" className="btn btn-accept" onClick={props.onAccept}>
                      {deletes.length > 0 ? "Accept and delete" : "Accept"}
                    </button>
                  )}
                  <button type="button" data-testid="reject" className="btn btn-ghost" onClick={props.onReject}>
                    {mutations.length > 0 ? "Reject" : "Close"}
                  </button>
                </div>
              </div>
            )}
            <p className="fine">
              Drawing uses Excalidraw. Sanju is a separate project and sends the diagram only when you ask the assistant.
            </p>
          </div>
        )}
        {props.tab === "issues" && (
          <div data-testid="issues-list" className="stack">
            <p className="fine">
              These checks are deterministic. They are separate from AI suggestions.
            </p>
            {props.issues.length === 0 ? (
              <p className="quiet">No issues found in the current diagram.</p>
            ) : (
              <ul className="issue-list">
                {props.issues.map((issue) => (
                  <li key={issue.id}>
                    <button
                      type="button"
                      className="issue"
                      onClick={() => props.onFocus(issue.elementIds[0] ?? "")}
                    >
                      <span className="meta">
                        {issue.severity} · {issue.source}
                      </span>
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {props.tab === "history" && (
          <div data-testid="history-list">
            {props.history.length === 0 ? (
              <p className="quiet">Accepted assistant edits will appear here.</p>
            ) : (
              <ul className="history-list">
                {props.history.map((entry, index) => (
                  <li key={entry.id} className="history-card">
                    <p>{entry.instruction}</p>
                    <p className="fine">{new Date(entry.at).toLocaleString()}</p>
                    {index === 0 && entry.canRevert && (
                      <button
                        type="button"
                        data-testid="revert"
                        className="btn btn-ghost"
                        onClick={() => props.onRevert(entry.id)}
                      >
                        Revert this edit
                      </button>
                    )}
                    {index === 0 && !entry.canRevert && (
                      <div>
                        <p className="fine">The canvas has changed since this edit.</p>
                        {confirmId === entry.id ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              props.onRestoreAnyway(entry.id);
                              setConfirmId(null);
                            }}
                          >
                            Restore snapshot anyway
                          </button>
                        ) : (
                          <button type="button" className="btn btn-ghost" onClick={() => setConfirmId(entry.id)}>
                            Restore snapshot…
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function tone(change: Change): string {
  if (change.kind === "delete") return "change-delete";
  if (change.kind === "add") return "change-add";
  return "change-update";
}
