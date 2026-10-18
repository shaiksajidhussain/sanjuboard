import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";

const envFile = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env"),
  resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
].find((path) => existsSync(path));
if (envFile) process.loadEnvFile(envFile);

const port = Number(process.env.PORT || 8787);
const app = createApp();

app.listen(port, () => {
  console.log(`CanvasAI API listening on http://127.0.0.1:${port}`);
});
