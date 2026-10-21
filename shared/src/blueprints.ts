import type { DiagramOperation } from "./schema";

export type Blueprint = {
  id:
    | "request-path"
    | "decision"
    | "web-app"
    | "auth"
    | "ecommerce"
    | "healthcare"
    | "microservices"
    | "cicd"
    | "er"
    | "sequence"
    | "bpmn";
  name: string;
  detail: string;
};

export const BLUEPRINTS: readonly Blueprint[] = [
  { id: "web-app", name: "Web application", detail: "Browser, app, API, cache, and database." },
  { id: "auth", name: "Authentication", detail: "Sign-in, a check, a session, and a denial." },
  { id: "ecommerce", name: "E-commerce", detail: "Storefront, API, orders, payments, and data." },
  { id: "healthcare", name: "Healthcare platform", detail: "Patient, records, pharmacy, and database." },
  { id: "microservices", name: "Microservices", detail: "Gateway in front of three services." },
  { id: "cicd", name: "CI/CD pipeline", detail: "Commit, build, test, and deploy." },
  { id: "er", name: "ER sketch", detail: "Patient, visit, and doctor relationships." },
  { id: "sequence", name: "Request sequence", detail: "Client, API, and database in order." },
  { id: "bpmn", name: "Process flow", detail: "Start, task, decision, and two endings." },
  { id: "request-path", name: "Request path", detail: "Browser, API, and database." },
  { id: "decision", name: "Decision", detail: "A choice with two outcomes." },
];

const CLIENT = "#d0ebff";
const SERVICE = "#e5dbff";
const DATA = "#d3f9d8";
const CHOICE = "#fff3bf";
const EXTERNAL = "#ffe8cc";

type FlowItem = {
  id: string;
  type: "rectangle" | "ellipse" | "diamond";
  text: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
};

function flow(stamp: string, items: FlowItem[], links: Array<[number, number, string?, string?]>): DiagramOperation[] {
  const ids = items.map((item) => stampId(stamp, item.id));
  const operations: DiagramOperation[] = items.map((item, index) => ({
    op: "add_shape",
    id: ids[index] ?? stampId(stamp, item.id),
    type: item.type,
    x: item.x,
    y: item.y,
    width: item.width ?? (item.type === "diamond" ? 180 : item.type === "ellipse" ? 150 : 170),
    height: item.height ?? (item.type === "diamond" ? 130 : 80),
    text: item.text,
    backgroundColor: item.backgroundColor ?? (item.type === "diamond" ? CHOICE : item.type === "ellipse" ? DATA : CLIENT),
    strokeColor: "#1e1e1e",
  }));
  links.forEach(([from, to, label, stroke], index) => {
    const fromId = ids[from];
    const toId = ids[to];
    if (!fromId || !toId) return;
    operations.push({
      op: "add_arrow",
      id: stampId(stamp, `link_${index}`),
      fromId,
      toId,
      label,
      strokeColor: stroke ?? "#1e1e1e",
    });
  });
  return operations;
}

