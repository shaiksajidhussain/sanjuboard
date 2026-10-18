import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".vercel/output");
const staticDir = path.join(output, "static");
const bundleDir = path.join(output, "functions");

await rm(output, { recursive: true, force: true });
await mkdir(staticDir, { recursive: true });
await cp(path.join(root, "client/dist"), staticDir, { recursive: true });

const bundled = path.join(bundleDir, "server.cjs");
await mkdir(bundleDir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "server/src/vercel-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: bundled,
  logLevel: "silent",
});

const routes = ["/api/health", "/api/ai/propose"];
for (const route of routes) {
  const funcDir = path.join(bundleDir, `${route.slice(1)}.func`);
  await mkdir(funcDir, { recursive: true });
  await cp(bundled, path.join(funcDir, "server.cjs"));
  await writeFile(path.join(funcDir, "package.json"), '{"type":"commonjs"}\n');
  await writeFile(
    path.join(funcDir, "index.js"),
    `const { attach } = require("./server.cjs");\nmodule.exports = attach(${JSON.stringify(route)});\n`,
  );
  await writeFile(
    path.join(funcDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: "nodejs22.x",
        handler: "index.js",
        launcherType: "Nodejs",
        shouldAddHelpers: true,
        maxDuration: 30,
      },
      null,
      2,
    ),
  );
}

await rm(bundled, { force: true });
await writeFile(
  path.join(output, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: "filesystem" },
        { src: "/api/(.*)", status: 404 },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
