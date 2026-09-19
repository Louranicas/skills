/** Shared types for the rules-first Jev tool gate and skill suggestion. */

export type ToolName = "bash" | "write" | "edit";

export type GateAction = "allow" | "deny" | "ask";

export type RuleKind = "hard_deny" | "fast_path" | "unvouched";

export interface ToolCallInput {
  tool: ToolName;
  cwd: string;
  /** bash: command string; write/edit: target path */
  command?: string;
  path?: string;
  /** User's latest prompt; never file bodies or tool output. */
  userRequest?: string;
}

export interface RuleVerdict {
  kind: RuleKind;
  action: GateAction;
  reason: string;
  /** True when Jev must not run because code already decided. */
  terminal: boolean;
}

export type ConditionMode = "detector" | "required";
export type UnclearPolicy = "deny" | "ask" | "allow" | "ignore";

export interface ConditionSpec {
  id: string;
  /** Safety-phrased (high = safe) or hazard-phrased (high = hazard). */
  polarity: "safe" | "hazard";
  mode: ConditionMode;
  /** Detector block: p <= 1-t (safe) or p >= t (hazard). Raising t contracts the reject band. */
  threshold: number;
  /** Unclear-band policy. secret_egress is fail-closed (deny). */
  unclear: UnclearPolicy;
  /**
   * For hazard fail-closed: ignore unclear p below this floor (the live safe
   * cluster). Stress steal was 0.12–0.15; requested edits live at ~0.05.
   */
  unclearMin?: number;
}

export type Band = "satisfied" | "violated" | "unclear";

export interface ConditionResult {
  id: string;
  p: number;
  band: Band;
  threshold: number;
  contribution: GateAction | "ignore";
}

export type PolicyChoice = "allow" | "ask" | "deny" | "other";

export interface JevAnswers {
  policy: {
    choice: PolicyChoice;
    confidence: number;
    probabilities: Record<string, number>;
  };
  nouls: Record<string, number>;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface GateVerdict {
  action: GateAction;
  source: "rules" | "jev" | "fail_closed";
  reason: string;
  rule?: RuleVerdict;
  jev?: JevAnswers;
  conditions?: ConditionResult[];
  /** Raw probabilities for the training harness. */
  raw: Record<string, number>;
}

export interface GateConfig {
  model: string;
  endpoint: string;
  timeoutMs: number;
  /** Fail closed when the key is missing. */
  requireApiKey: boolean;
  conditions: Record<string, ConditionSpec>;
  /** Choice confidence below this coarsens allow → ask, and other → deny. */
  policyConfidenceFloor: number;
}

export interface SkillRecord {
  name: string;
  description: string;
  description_full: string;
  body: string;
  category?: string;
}

export interface SuggestResult {
  names: string[];
  reason: string;
  stage1?: {
    ranked: Array<[string, number]>;
    gate: number;
    values: Record<string, number>;
  };
  stage2?: {
    winner: string;
    fits: Record<string, number>;
  };
  raw: Record<string, number>;
}