function stampId(stamp: string, base: string): string {
  const cleaned = `${stamp}_${base}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `n${cleaned}`;
}

export function blueprintForPrompt(instruction: string): Blueprint["id"] | null {
  const lower = instruction.toLowerCase();
  if (/entity relationship|\ber diagram\b|patients, visits/.test(lower)) return "er";
  if (/hospital|healthcare/.test(lower)) return "healthcare";
  if (/e-?commerce|storefront/.test(lower)) return "ecommerce";
  if (/microservice/.test(lower)) return "microservices";
  if (/ci\/cd|pipeline/.test(lower)) return "cicd";
  if (/sequence/.test(lower)) return "sequence";
  if (/bpmn|process flow/.test(lower)) return "bpmn";
  if (/decision flow|flow\s*chart|flowchart/.test(lower)) return "decision";
  if (/authentication|authorization|registration/.test(lower)) return "auth";
  if (/web application|architecture/.test(lower)) return "web-app";
  return null;
}

export function blueprintOperations(id: Blueprint["id"], stamp: string): DiagramOperation[] {
  if (id === "web-app") {
    return flow(stamp, [
      { id: "browser", type: "rectangle", text: "Browser", x: 40, y: 80, backgroundColor: CLIENT },
      { id: "app", type: "rectangle", text: "Web app", x: 280, y: 80, backgroundColor: CLIENT },
      { id: "gateway", type: "rectangle", text: "API gateway", x: 520, y: 80, backgroundColor: SERVICE },
      { id: "auth", type: "rectangle", text: "Auth", x: 800, y: 20, backgroundColor: SERVICE },
      { id: "catalog", type: "rectangle", text: "Catalog", x: 800, y: 150, backgroundColor: SERVICE },
      { id: "orders", type: "rectangle", text: "Orders", x: 800, y: 280, backgroundColor: SERVICE },
      { id: "cache", type: "ellipse", text: "Redis", x: 1080, y: 40, backgroundColor: DATA },
      { id: "db", type: "ellipse", text: "PostgreSQL", x: 1080, y: 220, backgroundColor: DATA },
    ], [[0, 1], [1, 2], [2, 3], [2, 4], [2, 5], [3, 6], [4, 7], [5, 7]]);
  }
  if (id === "auth") {
    return flow(stamp, [
      { id: "user", type: "ellipse", text: "User", x: 40, y: 140, backgroundColor: CLIENT },
      { id: "login", type: "rectangle", text: "Sign in", x: 260, y: 140, backgroundColor: CLIENT },
      { id: "check", type: "diamond", text: "Valid?", x: 500, y: 110, backgroundColor: CHOICE },
      { id: "token", type: "rectangle", text: "Issue token", x: 780, y: 40, backgroundColor: SERVICE },
      { id: "session", type: "ellipse", text: "Session", x: 1040, y: 40, backgroundColor: DATA },
      { id: "denied", type: "rectangle", text: "Show error", x: 780, y: 240, backgroundColor: EXTERNAL },
    ], [[0, 1], [1, 2], [2, 3, "Yes"], [3, 4], [2, 5, "No"]]);
  }
  if (id === "ecommerce") {
    return flow(stamp, [
      { id: "store", type: "rectangle", text: "Storefront", x: 40, y: 140, backgroundColor: CLIENT },
      { id: "api", type: "rectangle", text: "Shop API", x: 280, y: 140, backgroundColor: SERVICE },
      { id: "catalog", type: "rectangle", text: "Catalog", x: 540, y: 20, backgroundColor: SERVICE },
      { id: "cart", type: "rectangle", text: "Cart", x: 540, y: 150, backgroundColor: SERVICE },
      { id: "pay", type: "rectangle", text: "Payments", x: 540, y: 280, backgroundColor: EXTERNAL },
      { id: "cache", type: "ellipse", text: "Redis", x: 820, y: 40, backgroundColor: DATA },
      { id: "db", type: "ellipse", text: "Orders DB", x: 820, y: 220, backgroundColor: DATA },
    ], [[0, 1], [1, 2], [1, 3], [1, 4], [2, 5], [3, 6], [4, 6]]);
  }
  if (id === "healthcare") {
    return flow(stamp, [
      { id: "patient", type: "rectangle", text: "Patient", x: 40, y: 140, backgroundColor: CLIENT },
      { id: "portal", type: "rectangle", text: "Clinic portal", x: 280, y: 140, backgroundColor: CLIENT },
      { id: "api", type: "rectangle", text: "Clinic API", x: 540, y: 140, backgroundColor: SERVICE },
      { id: "records", type: "rectangle", text: "Records", x: 820, y: 20, backgroundColor: SERVICE },
      { id: "pharmacy", type: "rectangle", text: "Pharmacy", x: 820, y: 150, backgroundColor: SERVICE },
      { id: "lab", type: "rectangle", text: "Lab", x: 820, y: 280, backgroundColor: EXTERNAL },
      { id: "db", type: "ellipse", text: "Clinical DB", x: 1100, y: 140, backgroundColor: DATA },
    ], [[0, 1], [1, 2], [2, 3], [2, 4], [2, 5], [3, 6], [4, 6], [5, 6]]);
  }
  if (id === "microservices") {
    return flow(stamp, [
      { id: "client", type: "rectangle", text: "Client", x: 40, y: 150, backgroundColor: CLIENT },
      { id: "gateway", type: "rectangle", text: "Gateway", x: 280, y: 150, backgroundColor: SERVICE },
      { id: "users", type: "rectangle", text: "Users", x: 540, y: 20, backgroundColor: SERVICE },
      { id: "orders", type: "rectangle", text: "Orders", x: 540, y: 150, backgroundColor: SERVICE },
      { id: "inventory", type: "rectangle", text: "Inventory", x: 540, y: 280, backgroundColor: SERVICE },
      { id: "queue", type: "ellipse", text: "Queue", x: 820, y: 40, backgroundColor: EXTERNAL },
      { id: "db", type: "ellipse", text: "Database", x: 820, y: 220, backgroundColor: DATA },
    ], [[0, 1], [1, 2], [1, 3], [1, 4], [3, 5], [2, 6], [4, 6]]);
  }
  if (id === "cicd") {
    return flow(
      stamp,
      [
        { id: "title", type: "rectangle", text: "CI/CD pipeline diagram", x: 48, y: 24, width: 300, height: 72, backgroundColor: "#f8f9fa" },
        {
          id: "legend",
          type: "rectangle",
          text: "Legend\nRectangle: stage\nDiamond: decision\nEllipse: data\nRed arrow: failure",
          x: 400,
          y: 24,
          width: 280,
          height: 150,
          backgroundColor: "#fff",
        },
        { id: "source", type: "rectangle", text: "Source Control\nGitHub", x: 48, y: 220, width: 210, height: 88, backgroundColor: CLIENT },
        { id: "ci", type: "rectangle", text: "CI\nJenkins", x: 314, y: 220, width: 210, height: 88, backgroundColor: SERVICE },
        { id: "testing", type: "rectangle", text: "Testing\nTests and quality", x: 580, y: 220, width: 210, height: 88, backgroundColor: CHOICE },
        { id: "build", type: "rectangle", text: "Build\nDocker image", x: 846, y: 220, width: 210, height: 88, backgroundColor: "#c5f6fa" },
        { id: "staging", type: "rectangle", text: "Staging", x: 1112, y: 220, width: 210, height: 88, backgroundColor: EXTERNAL },
        { id: "approval", type: "diamond", text: "Approved?", x: 48, y: 390, width: 180, height: 140, backgroundColor: CHOICE },
        { id: "production", type: "rectangle", text: "Production\nNginx and API", x: 314, y: 420, width: 210, height: 88, backgroundColor: SERVICE },
        { id: "database", type: "ellipse", text: "PostgreSQL", x: 846, y: 420, width: 180, height: 88, backgroundColor: DATA },
        { id: "monitoring", type: "rectangle", text: "Monitoring\nAlerts", x: 1112, y: 420, width: 210, height: 88, backgroundColor: "#ffc9c9" },
        { id: "notify", type: "rectangle", text: "Stop and notify", x: 580, y: 420, width: 210, height: 88, backgroundColor: "#ffc9c9" },
      ],
      [
        [2, 3, "Push"],
        [3, 4, "Run"],
        [4, 5, "Pass"],
        [5, 6, "Image"],
        [6, 7, "Deploy"],
        [7, 8, "Yes"],
        [8, 9],
        [8, 10, "Health"],
        [4, 11, "Fail", "#e03131"],
        [7, 11, "No", "#e03131"],
      ],
    );
  }
  if (id === "er") {
    return flow(stamp, [
      { id: "patient", type: "rectangle", text: "Patient", x: 40, y: 80 },
      { id: "visit", type: "rectangle", text: "Visit", x: 320, y: 80 },
      { id: "doctor", type: "rectangle", text: "Doctor", x: 600, y: 80 },
    ], [[0, 1, "has"], [2, 1, "sees"]]);
  }
  if (id === "sequence") {
    return flow(stamp, [
      { id: "client", type: "rectangle", text: "Client", x: 80, y: 40 },
      { id: "api", type: "rectangle", text: "API", x: 80, y: 180 },
      { id: "db", type: "ellipse", text: "Database", x: 80, y: 320 },
    ], [[0, 1, "request"], [1, 2, "query"], [2, 1, "rows"]]);
  }
  if (id === "bpmn") {
    return flow(stamp, [
      { id: "start", type: "ellipse", text: "Start", x: 40, y: 150, backgroundColor: DATA },
      { id: "intake", type: "rectangle", text: "Intake", x: 250, y: 150, backgroundColor: CLIENT },
      { id: "review", type: "rectangle", text: "Review", x: 480, y: 150, backgroundColor: SERVICE },
      { id: "gate", type: "diamond", text: "Approved?", x: 720, y: 120, backgroundColor: CHOICE },
      { id: "record", type: "rectangle", text: "Record", x: 980, y: 40, backgroundColor: SERVICE },
      { id: "notify", type: "rectangle", text: "Notify", x: 1220, y: 40, backgroundColor: EXTERNAL },
      { id: "done", type: "ellipse", text: "Done", x: 1460, y: 40, backgroundColor: DATA },
      { id: "rework", type: "rectangle", text: "Rework", x: 980, y: 260, backgroundColor: EXTERNAL },
    ], [[0, 1], [1, 2], [2, 3], [3, 4, "Yes"], [4, 5], [5, 6], [3, 7, "No"], [7, 2]]);
  }
  if (id === "decision") {
    const choice = stampId(stamp, "choice");
    const yes = stampId(stamp, "yes");
    const no = stampId(stamp, "no");
    return [
      {
        op: "add_shape",
        id: choice,
        type: "diamond",
        x: 220,
        y: 40,
        width: 180,
        height: 140,
        text: "Valid?",
        backgroundColor: "#fff3bf",
        strokeColor: "#1e1e1e",
      },
      {
        op: "add_shape",
        id: yes,
        type: "rectangle",
        x: 40,
        y: 240,
        text: "Continue",
        backgroundColor: "#d3f9d8",
        strokeColor: "#1e1e1e",
      },
      {
        op: "add_shape",
        id: no,
        type: "rectangle",
        x: 400,
        y: 240,
        text: "Show error",
        backgroundColor: "#ffc9c9",
        strokeColor: "#1e1e1e",
      },
      { op: "add_arrow", id: stampId(stamp, "yes_arrow"), fromId: choice, toId: yes, label: "Yes" },
      { op: "add_arrow", id: stampId(stamp, "no_arrow"), fromId: choice, toId: no, label: "No" },
    ];
  }

  const client = stampId(stamp, "client");
  const api = stampId(stamp, "api");
  const database = stampId(stamp, "database");
  return [
    {
      op: "add_shape",
      id: client,
      type: "rectangle",
      x: 40,
      y: 80,
      text: "Browser",
      backgroundColor: "#d0ebff",
      strokeColor: "#1e1e1e",
    },
    {
      op: "add_shape",
      id: api,
      type: "rectangle",
      x: 280,
      y: 80,
      text: "API",
      backgroundColor: "#d0ebff",
      strokeColor: "#1e1e1e",
    },
    {
      op: "add_shape",
      id: database,
      type: "ellipse",
      x: 520,
      y: 72,
      text: "Database",
      backgroundColor: "#d3f9d8",
      strokeColor: "#1e1e1e",
    },
    { op: "add_arrow", id: stampId(stamp, "to_api"), fromId: client, toId: api },
    { op: "add_arrow", id: stampId(stamp, "to_db"), fromId: api, toId: database },
  ];
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function openApiOperations(
  source: string,
): { ok: true; title: string; operations: DiagramOperation[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, error: "OpenAPI import expects a JSON document. Nothing was added." };
  }
  if (!parsed || typeof parsed !== "object" || !("paths" in parsed)) {
    return { ok: false, error: "That JSON has no OpenAPI paths object. Nothing was added." };
  }
  const document = parsed as { paths?: unknown; info?: { title?: unknown } };
  const paths = document.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    return { ok: false, error: "That JSON has no OpenAPI paths object. Nothing was added." };
  }
  const title = typeof document.info?.title === "string" ? document.info.title.slice(0, 80) : "API";
  const service = "openapi_service";
  const operations: DiagramOperation[] = [
    {
      op: "add_shape",
      id: service,
      type: "rectangle",
      x: 40,
      y: 40,
      width: 200,
      height: 88,
      text: title,
      backgroundColor: "#d0ebff",
      strokeColor: "#1e1e1e",
    },
  ];
  let row = 0;
  let skipped = 0;
  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const method of METHODS) {
      if (!(method in methods)) continue;
      if (operations.length + 2 > 39) {
        skipped += 1;
        continue;
      }
      const id = endpointId(method, path, row);
      operations.push({
        op: "add_shape",
        id,
        type: "rectangle",
        x: 320,
        y: 40 + row * 110,
        width: 280,
        height: 72,
        text: `${method.toUpperCase()} ${path}`.slice(0, 180),
        backgroundColor: "#fff3bf",
        strokeColor: "#1e1e1e",
      });
      operations.push({
        op: "add_arrow",
        id: `openapi_arrow_${row}`.slice(0, 80),
        fromId: service,
        toId: id,
      });
      row += 1;
    }
  }
  if (row === 0) {
    return { ok: false, error: "No HTTP operations were found in that OpenAPI document." };
  }
  if (skipped > 0) {
    operations.push({
      op: "comment",
      kind: "suggestion",
      text: `${skipped} additional operations were left out so the proposal stays within the edit limit.`,
    });
  }
  return { ok: true, title, operations };
}

function endpointId(method: string, path: string, row: number): string {
  const slug = `${method}_${path}`
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, 60);
  const id = `${slug || "endpoint"}_${row}`.slice(0, 80);
  return /^[A-Za-z0-9]/.test(id) ? id : `ep_${id}`;
}
