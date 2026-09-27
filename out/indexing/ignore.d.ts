/**
 * File ignore rules for KODRA indexing.
 *
 * Adapted from KODRA's core/indexing/ignore.ts.
 * Implements a layered ignore system:
 *  1. Security-critical patterns (always excluded: .env, keys, certs, secrets)
 *  2. Default indexing exclusions (binaries, media, lockfiles, build artifacts)
 *  3. .gitignore rules (per-directory)
 *  4. .KODRAignore rules (per-directory, overrides .gitignore like .continueignore)
 *  5. User-configured additional patterns
 */
import { Ignore } from 'ignore';
export declare const SECURITY_IGNORE_FILETYPES: string[];
export declare const SECURITY_IGNORE_DIRS: string[];
export declare const DEFAULT_IGNORE_FILETYPES: string[];
export declare const DEFAULT_IGNORE_DIRS: string[];
export declare const ALL_SECURITY_IGNORES: string[];
export declare const ALL_DEFAULT_IGNORES: string[];
/**
 * Create an Ignore instance from the default patterns.
 */
export declare function createDefaultIgnore(additionalPatterns?: string[]): Ignore;
/**
 * Create a security-only Ignore instance (for checking sensitive files).
 */
export declare function createSecurityIgnore(): Ignore;
/**
 * Check if a file path matches security-sensitive patterns.
 * Used to prevent indexing and reading of secrets.
 */
export declare function isSecurityConcern(filepath: string): boolean;
/**
 * Parse a .gitignore or .KODRAignore file into ignore patterns.
 * Strips comments and empty lines.
 */
export declare function parseIgnoreFile(content: string): string[];
//# sourceMappingURL=ignore.d.ts.map