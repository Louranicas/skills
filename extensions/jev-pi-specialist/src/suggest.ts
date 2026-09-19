/**
 * Two-pass skill suggestion (cookbook shape).
 *
 * Pass 1: Choice over roster index lines + need-skill Nouls (fan-out).
 * Pass 2: Choice over top-3 with full description + body excerpt + per-candidate
 * fits Nouls. Either pass may return nothing. Suggestion is ignorable.
 *
 * Fourth gate `design_or_implement_typesafe` is averaged with the three
 * cookbook Nouls and is NOT inverted.
 */

import type { SkillRecord, SuggestResult } from "./types.ts";
import { DEFAULT_CONFIG } from "./questions.ts";

export const SHORTLIST = 3;
export const EXCERPT_CHARS = 700;
export const GATE_THRESHOLD = 0.3;
export const FITS_THRESHOLD = 0.3;

export const GATE_QUESTIONS: Record<string, string> = {
  acts_on_user_system:
    "Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?",
  would_follow_documented_procedure:
    "Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?",
  prose_suffices:
    "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?",
  design_or_implement_typesafe:
    "Is the user asking to design or implement a TypeSafe/Jev (System One) workflow in code, rather than only to write ordinary typed programs or to hear an explanation?",
};

export const INVERTED = new Set(["prose_suffices"]);

const CHOICE_INSTRUCTIONS =
  "Which of these skills, if any, is the right one to load to help with the user's latest request?";

const RERANK_INSTRUCTIONS =
  "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name. Use none if none fit.";

export function indexLine(skill: SkillRecord, width = 60): string {
  const text = skill.description.replace(/\s+/g, " ").trim();
  return text.length <= width ? text : text.slice(0, width);
}

export function gateMean(values: Record<string, number>): number {
  const oriented = Object.entries(values).map(([k, v]) =>
    INVERTED.has(k) ? 1 - v : v,
  );
  if (oriented.length === 0) return 0;
  return oriented.reduce((a, b) => a + b, 0) / oriented.length;
}

export function stage1Questions(
  roster: SkillRecord[],
): Record<string, unknown> {
  const criteria: Record<string, string> = {
    none: "No skill in this roster is the right one to load.",
  };
  for (const skill of roster) {
    criteria[skill.name] = indexLine(skill);
  }
  const questions: Record<string, unknown> = {
    which: {
      type: "choice",
      instructions: CHOICE_INSTRUCTIONS,
      criteria,
    },
  };
  for (const [key, text] of Object.entries(GATE_QUESTIONS)) {
    questions[`gate::${key}`] = { type: "noul", instructions: text };
  }
  return questions;
}

export function stage2Questions(
  rosterByName: Record<string, SkillRecord>,
  names: string[],
  excerpt = EXCERPT_CHARS,
): Record<string, unknown> {
  const criteria: Record<string, string> = {
    none: "None of these skills does the specific thing the request asks for.",
  };
  for (const name of names) {
    const skill = rosterByName[name];
    if (!skill) continue;
    criteria[name] =
      `${skill.description_full} — ${skill.body.slice(0, excerpt)}`;
  }
  const questions: Record<string, unknown> = {
    which: {
      type: "choice",
      instructions: RERANK_INSTRUCTIONS,
      criteria,
    },
  };
  for (const name of names) {
    const skill = rosterByName[name];
    questions[`fits::${name}`] = {
      type: "noul",
      instructions: `Does the skill '${name}' do the specific thing the user's request asks for? It is described as: ${skill?.description_full ?? name}`,
    };
  }
  return questions;
}

export function suggestionBlock(names: string[]): string {
  const body = names.length
    ? `Relevant to the current request: ${names.join(", ")}. Ignore this if it does not fit what the user actually asked for.`
    : "No skill in the roster appears relevant to this request.";
  return `\n\n<skill_relevance>\n${body}\n</skill_relevance>`;
}

export interface RankWideResult {
  ranked: Array<[string, number]>;
  which: string;
  gate: number;
  values: Record<string, number>;
  raw: Record<string, number>;
}

