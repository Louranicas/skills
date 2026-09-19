/** Redact obvious credentials before a payload leaves the machine. */

const PATTERNS: Array<[RegExp, string]> = [
  [/\bTYPESAFE_API_KEY\s*=\s*\S+/g, "TYPESAFE_API_KEY=<redacted>"],
  [/\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|GH_TOKEN|GITHUB_TOKEN|NPM_TOKEN)\s*=\s*\S+/g, "<redacted-env>"],
  [/\bBearer\s+[A-Za-z0-9._\-]+/g, "Bearer <redacted>"],
  [/\bsk-[A-Za-z0-9]{10,}/g, "sk-<redacted>"],
  [/\bghp_[A-Za-z0-9]{20,}/g, "ghp_<redacted>"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted-pem>"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}
