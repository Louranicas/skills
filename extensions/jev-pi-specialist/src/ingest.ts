/**
 * Corpus ingest composition. Injection Noul >= 0.7 drops.
 * Contradict at 0.7 is NOT a standing auto-flag (missed a falsehood at 0.42).
 */

export const INJECTION_DROP = 0.7;
export const CONTRADICT_REVIEW = 0.35;
export const KEEP_FLOOR = 0.7;

export type IngestAction = "drop" | "review" | "keep";

export interface IngestNouls {
  injection: number;
  relevant: number;
  evidence: number;
  contradict: number;
}

export function ingestRoute(n: IngestNouls): { action: IngestAction; reason: string } {
  if (n.injection >= INJECTION_DROP) {
    return { action: "drop", reason: `injection ${n.injection.toFixed(2)} >= ${INJECTION_DROP}` };
  }
  if (n.contradict > n.relevant && n.contradict >= CONTRADICT_REVIEW) {
    return {
      action: "review",
      reason: `contradict ${n.contradict.toFixed(2)} > relevant ${n.relevant.toFixed(2)} (0.7 is not an auto-flag)`,
    };
  }
  if (n.relevant >= KEEP_FLOOR || n.evidence >= KEEP_FLOOR) {
    return { action: "keep", reason: "relevant or evidence above keep floor" };
  }
  return { action: "review", reason: "not enough support to keep" };
}