export function composeSuggest(args: {
  stage1: RankWideResult;
  stage2?: { winner: string; fits: Record<string, number> };
}): SuggestResult {
  if (args.stage1.gate < GATE_THRESHOLD) {
    return {
      names: [],
      reason: `stage-1 gate ${args.stage1.gate.toFixed(2)} < ${GATE_THRESHOLD}`,
      stage1: {
        ranked: args.stage1.ranked,
        gate: args.stage1.gate,
        values: args.stage1.values,
      },
      raw: args.stage1.raw,
    };
  }
  if (!args.stage2) {
    return {
      names: [],
      reason: "stage-2 missing",
      stage1: {
        ranked: args.stage1.ranked,
        gate: args.stage1.gate,
        values: args.stage1.values,
      },
      raw: args.stage1.raw,
    };
  }
  const fitsValues = Object.values(args.stage2.fits);
  const best = fitsValues.length ? Math.max(...fitsValues) : 0;
  if (best < FITS_THRESHOLD || args.stage2.winner === "none") {
    return {
      names: [],
      reason: `stage-2 nothing fits (best ${best.toFixed(2)})`,
      stage1: {
        ranked: args.stage1.ranked,
        gate: args.stage1.gate,
        values: args.stage1.values,
      },
      stage2: args.stage2,
      raw: { ...args.stage1.raw, ...args.stage2.fits },
    };
  }
  return {
    names: [args.stage2.winner],
    reason: `suggest ${args.stage2.winner}`,
    stage1: {
      ranked: args.stage1.ranked,
      gate: args.stage1.gate,
      values: args.stage1.values,
    },
    stage2: args.stage2,
    raw: { ...args.stage1.raw, ...args.stage2.fits },
  };
}

export async function suggestLive(args: {
  request: string;
  roster: SkillRecord[];
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}): Promise<SuggestResult> {
  const state = { request: args.request, recent_context: "" };
  const model = args.model ?? DEFAULT_CONFIG.model;
  const endpoint = args.endpoint ?? DEFAULT_CONFIG.endpoint;
  const raw1 = await postRaw({
    state,
    questions: stage1Questions(args.roster),
    apiKey: args.apiKey,
    model,
    endpoint,
    fetchImpl: args.fetchImpl,
  });
  const which1 = raw1.answers.which as {
    choice?: string;
    probabilities?: Record<string, number>;
  };
  const values: Record<string, number> = {};
  for (const [key, answer] of Object.entries(raw1.answers)) {
    if (!key.startsWith("gate::")) continue;
    const n = (answer as { noul?: number }).noul;
    if (typeof n === "number") values[key.slice("gate::".length)] = n;
  }
  const ranked = Object.entries(which1.probabilities ?? {})
    .filter(([name]) => name !== "none")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12) as Array<[string, number]>;
  const stage1: RankWideResult = {
    ranked,
    which: String(which1.choice ?? "none"),
    gate: gateMean(values),
    values,
    raw: { gate: gateMean(values), ...values, ...(which1.probabilities ?? {}) },
  };
  if (stage1.gate < GATE_THRESHOLD) {
    return composeSuggest({ stage1 });
  }
  const shortlist = ranked.slice(0, SHORTLIST).map(([n]) => n);
  const byName = Object.fromEntries(args.roster.map((s) => [s.name, s]));
  const raw2 = await postRaw({
    state,
    questions: stage2Questions(byName, shortlist),
    apiKey: args.apiKey,
    model,
    endpoint,
    fetchImpl: args.fetchImpl,
  });
  const which2 = raw2.answers.which as { choice?: string };
  const fits: Record<string, number> = {};
  for (const [key, answer] of Object.entries(raw2.answers)) {
    if (!key.startsWith("fits::")) continue;
    const n = (answer as { noul?: number }).noul;
    if (typeof n === "number") fits[key.slice("fits::".length)] = n;
  }
  return composeSuggest({
    stage1,
    stage2: { winner: String(which2.choice ?? "none"), fits },
  });
}

async function postRaw(args: {
  state: unknown;
  questions: Record<string, unknown>;
  apiKey: string;
  model: string;
  endpoint: string;
  fetchImpl?: typeof fetch;
}): Promise<{ answers: Record<string, unknown> }> {
  // Reuse systemOne's HTTP, then return unparsed answers for `which`.
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(args.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      state: args.state,
      questions: args.questions,
      model: args.model,
    }),
  });
  if (!response.ok) {
    throw new Error(`TypeSafe HTTP ${response.status}`);
  }
  return (await response.json()) as { answers: Record<string, unknown> };
}
