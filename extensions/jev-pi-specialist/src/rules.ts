/**
 * Deterministic envelope. Runs before Jev and cannot be overruled.
 *
 * Hard-deny (stress, jev-1.13.0): curl-to-unknown, key paths, chmod on ~/.ssh,
 * force-push. chmod 777 ~/.ssh scored destructive 0.04 — Jev will not catch it.
 *
 * Fast-path: ls / pwd / git status. Jev intent_coverage on these is ~0.46–0.61,
 * not a clean allow, so they must never reach the model.
 */

import type { GateAction, RuleKind, RuleVerdict, ToolCallInput } from "./types.ts";

const SHELL_CONTROL = /(?:&&|\|\||[;|`\n]|(?:^|[^<])<[^<]|(?:^|[^>])>[^>]|\$\(|\$\{)/;

/** Hosts curl/wget may target without a hard-deny. Anything else is unknown. */
const KNOWN_CURL_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "pypi.python.org",
  "files.pythonhosted.org",
  "pypi.typesafe.ai",
  "docs.typesafe.ai",
  "api.typesafe.ai",
  "console.typesafe.ai",
  "crates.io",
  "static.crates.io",
  "index.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
  "storage.googleapis.com",
]);

const KEY_PATH =
  /(?:^|[\s"'=:@/])(?:\$HOME\/|~\/|\.\.?\/)?(?:\.ssh\b|id_rsa\b|id_ed25519\b|id_ecdsa\b|id_dsa\b|authorized_keys\b|\.pem\b|\.env(?:\.[A-Za-z0-9._-]+)?\b|aws\/credentials\b|gcloud\/credentials\b|kube\/config\b)/i;

const KEY_ENV = /\b(?:TYPESAFE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|GH_TOKEN|GITHUB_TOKEN|NPM_TOKEN|PRIVATE_KEY)\b/;

const FORCE_PUSH = /\bgit\s+push\b[\s\S]*?(?:--force-with-lease|--force\b|[\s]-f\b)/;

const CHMOD_SSH = /\bchmod\b[\s\S]*?(?:~\/\.ssh|\.ssh\b)/;

const CURL_BIN = /\b(?:curl|wget)\b/i;

const FAST_PATH_BASH =
  /^(?:ls(?:\s+-[a-zA-Z0-9-]+)*|pwd|git\s+status(?:\s+-{1,2}[a-zA-Z0-9-]+)*)$/;

function verdict(
  kind: RuleKind,
  action: GateAction,
  reason: string,
  terminal: boolean,
): RuleVerdict {
  return { kind, action, reason, terminal };
}

function bashCommand(input: ToolCallInput): string {
  return (input.command ?? "").trim();
}

function targetPath(input: ToolCallInput): string {
  if (input.path) return input.path;
  return "";
}

function hostsFromCommand(command: string): string[] {
  const hosts: string[] = [];
  const urlRe = /https?:\/\/([^/\s:'"]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(command)) !== null) {
    hosts.push(match[1].toLowerCase().replace(/^www\./, ""));
  }
  return hosts;
}

function isUnknownCurl(command: string): boolean {
  if (!CURL_BIN.test(command)) return false;
  const hosts = hostsFromCommand(command);
  if (hosts.length === 0) {
    // curl of a variable, pipe, or flag-only invocation: unvouched network.
    return true;
  }
  return hosts.some((host) => !KNOWN_CURL_HOSTS.has(host));
}

function mentionsKeyMaterial(text: string): boolean {
  return KEY_PATH.test(text) || KEY_ENV.test(text);
}

function isProtectedWritePath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (mentionsKeyMaterial(p)) return true;
  if (/(?:^|\/)\.ssh(?:\/|$)/.test(p)) return true;
  if (/(?:^|\/)\.env(?:\.[A-Za-z0-9._-]+)?$/.test(p)) return true;
  if (/(?:^|\/)id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$/.test(p)) return true;
  if (/(?:^|\/)\.git\/(?:config|hooks)\b/.test(p)) return true;
  return false;
}

export function classifyRules(input: ToolCallInput): RuleVerdict {
  if (input.tool === "bash") {
    const command = bashCommand(input);
    if (!command) {
      return verdict("hard_deny", "deny", "empty bash command", true);
    }
    if (FORCE_PUSH.test(command)) {
      return verdict(
        "hard_deny",
        "deny",
        "hard-deny: git force-push (Jev is not asked)",
        true,
      );
    }
    if (CHMOD_SSH.test(command)) {
      return verdict(
        "hard_deny",
        "deny",
        "hard-deny: chmod on ~/.ssh (destructive Noul is ~0.04; code must catch it)",
        true,
      );
    }
    if (mentionsKeyMaterial(command)) {
      return verdict(
        "hard_deny",
        "deny",
        "hard-deny: key path or secret env in command",
        true,
      );
    }
    if (isUnknownCurl(command)) {
      return verdict(
        "hard_deny",
        "deny",
        "hard-deny: curl/wget to an unknown host",
        true,
      );
    }
    if (!SHELL_CONTROL.test(command) && FAST_PATH_BASH.test(command)) {
      return verdict(
        "fast_path",
        "allow",
        "fast-path: ls/pwd/git status (intent_coverage is ~0.46–0.61, not a clean allow)",
        true,
      );
    }
    return verdict("unvouched", "ask", "unvouched bash; Jev must judge", false);
  }

  const path = targetPath(input);
  if (!path) {
    return verdict("hard_deny", "deny", `empty ${input.tool} path`, true);
  }
  if (isProtectedWritePath(path)) {
    return verdict(
      "hard_deny",
      "deny",
      `hard-deny: ${input.tool} of a key or protected path`,
      true,
    );
  }
  return verdict(
    "unvouched",
    "ask",
    `unvouched ${input.tool}; Jev must judge`,
    false,
  );
}

export const RULES = {
  KNOWN_CURL_HOSTS,
  SHELL_CONTROL,
  isUnknownCurl,
  mentionsKeyMaterial,
  isProtectedWritePath,
};
