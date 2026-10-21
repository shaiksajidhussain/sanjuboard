import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assistantSystemPrompt,
  assistantUserPrompt,
  blueprintForPrompt,
  blueprintOperations,
  extractJson,
  interpretModelOutput,
  localAssistant,
  proposeRequestSchema,
  type AssistantInput,
  type Proposal,
  type SceneNode,
} from "@canvasai/shared";

export interface DiagramAssistant {
  name: string;
  propose(input: AssistantInput): Promise<unknown>;
}

type CreateAppOptions = {
  assistant?: DiagramAssistant;
  staticDir?: string;
  serveStatic?: boolean;
};

export function createApp(options: CreateAppOptions = {}) {
  const assistant = options.assistant ?? assistantFromEnv();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  const origin = process.env.CLIENT_ORIGIN;
  if (origin) {
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, provider: assistant.name });
  });

  app.post("/api/ai/propose", async (req, res) => {
    const parsed = proposeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid request. The canvas was not changed.",
      });
      return;
    }

    const direct = directBlueprint(parsed.data.instruction, parsed.data.scene);
    if (direct) {
      res.json({ provider: "blueprint", proposal: publicProposal(direct) });
      return;
    }

    let raw: unknown;
    try {
      raw = await assistant.propose({
        instruction: parsed.data.instruction,
        scene: parsed.data.scene,
        selectionIds: parsed.data.selectionIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant provider failed.";
      res.status(502).json({
        error: `The assistant is unavailable (${message}). The canvas was not changed.`,
      });
      return;
    }

    const validated = interpretModelOutput(parsed.data.scene, raw);
    if (!validated.ok) {
      const fallback = directBlueprint(parsed.data.instruction, parsed.data.scene, true);
      if (fallback) {
        res.json({ provider: "blueprint", proposal: publicProposal(fallback) });
        return;
      }
      res.status(422).json({ error: validated.error });
      return;
    }

    res.json({
      provider: assistant.name,
      proposal: publicProposal(validated.proposal),
    });
  });

  const serveStatic =
    options.serveStatic ??
    (Boolean(options.staticDir) || (process.env.NODE_ENV === "production" && !process.env.VERCEL));
  if (serveStatic) {
    const staticDir =
      options.staticDir ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
    app.use(express.static(staticDir));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(staticDir, "index.html"), (error) => {
        if (error) next();
      });
    });
  }

  return app;
}

function directBlueprint(
  instruction: string,
  scene: readonly SceneNode[],
  afterInvalidModel = false,
): Proposal | null {
  const kind = blueprintForPrompt(instruction);
  const asksForDiagram = /proposal|create|draw|diagram|generate|make|layout|pipeline|architecture|flow/i.test(instruction);
  const layoutBrief = /proposal for|grouped stages|legend explaining/i.test(instruction);
  if (!kind || !asksForDiagram) return null;
  if (!afterInvalidModel && scene.length > 0 && !layoutBrief) return null;
  const prepared = interpretModelOutput(scene, { operations: blueprintOperations(kind, "board") });
  return prepared.ok ? prepared.proposal : null;
}

function publicProposal(proposal: Proposal) {
  return {
    operations: proposal.operations,
    changes: proposal.changes,
    convertIds: proposal.convertIds,
  };
}

export function assistantFromEnv(): DiagramAssistant {
  const requested = process.env.AI_PROVIDER?.trim().toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const choice =
    requested ||
    (openaiKey ? "openai" : anthropicKey ? "anthropic" : "local");

  if (choice === "local") return localAssistant;
  if (choice === "openai") {
    if (!openaiKey) {
      return failingAssistant("openai", "OPENAI_API_KEY is not set.");
    }
    return openAiAssistant(openaiKey, process.env.OPENAI_MODEL?.trim() || "gpt-4.1-nano");
  }
  if (choice === "anthropic") {
    if (!anthropicKey) {
      return failingAssistant("anthropic", "ANTHROPIC_API_KEY is not set.");
    }
    return anthropicAssistant(
      anthropicKey,
      process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5",
    );
  }
  return failingAssistant(choice, `Unknown AI_PROVIDER "${choice}".`);
}

function failingAssistant(name: string, message: string): DiagramAssistant {
  return {
    name,
    async propose() {
      throw new Error(message);
    },
  };
}

function openAiAssistant(apiKey: string, model: string): DiagramAssistant {
  return {
    name: "openai",
    async propose(input) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_completion_tokens: 4000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: assistantSystemPrompt() },
            { role: "user", content: assistantUserPrompt(input) },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI returned ${response.status}`);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenAI returned no content");
      return extractJson(content);
    },
  };
}

function anthropicAssistant(apiKey: string, model: string): DiagramAssistant {
  return {
    name: "anthropic",
    async propose(input) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          temperature: 0.2,
          system: assistantSystemPrompt(),
          messages: [{ role: "user", content: assistantUserPrompt(input) }],
        }),
      });
      if (!response.ok) {
        throw new Error(`Anthropic returned ${response.status}`);
      }
      const body = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = body.content?.find((part) => part.type === "text")?.text;
      if (!text) throw new Error("Anthropic returned no text");
      return extractJson(text);
    },
  };
}

export type { SceneNode };
