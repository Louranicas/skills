/**
 * Pi extension: rules-first Jev gate on unvouched bash/write/edit, plus
 * two-pass skill suggestion on before_agent_start.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { gateToolCall } from "./gate.ts";
import { apiKeyFromEnv } from "./client.ts";
import { suggestionBlock, suggestLive } from "./suggest.ts";
import { routeBlock, routeLive } from "./router.ts";
import type { SkillRecord, ToolCallInput, ToolName } from "./types.ts";

const GATED: ReadonlySet<string> = new Set(["bash", "write", "edit"]);

function asToolCall(event: {
  toolName: string;
  input: Record<string, unknown>;
}, cwd: string, userRequest?: string): ToolCallInput | null {
  if (!GATED.has(event.toolName)) return null;
  const tool = event.toolName as ToolName;
  if (tool === "bash") {
    return {
      tool,
      cwd,
      command: String(event.input.command ?? ""),
      userRequest,
    };
  }
  return {
    tool,
    cwd,
    path: String(event.input.path ?? ""),
    userRequest,
  };
}

function lastUserText(ctx: {
  sessionManager: { getEntries: () => Array<unknown> };
}): string | undefined {
  try {
    const entries = ctx.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as {
        type?: string;
        message?: { role?: string; content?: unknown };
      };
      const msg = entry.message;
      if (!msg || msg.role !== "user") continue;
      const content = msg.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const text = content
          .map((part) =>
            part && typeof part === "object" && "text" in part
              ? String((part as { text: unknown }).text)
              : "",
          )
          .join("\n")
          .trim();
        if (text) return text;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export default function jevPiSpecialist(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    const input = asToolCall(
      event as { toolName: string; input: Record<string, unknown> },
      ctx.cwd,
      lastUserText(ctx),
    );
    if (!input) return;
    const verdict = await gateToolCall(input);
    const line = `[jev-gate] ${verdict.action} via ${verdict.source}: ${verdict.reason}`;
    try {
      pi.appendEntry("jev-gate", {
        action: verdict.action,
        source: verdict.source,
        reason: verdict.reason,
        raw: verdict.raw,
      });
    } catch {
      // Session persistence is optional; blocking is not.
    }
    if (verdict.action === "deny") {
      return { block: true, reason: line };
    }
    if (verdict.action === "ask") {
      if (!ctx.hasUI) {
        return { block: true, reason: `${line} (no UI; fail closed)` };
      }
      const ok = await ctx.ui.confirm("Jev gate", `${line}\nAllow this call?`);
      if (!ok) return { block: true, reason: `${line} (user declined)` };
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const key = apiKeyFromEnv();
    if (!key) return;
    let extra = "";
    try {
      const route = await routeLive({ request: event.prompt, apiKey: key });
      extra += routeBlock(route);
      try {
        pi.appendEntry("jev-route", { lane: route.lane, reason: route.reason, raw: route.raw });
      } catch {
        /* optional */
      }
    } catch {
      /* routing is advisory */
    }
    const skills = (event.systemPromptOptions?.skills ?? []) as Array<{
      name?: string;
      description?: string;
      content?: string;
    }>;
    if (skills.length >= 2) {
      const roster: SkillRecord[] = skills.map((s) => ({
        name: String(s.name ?? ""),
        description: String(s.description ?? ""),
        description_full: String(s.description ?? ""),
        body: String(s.content ?? "").slice(0, 1600),
      }));
      try {
        const result = await suggestLive({
          request: event.prompt,
          roster,
          apiKey: key,
        });
        extra += suggestionBlock(result.names);
      } catch {
        /* suggestion is ignorable */
      }
    }
    if (!extra) return;
    return { systemPrompt: event.systemPrompt + extra };
  });

  pi.registerCommand("jev-gate", {
    description: "Show Jev tool-gate and router status",
    handler: async (_args, ctx) => {
      const key = apiKeyFromEnv();
      ctx.ui.notify(
        key
          ? "Jev specialist: key present. Unvouched bash/write/edit are gated; each turn is routed (simple|jev_specialist|coding|ask)."
          : "Jev specialist: no TYPESAFE_API_KEY; unvouched calls fail closed; router stays off.",
        key ? "info" : "warning",
      );
    },
  });
}
