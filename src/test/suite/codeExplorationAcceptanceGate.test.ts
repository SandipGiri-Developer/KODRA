/**
 * Strict acceptance gate for the remaining Code Exploration Toolset criteria.
 *
 * These are behavioral tests, not registration/schema smoke tests. They deliberately
 * exercise real filesystem changes and a real temporary Git repository.
 *
 * A failure in this suite means the corresponding acceptance criterion is NOT met.
 * Do not weaken assertions merely to make the suite green; fix the implementation.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitContextTool } from '../../agent/tools/gitContextTool';
import {
  isPathInWorkspace,
  VSCodeWorkspaceService,
  WorkspaceFolderInfo,
} from '../../agent/workspaceService';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_CHARS = 8000;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 10000 });
  return String(stdout);
}

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('Code Exploration Toolset — Strict Acceptance Gate', () => {
  describe('Search cache freshness', () => {
    let root: string;

    beforeEach(async () => {
      root = await createTempDir('kodra-cache-gate-');
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'candidate.ts'), 'export const value = "ordinary text";\n');
    });

    afterEach(async () => {
      await fs.rm(root, { recursive: true, force: true });
    });

    it('must invalidate cached no-match results when an existing non-matching file changes to match', async () => {
      const service = new VSCodeWorkspaceService(root);
      const query = 'KODRA_CACHE_INVALIDATION_SENTINEL';

      const initial = await service.searchFiles(query, { maxResults: 20 });
      expect(initial).toEqual([]);
      expect(service.searchCache.size).toBe(1);

      // Editing a file does not change its parent directory mtime. This catches
      // caches that validate only matched files and directory mtimes.
      const candidate = path.join(root, 'src', 'candidate.ts');
      await new Promise((resolve) => setTimeout(resolve, 30));
      await fs.writeFile(candidate, `export const value = "${query}";\n`);

      const refreshed = await service.searchFiles(query, { maxResults: 20 });
      expect(refreshed).toEqual([
        expect.objectContaining({
          file: expect.stringMatching(/src[\\/]candidate\.ts|src\/candidate\.ts/),
          content: expect.stringContaining(query),
        }),
      ]);
    });
  });

  describe('Filesystem containment', () => {
    let root: string;
    let outside: string;

    beforeEach(async () => {
      root = await createTempDir('kodra-containment-root-');
      outside = await createTempDir('kodra-containment-outside-');
      await fs.writeFile(path.join(outside, 'secret.ts'), 'export const secret = true;\n');
    });

    afterEach(async () => {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    });

    it('must reject a workspace symlink/junction whose real target is outside the workspace', async () => {
      const linkPath = path.join(root, 'external');
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';

      try {
        await fs.symlink(outside, linkPath, linkType);
      } catch (error) {
        // This is an acceptance gate: inability to create a symlink is not a pass.
        throw new Error(
          `Unable to create a filesystem symlink/junction for the containment test; do not mark the criterion passed. Original error: ${String(error)}`,
        );
      }

      const folders: WorkspaceFolderInfo[] = [{ name: 'workspace', fsPath: root }];
      const linkedSecret = path.join(linkPath, 'secret.ts');

      // Lexical containment is insufficient: the target resolves outside root.
      expect(isPathInWorkspace(linkedSecret, folders)).toBe(false);
    });

    it('must reject a sibling path that only shares the workspace root prefix', () => {
      const folders: WorkspaceFolderInfo[] = [{ name: 'workspace', fsPath: root }];
      expect(isPathInWorkspace(root + '-sibling' + path.sep + 'secret.ts', folders)).toBe(false);
    });
  });

  describe('Real Git integration and output limits', () => {
    let repo: string;
    let workspaceService: VSCodeWorkspaceService;
    let tool: GitContextTool;

    beforeEach(async () => {
      repo = await createTempDir('kodra-git-gate-');
      await git(repo, ['init']);
      await git(repo, ['config', 'user.name', 'KODRA Acceptance Test']);
      await git(repo, ['config', 'user.email', 'kodra-acceptance@example.invalid']);

      await fs.writeFile(path.join(repo, 'tracked.txt'), 'original line\nsecond line\n');
      await git(repo, ['add', 'tracked.txt']);
      await git(repo, ['commit', '-m', 'acceptance baseline']);

      workspaceService = new VSCodeWorkspaceService(repo);
      tool = new GitContextTool(workspaceService);
    });

    afterEach(async () => {
      await fs.rm(repo, { recursive: true, force: true });
    });

    it('must report real staged and unstaged changes separately', async () => {
      await fs.writeFile(path.join(repo, 'tracked.txt'), 'staged line\nsecond line\n');
      await git(repo, ['add', 'tracked.txt']);
      await fs.writeFile(path.join(repo, 'tracked.txt'), 'unstaged line\nsecond line\n');
      await fs.writeFile(path.join(repo, 'untracked.txt'), 'untracked content\n');

      const staged = await tool.execute({ operation: 'diff', file: 'tracked.txt', staged: true });
      const unstaged = await tool.execute({ operation: 'diff', file: 'tracked.txt' });
      const status = await tool.execute({ operation: 'status' });

      expect(staged.success).toBe(true);
      expect(staged.content).toContain('staged line');
      expect(staged.content).not.toContain('unstaged line');

      expect(unstaged.success).toBe(true);
      expect(unstaged.content).toContain('unstaged line');

      expect(status.success).toBe(true);
      expect(status.content).toContain('Staged');
      expect(status.content).toContain('Unstaged');
      expect(status.content).toContain('Untracked');
      expect(status.content).toContain('untracked.txt');
    });

    it('must return actual commit history and line blame from the temporary repository', async () => {
      const log = await tool.execute({ operation: 'log', file: 'tracked.txt', maxLines: 5 });
      const blame = await tool.execute({ operation: 'blame', file: 'tracked.txt', maxLines: 10 });

      expect(log.success).toBe(true);
      expect(log.content).toContain('acceptance baseline');
      expect(log.content).toMatch(/[0-9a-f]{7,40}/i);

      expect(blame.success).toBe(true);
      expect(blame.content).toContain('KODRA Acceptance Tes');
      expect(blame.content).toContain('original line');
    });

    it('must cap status output at the configured hard limit and mark truncation', async () => {
      // Create enough real untracked files to force status output past the limit.
      const names = Array.from({ length: 600 }, (_, i) =>
        `untracked-${String(i).padStart(4, '0')}-${'x'.repeat(24)}.txt`,
      );
      await Promise.all(names.map((name) => fs.writeFile(path.join(repo, name), 'x')));

      const result = await tool.execute({ operation: 'status' });

      expect(result.success).toBe(true);
      expect(result.content.length).toBeLessThanOrEqual(MAX_GIT_OUTPUT_CHARS);
      expect(result.content).toContain('truncated');
      expect(result.metadata).toEqual(expect.objectContaining({ truncated: true }));
    }, 30000);
  });
});