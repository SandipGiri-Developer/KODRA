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

import ignore, { Ignore } from 'ignore';

// ─── Security-focused ignore patterns ──────────────────────────────────────
// These MUST always be excluded to prevent indexing secrets, credentials, and keys.

export const SECURITY_IGNORE_FILETYPES = [
  '*.env', '*.env.*', '.env*',
  '*.key', '*.pem', '*.p12', '*.pfx', '*.crt', '*.cer',
  '*.jks', '*.keystore', '*.truststore',
  '*.secret', '*.secrets', '*.token', 'auth.json',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  '*.ppk', '*.gpg',
];

export const SECURITY_IGNORE_DIRS = [
  '.env/', '.aws/', '.gcp/', '.azure/', '.kube/', '.docker/',
  'secrets/', '.secrets/', 'private/', '.private/',
  'certs/', 'certificates/', 'keys/', '.ssh/', '.gnupg/',
];

// ─── Default indexing exclusions ───────────────────────────────────────────

export const DEFAULT_IGNORE_FILETYPES = [
  '*.DS_Store', '*-lock.json', '*.lock', '*.log',
  // Fonts and images
  '*.ttf', '*.woff', '*.woff2', '*.eot',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.ico', '*.webp',
  // Media
  '*.mp4', '*.mp3', '*.avi', '*.mov', '*.mkv', '*.webm', '*.wav',
  // Archives
  '*.zip', '*.gz', '*.tar', '*.tgz', '*.rar', '*.7z', '*.dmg',
  // Binaries
  '*.exe', '*.dll', '*.so', '*.dylib', '*.obj', '*.o', '*.a', '*.lib',
  '*.bin', '*.jar', '*.wasm', '*.onnx', '*.parquet',
  // Documents (binary)
  '*.pdf',
  // Database files
  '*.db', '*.sqlite', '*.sqlite3', '*.mdb',
  // IDE files
  '*.map', '*.profraw', '*.gcda', '*.gcno', '*.pdb',
  // Source control
  '*.gitignore', '*.gitkeep',
  // CSV and data files
  '*.csv', '*.jsonl',
  // Misc
  'go.sum', '*.swp',
];

export const DEFAULT_IGNORE_DIRS = [
  '.git/', '.svn/', 'node_modules/', '.next/', 'dist/', 'build/', 'Build/',
  'target/', 'out/', 'bin/',
  '.pytest_cache/', '.vscode-test/', '__pycache__/', 'site-packages/',
  '.gradle/', '.mvn/', '.cache/', 'vendor/', 'gems/',
  '.venv/', 'venv/', 'env/',
  '.vscode/', '.idea/', '.vs/',
  'coverage/', '.nyc_output/',
  // KODRA's own index
  '.KODRA/',
];

// ─── Combined patterns ────────────────────────────────────────────────────

export const ALL_SECURITY_IGNORES = [...SECURITY_IGNORE_FILETYPES, ...SECURITY_IGNORE_DIRS];
export const ALL_DEFAULT_IGNORES = [
  ...SECURITY_IGNORE_FILETYPES, ...SECURITY_IGNORE_DIRS,
  ...DEFAULT_IGNORE_FILETYPES, ...DEFAULT_IGNORE_DIRS,
];

/**
 * Create an Ignore instance from the default patterns.
 */
export function createDefaultIgnore(additionalPatterns: string[] = []): Ignore {
  return ignore()
    .add(ALL_DEFAULT_IGNORES)
    .add(additionalPatterns);
}

/**
 * Create a security-only Ignore instance (for checking sensitive files).
 */
export function createSecurityIgnore(): Ignore {
  return ignore().add(ALL_SECURITY_IGNORES);
}

/**
 * Check if a file path matches security-sensitive patterns.
 * Used to prevent indexing and reading of secrets.
 */
export function isSecurityConcern(filepath: string): boolean {
  if (!filepath) { return false; }
  const securityIgnore = createSecurityIgnore();
  // Use just the basename + parent dir for matching
  const parts = filepath.replace(/\\/g, '/').split('/');
  const basename = parts.pop() || '';
  const parentDir = parts.pop() || '';
  const testPath = parentDir ? `${parentDir}/${basename}` : basename;
  try {
    return securityIgnore.ignores(testPath);
  } catch {
    return false;
  }
}

/**
 * Parse a .gitignore or .KODRAignore file into ignore patterns.
 * Strips comments and empty lines.
 */
export function parseIgnoreFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}
