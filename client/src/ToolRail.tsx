export type BoardTool =
  | "selection"
  | "hand"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "eraser";

const GROUPS: Array<Array<{ id: BoardTool; label: string; icon: string }>> = [
  [
    { id: "selection", label: "Select", icon: "M5 4l6.2 15 1.6-5.4L18 12.2 5 4z" },
    { id: "hand", label: "Pan", icon: "M8 11V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V5.5a1.5 1.5 0 0 1 3 0V11M14 10.8V7a1.5 1.5 0 0 1 3 0v6.5c0 3.2-2 5.5-5 5.5h-1.2C8.2 19 6 17 6 14.2V12.5a1.5 1.5 0 0 1 3 0" },
  ],
  [
    { id: "rectangle", label: "Rectangle", icon: "M5 7h14v10H5z" },
    { id: "ellipse", label: "Ellipse", icon: "M12 7c3.6 0 6.5 2.2 6.5 5s-2.9 5-6.5 5-6.5-2.2-6.5-5S8.4 7 12 7z" },
    { id: "diamond", label: "Diamond", icon: "M12 4.5 19 12l-7 7.5L5 12 12 4.5z" },
  ],
  [
    { id: "arrow", label: "Arrow", icon: "M5 12h13M13 7l5 5-5 5" },
    { id: "line", label: "Line", icon: "M6 18 18 6" },
    { id: "freedraw", label: "Draw", icon: "M5 16c1.8-5 3.4-5 5.2 0S13.6 21 16 16c1-2 2-3 3-3" },
  ],
  [
    { id: "text", label: "Text", icon: "M7 6h10M12 6v12" },
    { id: "eraser", label: "Eraser", icon: "M14 5.5 19 10.5 11 18.5H7L4.5 16 14 5.5zM8 18.5h8" },
  ],
];

type ToolRailProps = {
  tool: BoardTool;
  zoom: number;
  onTool: (tool: BoardTool) => void;
  onZoom: (next: number) => void;
  onFit: () => void;
};

export function ToolRail(props: ToolRailProps) {
  const percent = Math.round(props.zoom * 100);
  return (
    <nav className="toolrail" aria-label="Canvas tools">
      {GROUPS.map((group, index) => (
        <div className="tool-group" key={group[0].id}>
          {index > 0 && <div className="tool-sep" role="separator" />}
          {group.map((item) => (
            <button
              key={item.id}
              type="button"
              className="tool"
              aria-label={item.label}
              aria-pressed={props.tool === item.id}
              title={item.label}
              onClick={() => props.onTool(item.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={item.icon} />
              </svg>
            </button>
          ))}
        </div>
      ))}
      <div className="tool-spacer" />
      <div className="tool-sep" role="separator" />
      <div className="tool-group" aria-label="Zoom">
        <button type="button" className="tool" aria-label="Zoom out" title="Zoom out" onClick={() => props.onZoom(props.zoom / 1.2)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
        </button>
        <button
          type="button"
          className="tool tool-zoom"
          aria-label={`Zoom ${percent} percent. Reset zoom`}
          title="Reset zoom"
          onClick={() => props.onZoom(1)}
        >
          {percent}%
        </button>
        <button type="button" className="tool" aria-label="Zoom in" title="Zoom in" onClick={() => props.onZoom(props.zoom * 1.2)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
        </button>
        <button type="button" className="tool" aria-label="Fit diagram" title="Fit to content" onClick={props.onFit}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" /></svg>
        </button>
      </div>
    </nav>
  );
}
