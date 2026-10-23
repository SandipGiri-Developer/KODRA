/**
 * Safe Command Matcher and Policy Precedence Engine for Kodra.
 * 
 * Enforces conservative, deterministic matching:
 * - Detects compound/chained shell commands and prohibits partial prefix matching.
 * - Tokenizes commands respecting quotes to prevent prefix leakage.
 * - Strict precedence: Explicit Denial > Workspace Specific > Global Specific > Fallback.
 */

import { ApprovalPolicy, PolicyEvaluationResult } from './types';

export class CommandMatcher {
  /**
   * Detect compound operators (&&, ||, ;, |, &, newlines, command substitution, redirection).
   */
  public static isCompoundCommand(command: string): boolean {
    if (!command) {
      return false;
    }
    // Check for newlines
    if (/[\r\n]/.test(command)) {
      return true;
    }

    // Strip quoted strings to inspect only unquoted shell syntax
    const unquoted = this.stripQuotes(command);

    // Look for shell control operators:
    // &&, ||, ;, |, & (background), redirection (>, >>, <), substitution ($(), ``)
    if (/(&&|\|\||[;&|]|>{1,2}|<|\$\(|\`)/.test(unquoted)) {
      return true;
    }

    return false;
  }

  /**
   * Strip contents of double and single quotes to prevent false positives/negatives in shell operators.
   */
  public static stripQuotes(str: string): string {
    return str.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  }

  /**
   * Normalize command whitespace without altering parameter casing or semantics.
   */
  public static normalizeCommand(command: string): string {
    if (!command) {
      return '';
    }
    const trimmed = command.trim();
    // Collapse multiple whitespace outside of quotes
    const tokens = this.tokenizeCommand(trimmed);
    return tokens.join(' ');
  }

  /**
   * Check whether a command string has unbalanced quotes or dangling escape characters.
   */
  public static hasUnbalancedQuotes(command: string): boolean {
    if (!command) {
      return false;
    }
    let inSingle = false;
    let inDouble = false;
    let escape = false;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (inSingle) {
        if (char === "'") {
          inSingle = false;
        }
        continue;
      }

      if (inDouble) {
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inDouble = false;
        }
        continue;
      }

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === "'") {
        inSingle = true;
        continue;
      }

      if (char === '"') {
        inDouble = true;
        continue;
      }
    }

    return inSingle || inDouble || escape;
  }

  /**
   * Tokenize command string into discrete arguments, preserving quote boundaries
   * to ensure exact commands and prefix rules distinguish argument structures.
   */
  public static tokenizeCommand(command: string): string[] {
    if (!command || !command.trim()) {
      return [];
    }

    const tokens: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escape = false;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (inSingleQuote) {
        current += char;
        if (char === "'") {
          inSingleQuote = false;
        }
        continue;
      }

      if (inDoubleQuote) {
        current += char;
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inDoubleQuote = false;
        }
        continue;
      }

      if (escape) {
        current += char;
        escape = false;
        continue;
      }

      if (char === '\\') {
        const next = command[i + 1];
        if (next && (/\s/.test(next) || next === '"' || next === "'")) {
          escape = true;
          current += char;
          continue;
        }
        current += char;
        continue;
      }

      if (char === "'") {
        current += char;
        inSingleQuote = true;
        continue;
      }

      if (char === '"') {
        current += char;
        inDoubleQuote = true;
        continue;
      }

      if (/\s/.test(char)) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Check if a given command matches an individual approval policy.
   */
  public static matchesPolicy(command: string, policy: ApprovalPolicy): boolean {
    if (!policy.enabled || !command) {
      return false;
    }

    if (this.hasUnbalancedQuotes(command) || this.hasUnbalancedQuotes(policy.commandPattern)) {
      return false;
    }

    const normCmd = this.normalizeCommand(command);
    const normPattern = this.normalizeCommand(policy.commandPattern);

    if (!normCmd || !normPattern) {
      return false;
    }

    const isCompound = this.isCompoundCommand(command);

    // SAFETY RULE: If a command is compound, it can ONLY match an exact rule
    // whose pattern is also the exact compound command. Prefix/pattern matching is PROHIBITED.
    if (isCompound) {
      if (policy.ruleType === 'exact') {
        return normCmd === normPattern;
      }
      return false;
    }

    switch (policy.ruleType) {
      case 'exact':
        return normCmd === normPattern;

      case 'prefix': {
        const cmdTokens = this.tokenizeCommand(command);
        const patternTokens = this.tokenizeCommand(policy.commandPattern);

        if (patternTokens.length === 0 || patternTokens.length > cmdTokens.length) {
          return false;
        }

        // Must match token-for-token from index 0
        for (let i = 0; i < patternTokens.length; i++) {
          if (cmdTokens[i] !== patternTokens[i]) {
            return false;
          }
        }
        return true;
      }

      case 'pattern': {
        // Pattern matches exact command or glob with safe wildcard *
        try {
          const regexStr = '^' + normPattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
            .replace(/\*/g, '.*') + '$';
          const regex = new RegExp(regexStr);
          return regex.test(normCmd);
        } catch {
          return false;
        }
      }

      default:
        return false;
    }
  }

  /**
   * Calculate specificity score of a policy.
   * Higher number = more specific.
   * Exact > Specific Prefix (more tokens) > Pattern.
   */
  public static getSpecificityScore(policy: ApprovalPolicy): number {
    const tokens = this.tokenizeCommand(policy.commandPattern);
    let base = tokens.length * 10;
    if (policy.ruleType === 'exact') {
      base += 1000;
    } else if (policy.ruleType === 'prefix') {
      base += 500;
    } else {
      base += 100;
    }
    // Workspace policies get a specificity boost over global policies
    if (policy.scope === 'workspace') {
      base += 50;
    }
    return base;
  }

  /**
   * Evaluate a command against a list of active policies using deterministic precedence:
   * 1. Any matching DENY policy (workspace denial first, then global denial) -> immediate DENY.
   * 2. Matching ALLOW policies sorted by specificity (exact > prefix, workspace > global).
   * 3. Fallback -> REQUIRE_APPROVAL.
   */
  public static evaluatePolicies(
    command: string,
    policies: ApprovalPolicy[],
    workspaceId: string,
  ): PolicyEvaluationResult {
    const trimmed = (command || '').trim();
    if (!trimmed) {
      return {
        decision: 'require_approval',
        reason: 'Empty command requires user approval.',
      };
    }

    // Filter to policies applicable to this context
    const applicablePolicies = policies.filter((p) => {
      if (!p.enabled) {
        return false;
      }
      if (p.scope === 'workspace') {
        return p.workspaceId === workspaceId;
      }
      return p.scope === 'global';
    });

    // Find all matching policies
    const matches = applicablePolicies.filter((p) => this.matchesPolicy(trimmed, p));

    if (matches.length === 0) {
      return {
        decision: 'require_approval',
        reason: 'No matching persistent policy found.',
      };
    }

    // Step 1: Check Explicit Denials (Highest Precedence)
    // Check workspace denials first
    const workspaceDenial = matches.find((p) => p.scope === 'workspace' && p.decision === 'deny');
    if (workspaceDenial) {
      return {
        decision: 'deny',
        matchedPolicy: workspaceDenial,
        reason: `Explicit workspace policy denied command: "${workspaceDenial.description || workspaceDenial.commandPattern}"`,
      };
    }

    // Check global denials next
    const globalDenial = matches.find((p) => p.scope === 'global' && p.decision === 'deny');
    if (globalDenial) {
      return {
        decision: 'deny',
        matchedPolicy: globalDenial,
        reason: `Explicit global policy denied command: "${globalDenial.description || globalDenial.commandPattern}"`,
      };
    }

    // Step 2: Evaluate matching Allow policies by specificity
    const allowMatches = matches.filter((p) => p.decision === 'allow');
    if (allowMatches.length === 0) {
      return {
        decision: 'require_approval',
        reason: 'No applicable allow policy matched.',
      };
    }

    // Sort by specificity descending
    allowMatches.sort((a, b) => this.getSpecificityScore(b) - this.getSpecificityScore(a));

    const bestMatch = allowMatches[0];
    return {
      decision: 'allow',
      matchedPolicy: bestMatch,
      reason: `Authorized by ${bestMatch.scope} policy: "${bestMatch.description || bestMatch.commandPattern}"`,
    };
  }
}
