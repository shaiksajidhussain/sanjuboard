import type { DiagramRecord } from "./library";

type LibraryDrawerProps = {
  open: boolean;
  diagrams: DiagramRecord[];
  activeId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
};

export function LibraryDrawer(props: LibraryDrawerProps) {
  if (!props.open) return null;
  return (
    <div className="drawer-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="drawer"
        role="dialog"
        aria-label="Diagrams"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-head">
          <div>
            <div className="panel-kicker">Library</div>
            <h2 className="panel-title">Diagrams</h2>
            <p className="provider">Stored in this browser. Nothing is uploaded.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="drawer-actions">
          <button type="button" className="btn btn-primary" onClick={props.onCreate}>
            New diagram
          </button>
        </div>
        <ul className="issue-list drawer-list">
          {props.diagrams.map((diagram) => (
            <li key={diagram.id} className="history-card">
              <button type="button" className="diagram-open" onClick={() => props.onOpen(diagram.id)}>
                <span className="meta">{diagram.id === props.activeId ? "Open" : "Saved"}</span>
                {diagram.name}
                <span className="fine">{new Date(diagram.updatedAt).toLocaleString()}</span>
              </button>
              <label className="label" htmlFor={`name-${diagram.id}`}>
                Name
              </label>
              <input
                id={`name-${diagram.id}`}
                className="name-field"
                defaultValue={diagram.name}
                key={`${diagram.id}:${diagram.name}`}
                maxLength={80}
                onBlur={(event) => props.onRename(diagram.id, event.target.value)}
              />
              <div className="row">
                <button type="button" className="btn btn-ghost" onClick={() => props.onDuplicate(diagram.id)}>
                  Duplicate
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => props.onDelete(diagram.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
