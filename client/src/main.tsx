import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import App from "./App";
import "./index.css";

class EditorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.stack || error.message };
  }

  render() {
    if (this.state.error) {
      return (
        <pre data-testid="crash" style={{ whiteSpace: "pre-wrap", padding: 16 }}>
          {this.state.error}
        </pre>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EditorBoundary>
      <App />
    </EditorBoundary>
  </StrictMode>,
);
