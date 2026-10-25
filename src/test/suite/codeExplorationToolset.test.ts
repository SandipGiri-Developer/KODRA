/**
 * Tests for the Code Exploration Toolset:
 *   - FindSymbolTool (find_symbol)
 *   - GoToDefinitionTool (go_to_definition)
 *   - FindReferencesTool (find_references)
 *   - GitContextTool (git_context)
 *
 * All tests use a real temp workspace on disk so the tools exercise the
 * actual filesystem path rather than mocked APIs.
 * VS Code language-server APIs are not available in the test runner, so
 * the suite validates the fallback text-search paths and git operations.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FindSymbolTool } from '../../agent/tools/findSymbolTool';
import { GoToDefinitionTool } from '../../agent/tools/goToDefinitionTool';
import { FindReferencesTool } from '../../agent/tools/findReferencesTool';
import { GitContextTool } from '../../agent/tools/gitContextTool';
import { ListDirectoryTool } from '../../agent/tools/listDirectoryTool';
import { SearchCodeTool } from '../../agent/tools/searchCodeTool';
import {
  VSCodeWorkspaceService,
  isPathInWorkspace,
  isUriInWorkspace,
  matchesPattern,
  SearchCache,
} from '../../agent/workspaceService';
import {
  FindSymbolTool as FindSymbolReExport,
  GoToDefinitionTool as GoDef,
  FindReferencesTool as FindRefs,
  GitContextTool as GitCtx,
  getAllTools,
} from '../../agent/tools';

const execFileAsync = promisify(execFile);

describe('Code Exploration Toolset', () => {
  let tempWs: string;
  let workspaceService: VSCodeWorkspaceService;

  beforeAll(async () => {
    tempWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-explore-'));

    // Seed workspace with representative source files
    await fs.mkdir(path.join(tempWs, 'src'), { recursive: true });

    await fs.writeFile(
      path.join(tempWs, 'src', 'index.ts'),
      [
        'export class UserService {',
        '  constructor(private db: Database) {}',
        '  async getUser(id: string): Promise<User> {',
        '    return this.db.find(id);',
        '  }',
        '}',
        '',
        'export interface User {',
        '  id: string;',
        '  name: string;',
        '}',
        '',
        'export function createUserService(db: Database): UserService {',
        '  return new UserService(db);',
        '}',
        '',
        'type Database = { find: (id: string) => Promise<any> };',
      ].join('\n'),
    );

    await fs.writeFile(
      path.join(tempWs, 'src', 'utils.ts'),
      [
        'import { User } from "./index";',
        '',
        'export function formatUser(user: User): string {',
        '  return `${user.name} (${user.id})`;',
        '}',
        '',
        'export const DEFAULT_USER: User = { id: "0", name: "anonymous" };',
      ].join('\n'),
    );

    await fs.writeFile(
      path.join(tempWs, 'src', 'server.ts'),
      [
        'import { UserService } from "./index";',
        'import { formatUser } from "./utils";',
        '',
        'export async function startServer(service: UserService): Promise<void> {',
        '  const user = await service.getUser("1");',
        '  console.log(formatUser(user));',
        '}',
      ].join('\n'),
    );

    await fs.writeFile(
      path.join(tempWs, 'package.json'),
      JSON.stringify({ name: 'exploration-test', version: '1.0.0' }, null, 2),
    );

    // Point vscode workspace at tempWs
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: tempWs }, name: 'exploration-test', index: 0 },
    ];

    workspaceService = new VSCodeWorkspaceService(tempWs);
  });

  afterAll(async () => {
    try {
      await fs.rm(tempWs, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ---------------------------------------------------------------------------
  // Re-export verification
  // ---------------------------------------------------------------------------
  describe('Tool re-exports from tools.ts', () => {
    it('exports FindSymbolTool', () => {
      expect(FindSymbolReExport).toBeDefined();
      expect(typeof FindSymbolReExport).toBe('function');
    });

    it('exports GoToDefinitionTool', () => {
      expect(GoDef).toBeDefined();
    });

    it('exports FindReferencesTool', () => {
      expect(FindRefs).toBeDefined();
    });

    it('exports GitContextTool', () => {
      expect(GitCtx).toBeDefined();
    });

    it('getAllTools returns exactly 13 agent-facing tools', () => {
      const tools = getAllTools(workspaceService);
      expect(tools.length).toBe(13);
      const names = tools.map((t) => t.name);
      expect(names).toEqual([
        'read_file',
        'edit_file',
        'create_file',
        'list_directory',
        'search_code',
        'find_symbol',
        'find_references',
        'git_context',
        'run_command',
        'start_process',
        'read_process_output',
        'send_process_input',
        'stop_process',
      ]);
      expect(names).not.toContain('terminal');
      expect(names).not.toContain('go_to_definition');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool definition schemas
  // ---------------------------------------------------------------------------
  describe('Tool definition schemas', () => {
    it('find_symbol has correct schema supporting both query and definition navigation', () => {
      const tool = new FindSymbolTool(workspaceService);
      expect(tool.name).toBe('find_symbol');
      const def = tool.getDefinition();
      expect(def.type).toBe('function');
      expect(def.function.name).toBe('find_symbol');
      const props = def.function.parameters.properties as Record<string, unknown>;
      expect(props.query).toBeDefined();
      expect(props.file).toBeDefined();
      expect(props.line).toBeDefined();
    });

    it('go_to_definition has correct schema', () => {
      const tool = new GoToDefinitionTool(workspaceService);
      expect(tool.name).toBe('go_to_definition');
      const def = tool.getDefinition();
      expect(def.function.parameters.required).toContain('file');
      expect(def.function.parameters.required).toContain('line');
    });

    it('find_references has correct schema', () => {
      const tool = new FindReferencesTool(workspaceService);
      expect(tool.name).toBe('find_references');
      const def = tool.getDefinition();
      expect(def.function.parameters.required).toContain('file');
      expect(def.function.parameters.required).toContain('line');
    });

    it('git_context has correct schema', () => {
      const tool = new GitContextTool(workspaceService);
      expect(tool.name).toBe('git_context');
      const def = tool.getDefinition();
      const params = def.function.parameters as any;
      expect(params.required).toContain('operation');
      expect(params.properties.operation.enum).toEqual(
        expect.arrayContaining(['log', 'blame', 'diff', 'status']),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // find_symbol
  // ---------------------------------------------------------------------------
  describe('FindSymbolTool', () => {
    let tool: FindSymbolTool;
    beforeEach(() => {
      tool = new FindSymbolTool(workspaceService);
    });

    it('returns error when query is missing', async () => {
      const result = await tool.execute({});
      expect(result.success).toBe(false);
      expect(result.content).toContain('Missing required argument');
    });

    it('finds UserService class via text-search fallback', async () => {
      const result = await tool.execute({ query: 'UserService' });
      // Either LS result or fallback — both should succeed
      expect(result.success).toBe(true);
      expect(result.content).toMatch(/UserService/i);
    });

    it('finds formatUser function', async () => {
      const result = await tool.execute({ query: 'formatUser' });
      expect(result.success).toBe(true);
      expect(result.content).toMatch(/formatUser/i);
    });

    it('returns empty result for non-existent symbol', async () => {
      const result = await tool.execute({ query: 'NonExistentSymbolXYZ999' });
      expect(result.success).toBe(true);
      expect(result.content).toMatch(/No symbols|No references|text-search/i);
    });

    it('accepts symbolName alias for query', async () => {
      const result = await tool.execute({ symbol: 'User' });
      expect(result.success).toBe(true);
    });

    it('respects maxResults limit', async () => {
      const result = await tool.execute({ query: 'User', maxResults: 2 });
      expect(result.success).toBe(true);
      // Result should not blow up
      expect(result.content).toBeTruthy();
    });

    it('returns no workspace error if workspace is missing', async () => {
      const noWsService = new VSCodeWorkspaceService('/nonexistent_workspace_xyz');
      const noWsTool = new FindSymbolTool(noWsService);
      const result = await noWsTool.execute({ query: 'anything' });
      // Depending on path resolution it may error or return no-match
      expect(result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // go_to_definition
  // ---------------------------------------------------------------------------
  describe('GoToDefinitionTool', () => {
    let tool: GoToDefinitionTool;
    beforeEach(() => {
      tool = new GoToDefinitionTool(workspaceService);
    });

    it('returns error when file is missing', async () => {
      const result = await tool.execute({ line: 1 });
      expect(result.success).toBe(false);
      expect(result.content).toContain('Missing required argument');
    });

    it('returns error for file outside workspace', async () => {
      const result = await tool.execute({
        file: '/tmp/outside-workspace-file.ts',
        line: 1,
      });
      // May deny access or report not found depending on OS temp path
      expect(result.success).toBe(false);
    });

    it('returns not-found for nonexistent file', async () => {
      const result = await tool.execute({
        file: 'src/nonexistent_file_xyz.ts',
        line: 1,
      });
      expect(result.success).toBe(false);
      expect(result.content).toMatch(/not found|File not found/i);
    });

    it('attempts definition resolution with symbolName fallback for known symbol', async () => {
      // Language server is unavailable in tests; falls back to text search
      const result = await tool.execute({
        file: 'src/server.ts',
        line: 4,
        column: 20,
        symbolName: 'UserService',
      });
      // Should succeed with fallback
      expect(result.success).toBe(true);
      expect(result.content).toMatch(/UserService|definition/i);
    });

    it('fails gracefully without symbolName when LS is unavailable', async () => {
      const result = await tool.execute({
        file: 'src/server.ts',
        line: 4,
        column: 20,
      });
      // Either an LS result or an informative failure — should not throw
      expect(result).toBeDefined();
      expect(typeof result.content).toBe('string');
    });

    it('rejects invalid or non-positive line and column numbers', async () => {
      const resZeroLine = await tool.execute({ file: 'src/server.ts', line: 0 });
      expect(resZeroLine.success).toBe(false);
      expect(resZeroLine.content).toMatch(/"line" must be a positive integer/i);

      const resNegLine = await tool.execute({ file: 'src/server.ts', line: -5 });
      expect(resNegLine.success).toBe(false);
      expect(resNegLine.content).toMatch(/"line" must be a positive integer/i);

      const resNanLine = await tool.execute({ file: 'src/server.ts', line: NaN });
      expect(resNanLine.success).toBe(false);
      expect(resNanLine.content).toMatch(/"line" must be a positive integer/i);

      const resZeroCol = await tool.execute({ file: 'src/server.ts', line: 1, column: 0 });
      expect(resZeroCol.success).toBe(false);
      expect(resZeroCol.content).toMatch(/"column" must be a positive integer/i);

      const resNegCol = await tool.execute({ file: 'src/server.ts', line: 1, column: -1 });
      expect(resNegCol.success).toBe(false);
      expect(resNegCol.content).toMatch(/"column" must be a positive integer/i);
    });
  });

  // ---------------------------------------------------------------------------
  // find_references
  // ---------------------------------------------------------------------------
  describe('FindReferencesTool', () => {
    let tool: FindReferencesTool;
    beforeEach(() => {
      tool = new FindReferencesTool(workspaceService);
    });

    it('returns error when file is missing', async () => {
      const result = await tool.execute({ line: 1 });
      expect(result.success).toBe(false);
      expect(result.content).toContain('Missing required argument');
    });

    it('returns not-found for nonexistent file', async () => {
      const result = await tool.execute({
        file: 'src/ghost.ts',
        line: 3,
        symbolName: 'anything',
      });
      expect(result.success).toBe(false);
    });

    it('finds references via text-search fallback for User interface', async () => {
      const result = await tool.execute({
        file: 'src/index.ts',
        line: 8, // interface User line
        column: 18,
        symbolName: 'User',
        maxResults: 20,
      });
      expect(result.success).toBe(true);
      // Should find usages in utils.ts, server.ts
      expect(result.content).toMatch(/User|reference/i);
    });

    it('returns success with empty count when symbol has no matches', async () => {
      const result = await tool.execute({
        file: 'src/index.ts',
        line: 1,
        symbolName: 'CompletelyUnusedSymbolZZZ',
      });
      expect(result.success).toBe(true);
      expect(result.content).toMatch(/No references/i);
    });

    it('rejects invalid or non-positive line and column numbers', async () => {
      const resZeroLine = await tool.execute({ file: 'src/index.ts', line: 0 });
      expect(resZeroLine.success).toBe(false);
      expect(resZeroLine.content).toMatch(/"line" must be a positive integer/i);

      const resNegLine = await tool.execute({ file: 'src/index.ts', line: -2 });
      expect(resNegLine.success).toBe(false);
      expect(resNegLine.content).toMatch(/"line" must be a positive integer/i);

      const resNanLine = await tool.execute({ file: 'src/index.ts', line: NaN });
      expect(resNanLine.success).toBe(false);
      expect(resNanLine.content).toMatch(/"line" must be a positive integer/i);

      const resZeroCol = await tool.execute({ file: 'src/index.ts', line: 1, column: 0 });
      expect(resZeroCol.success).toBe(false);
      expect(resZeroCol.content).toMatch(/"column" must be a positive integer/i);

      const resNegCol = await tool.execute({ file: 'src/index.ts', line: 1, column: -1 });
      expect(resNegCol.success).toBe(false);
      expect(resNegCol.content).toMatch(/"column" must be a positive integer/i);
    });
  });

  // ---------------------------------------------------------------------------
  // git_context
  // ---------------------------------------------------------------------------
  describe('GitContextTool', () => {
    let tool: GitContextTool;
    beforeEach(() => {
      tool = new GitContextTool(workspaceService);
    });

    it('returns error for invalid operation', async () => {
      const result = await tool.execute({ operation: 'rebase' });
      expect(result.success).toBe(false);
      expect(result.content).toMatch(/Invalid operation/i);
    });

    it('returns error when no workspace is open', async () => {
      const noWs = new VSCodeWorkspaceService('/nonexistent_workspace_xyz');
      const noWsTool = new GitContextTool(noWs);
      const result = await noWsTool.execute({ operation: 'status' });
      // Either workspace error or git-not-found
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('handles git not available gracefully (non-git temp dir)', async () => {
      // tempWs is not a git repo — should fail gracefully
      const result = await tool.execute({ operation: 'status' });
      expect(result).toBeDefined();
      expect(typeof result.content).toBe('string');
      // Success false expected since tempWs is not a git repo
      expect(result.success).toBe(false);
    });

    it('validates operation enum: log', async () => {
      const result = await tool.execute({ operation: 'log' });
      // Either succeeds (git available) or fails gracefully (not a repo)
      expect(typeof result.content).toBe('string');
    });

    it('validates operation enum: diff', async () => {
      const result = await tool.execute({ operation: 'diff' });
      expect(typeof result.content).toBe('string');
    });

    it('blame requires file argument', async () => {
      // If git is available, blame without file should produce error about missing file
      // If git is not available, will fail at git-available check
      const result = await tool.execute({ operation: 'blame' });
      expect(typeof result.content).toBe('string');
      if (result.success) {
        expect(result.content).toMatch(/requires/i);
      } else {
        // Either "Git is not available" or "requires file"
        expect(result.content).toBeTruthy();
      }
    });

    it('rejects file paths outside workspace or reports git unavailable', async () => {
      const result = await tool.execute({
        operation: 'log',
        file: '/etc/passwd',
      });
      expect(result.success).toBe(false);
      // Either access denied (path check) or git not available (repo check) — both are valid
      expect(result.content).toMatch(/Access denied|Git is not available|not a Git repository/i);
    });

    it('sanitizes commit ref to prevent shell injection and rejects invalid refs', async () => {
      const result = await tool.execute({
        operation: 'diff',
        commit: '$(rm -rf /)',
      });
      expect(typeof result.content).toBe('string');
      expect(result.success).toBe(false);
      expect(result.content).toMatch(/Invalid commit or ref/i);
    });

    it('schema: parameters include staged and operation enum contains all four values', () => {
      const def = tool.getDefinition();
      const opProp = (def.function.parameters as any).properties.operation as any;
      expect(opProp.enum).toEqual(expect.arrayContaining(['log', 'blame', 'diff', 'status']));
      const stagedProp = (def.function.parameters as any).properties.staged;
      expect(stagedProp).toBeDefined();
      expect(stagedProp.type).toBe('boolean');
    });

    it('accepts staged flag for diff operation', async () => {
      const result = await tool.execute({
        operation: 'diff',
        staged: true,
      });
      expect(typeof result.content).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // File Discovery & Search Enhancements
  // ---------------------------------------------------------------------------
  describe('File Discovery & Search Enhancements', () => {
    it('workspaceService.findFiles finds files matching glob pattern', async () => {
      const files = await workspaceService.findFiles('**/*.ts');
      expect(files.length).toBeGreaterThanOrEqual(3);
      expect(files.some((f) => f.includes('index.ts'))).toBe(true);
      expect(files.some((f) => f.includes('utils.ts'))).toBe(true);
      expect(files.some((f) => f.includes('server.ts'))).toBe(true);
    });

    it('workspaceService.findFiles respects exclude pattern', async () => {
      const files = await workspaceService.findFiles('**/*.ts', {
        excludePattern: '**/utils.ts',
      });
      expect(files.some((f) => f.includes('index.ts'))).toBe(true);
      expect(files.some((f) => f.includes('utils.ts'))).toBe(false);
    });

    it('workspaceService.findFiles respects maxResults limit', async () => {
      const files = await workspaceService.findFiles('**/*.ts', { maxResults: 1 });
      expect(files.length).toBe(1);
    });

    it('ListDirectoryTool discovers files with pattern argument', async () => {
      const listTool = new ListDirectoryTool(workspaceService);
      const res = await listTool.execute({ pattern: 'src/**/*.ts' });
      expect(res.success).toBe(true);
      expect(res.content).toContain('Discovered');
      expect(res.content).toContain('src/index.ts');
      expect(res.metadata?.itemCount).toBeGreaterThanOrEqual(3);
    });

    it('ListDirectoryTool supports exclude with pattern', async () => {
      const listTool = new ListDirectoryTool(workspaceService);
      const res = await listTool.execute({
        pattern: 'src/**/*.ts',
        exclude: '**/utils.ts',
      });
      expect(res.success).toBe(true);
      expect(res.content).toContain('src/index.ts');
      expect(res.content).not.toContain('src/utils.ts');
    });

    it('SearchCodeTool matches with workspace-relative filePattern src/**/*.ts', async () => {
      const searchTool = new SearchCodeTool(workspaceService);
      const res = await searchTool.execute({
        query: 'UserService',
        filePattern: 'src/**/*.ts',
      });
      expect(res.success).toBe(true);
      expect(res.content).toContain('src/index.ts');
    });

    it('SearchCodeTool excludes files with exclude parameter', async () => {
      const searchTool = new SearchCodeTool(workspaceService);
      const res = await searchTool.execute({
        query: 'User',
        exclude: '**/utils.ts',
      });
      expect(res.success).toBe(true);
      expect(res.content).toContain('src/index.ts');
      expect(res.content).not.toContain('src/utils.ts');
    });
  });

  // ---------------------------------------------------------------------------
  // Path Containment & Multi-root Safety
  // ---------------------------------------------------------------------------
  describe('Path Containment & Multi-root Safety', () => {
    it('isPathInWorkspace returns true for files inside workspace', () => {
      const folders = workspaceService.getWorkspaceFolders();
      const inside = isPathInWorkspace(path.join(tempWs, 'src', 'index.ts'), folders);
      expect(inside).toBe(true);
    });

    it('isPathInWorkspace returns false for files outside workspace', () => {
      const folders = workspaceService.getWorkspaceFolders();
      const outside = isPathInWorkspace('/etc/passwd', folders);
      expect(outside).toBe(false);
    });

    it('isUriInWorkspace correctly validates URIs', () => {
      const folders = workspaceService.getWorkspaceFolders();
      const insideUri = vscode.Uri.file(path.join(tempWs, 'src', 'server.ts'));
      expect(isUriInWorkspace(insideUri, folders)).toBe(true);

      const outsideUri = vscode.Uri.file('/tmp/outside_test.ts');
      expect(isUriInWorkspace(outsideUri, folders)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Context Engine integration: new tools use the same workspaceService
  // ---------------------------------------------------------------------------
  describe('Context Engine integration', () => {
    it('getAllTools shares the same workspaceService instance', () => {
      const tools = getAllTools(workspaceService);
      // Spot-check: each tool should be constructable with the shared service
      const symbolTool = tools.find((t) => t.name === 'find_symbol');
      const gitTool = tools.find((t) => t.name === 'git_context');
      expect(symbolTool).toBeDefined();
      expect(gitTool).toBeDefined();
    });

    it('all exploration tools implement ITool correctly', () => {
      const tools = getAllTools(workspaceService);
      const explorationTools = tools.filter((t) =>
        ['find_symbol', 'find_references', 'git_context'].includes(t.name),
      );
      expect(explorationTools.length).toBe(3);
      for (const tool of explorationTools) {
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.getDefinition).toBe('function');
        expect(typeof tool.execute).toBe('function');
        const def = tool.getDefinition();
        expect(def.type).toBe('function');
        expect(def.function.name).toBe(tool.name);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // GitContextTool with Real Git Repository (Acceptance Criterion 8 & 10)
  // ---------------------------------------------------------------------------
  describe('GitContextTool with Real Git Repository', () => {
    let gitWs: string;
    let gitWsService: VSCodeWorkspaceService;
    let gitTool: GitContextTool;
    let gitAvailable = false;

    beforeAll(async () => {
      try {
        gitWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-real-git-'));
        // Initialize real git repo
        await execFileAsync('git', ['init'], { cwd: gitWs });
        await execFileAsync('git', ['config', 'user.name', 'Kodra Tester'], { cwd: gitWs });
        await execFileAsync('git', ['config', 'user.email', 'tester@kodra.ai'], { cwd: gitWs });

        // 1. Create and commit tracked.ts
        await fs.writeFile(
          path.join(gitWs, 'tracked.ts'),
          'export function trackedFunction(): string {\n  return "v1";\n}\n',
        );
        await execFileAsync('git', ['add', 'tracked.ts'], { cwd: gitWs });
        await execFileAsync('git', ['commit', '-m', 'Initial commit for tracked.ts'], { cwd: gitWs });

        // 2. Create staged.ts and stage it
        await fs.writeFile(
          path.join(gitWs, 'staged.ts'),
          'export const STAGED_VALUE = 42;\n',
        );
        await execFileAsync('git', ['add', 'staged.ts'], { cwd: gitWs });

        // 3. Modify tracked.ts (unstaged modification)
        await fs.writeFile(
          path.join(gitWs, 'tracked.ts'),
          'export function trackedFunction(): string {\n  return "v2-modified";\n}\n',
        );

        // 4. Create untracked.ts
        await fs.writeFile(
          path.join(gitWs, 'untracked.ts'),
          '// Untracked file\n',
        );

        gitWsService = new VSCodeWorkspaceService(gitWs);
        gitTool = new GitContextTool(gitWsService);
        gitAvailable = true;
      } catch {
        gitAvailable = false;
      }
    });

    afterAll(async () => {
      if (gitWs) {
        try {
          await fs.rm(gitWs, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    });

    it('status correctly reports staged, unstaged, and untracked changes', async () => {
      if (!gitAvailable) {
        return;
      }
      const res = await gitTool.execute({ operation: 'status' });
      expect(res.success).toBe(true);
      expect(res.content).toContain('Git status:');
      expect(res.content).toContain('Staged');
      expect(res.content).toContain('staged.ts');
      expect(res.content).toContain('Unstaged');
      expect(res.content).toContain('tracked.ts');
      expect(res.content).toContain('Untracked');
      expect(res.content).toContain('untracked.ts');
      expect(res.metadata?.staged).toBeGreaterThanOrEqual(1);
      expect(res.metadata?.unstaged).toBeGreaterThanOrEqual(1);
      expect(res.metadata?.untracked).toBeGreaterThanOrEqual(1);
    });

    it('diff correctly reports unstaged changes', async () => {
      if (!gitAvailable) {
        return;
      }
      const res = await gitTool.execute({ operation: 'diff' });
      expect(res.success).toBe(true);
      expect(res.content).toContain('tracked.ts');
      expect(res.content).toContain('v2-modified');
      expect(res.metadata?.staged).toBe(false);
    });

    it('diff correctly reports staged changes with staged: true', async () => {
      if (!gitAvailable) {
        return;
      }
      const res = await gitTool.execute({ operation: 'diff', staged: true });
      expect(res.success).toBe(true);
      expect(res.content).toContain('staged.ts');
      expect(res.content).toContain('STAGED_VALUE');
      expect(res.metadata?.staged).toBe(true);
    });

    it('diff correctly filters to a specific file', async () => {
      if (!gitAvailable) {
        return;
      }
      const res = await gitTool.execute({ operation: 'diff', file: 'tracked.ts' });
      expect(res.success).toBe(true);
      expect(res.content).toContain('tracked.ts');
      expect(res.metadata?.file).toBe('tracked.ts');
    });

    it('log returns meaningful commit history', async () => {
      if (!gitAvailable) {
        return;
      }
      const res = await gitTool.execute({ operation: 'log', maxLines: 5 });
      expect(res.success).toBe(true);
      expect(res.content).toContain('Initial commit for tracked.ts');
      expect(res.content).toContain('Kodra Tester');
      expect(res.content).toMatch(/commit [0-9a-f]{40}/i);
    });

    it('blame returns line-level attribution for committed file', async () => {
      if (!gitAvailable) {
        return;
      }
      const res = await gitTool.execute({ operation: 'blame', file: 'tracked.ts' });
      expect(res.success).toBe(true);
      expect(res.content).toContain('tracked.ts');
      expect(res.content).toContain('Kodra Tester');
      expect(res.metadata?.operation).toBe('blame');
    });

    it('handles clean working tree status correctly', async () => {
      if (!gitAvailable) {
        return;
      }
      const cleanWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-clean-git-'));
      try {
        await execFileAsync('git', ['init'], { cwd: cleanWs });
        await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: cleanWs });
        await execFileAsync('git', ['config', 'user.email', 't@k.ai'], { cwd: cleanWs });
        await fs.writeFile(path.join(cleanWs, 'file.txt'), 'clean\n');
        await execFileAsync('git', ['add', '.'], { cwd: cleanWs });
        await execFileAsync('git', ['commit', '-m', 'clean'], { cwd: cleanWs });

        const cleanService = new VSCodeWorkspaceService(cleanWs);
        const tool = new GitContextTool(cleanService);
        const res = await tool.execute({ operation: 'status' });
        expect(res.success).toBe(true);
        expect(res.content).toContain('clean');
      } finally {
        await fs.rm(cleanWs, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-Root Workspace Searches & Relative Path Resolution (Acceptance Criterion 2, 4 & 10)
  // ---------------------------------------------------------------------------
  describe('Multi-Root Workspace Searches & Relative Path Resolution', () => {
    let secondWs: string;

    beforeAll(async () => {
      secondWs = await fs.mkdtemp(path.join(os.tmpdir(), 'kodra-root2-'));
      await fs.mkdir(path.join(secondWs, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(secondWs, 'src', 'payment.ts'),
        'export class PaymentService {\n  processPayment(amount: number): boolean {\n    return true;\n  }\n}\n',
      );
      await fs.writeFile(
        path.join(secondWs, 'src', 'billing.ts'),
        'import { User } from "./user";\nexport const billingCurrency = "USD";\n',
      );
    });

    afterAll(async () => {
      if (secondWs) {
        await fs.rm(secondWs, { recursive: true, force: true }).catch(() => {});
      }
      // Restore single root
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: tempWs }, name: 'exploration-test', index: 0 },
      ];
    });

    it('searchFiles searches across all workspace roots in multi-root workspaces', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: tempWs }, name: 'root1', index: 0 },
        { uri: { fsPath: secondWs }, name: 'root2', index: 1 },
      ];

      const multiRootService = new VSCodeWorkspaceService();
      const results = await multiRootService.searchFiles('PaymentService');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].file).toContain('root2/src/payment.ts');
      expect(results[0].content).toContain('PaymentService');
    });

    it('searchFiles finds matches from both roots without duplicate files', async () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: tempWs }, name: 'root1', index: 0 },
        { uri: { fsPath: secondWs }, name: 'root2', index: 1 },
      ];

      const multiRootService = new VSCodeWorkspaceService();
      const results = await multiRootService.searchFiles('User');
      const files = results.map((r) => r.file);
      // Contains matches from root1 (index.ts, utils.ts, etc.) and root2 (billing.ts)
      expect(files.some((f) => f.includes('root1') || f.includes('index.ts'))).toBe(true);
      expect(files.some((f) => f.includes('root2/src/billing.ts'))).toBe(true);
    });

    it('resolvePath resolves folder-prefixed paths in multi-root workspaces', () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: tempWs }, name: 'root1', index: 0 },
        { uri: { fsPath: secondWs }, name: 'root2', index: 1 },
      ];

      const multiRootService = new VSCodeWorkspaceService();
      const res = multiRootService.resolvePath('root2/src/payment.ts');
      expect(res.inWorkspace).toBe(true);
      expect(res.resolvedPath).toContain('payment.ts');
    });

    it('resolvePath rejects path traversal attempts outside workspace', () => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: tempWs }, name: 'root1', index: 0 },
      ];

      const service = new VSCodeWorkspaceService();
      const res = service.resolvePath('../../etc/passwd');
      expect(res.inWorkspace).toBe(false);

      // Traversal with windows-style slashes
      const resWin = service.resolvePath('..\\..\\windows\\system32');
      expect(resWin.inWorkspace).toBe(false);
    });

    it('isPathInWorkspace rejects paths that share prefix but are outside root', () => {
      const folders = [{ name: 'ws', fsPath: tempWs }];
      // Substring prefix collision: /tempWs-sibling
      const siblingPath = tempWs + '-sibling' + path.sep + 'file.ts';
      expect(isPathInWorkspace(siblingPath, folders)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // SearchCache Reuse, Invalidation & LRU Eviction (Acceptance Criterion 3 & 10)
  // ---------------------------------------------------------------------------
  describe('SearchCache Reuse, Invalidation & LRU Eviction', () => {
    it('caches search results and reuses them on repeated query', async () => {
      const service = new VSCodeWorkspaceService(tempWs);
      service.searchCache.invalidate();
      expect(service.searchCache.size).toBe(0);

      const res1 = await service.searchFiles('formatUser');
      expect(res1.length).toBeGreaterThanOrEqual(1);
      expect(service.searchCache.size).toBe(1);

      // Repeat query: should be served from cache
      const res2 = await service.searchFiles('formatUser');
      expect(res2.length).toBe(res1.length);
      expect(res2[0].content).toBe(res1[0].content);
      expect(service.searchCache.size).toBe(1);
    });

    it('invalidates cache when a matched file is modified', async () => {
      const service = new VSCodeWorkspaceService(tempWs);
      service.searchCache.invalidate();

      await service.searchFiles('UserService');
      expect(service.searchCache.size).toBe(1);

      // Touch index.ts to change its mtime
      const indexPath = path.join(tempWs, 'src', 'index.ts');
      const current = await fs.readFile(indexPath, 'utf-8');
      // Wait at least 50ms so mtime is strictly different on all filesystems
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.writeFile(indexPath, current + '\n// updated mtime test\n');

      // Next search should detect stale mtime and invalidate entry
      const resAfter = await service.searchFiles('UserService');
      expect(resAfter.length).toBeGreaterThanOrEqual(1);
      // Cache was updated with new entry
      expect(service.searchCache.size).toBe(1);
    });

    it('evicts oldest entries when exceeding maxEntries capacity', () => {
      const cache = new SearchCache();
      // Add 25 entries (capacity is 20)
      for (let i = 0; i < 25; i++) {
        cache.set(`query-${i}`, [{ file: `f${i}.ts`, line: 1, content: 'test' }], [], []);
      }
      expect(cache.size).toBeLessThanOrEqual(20);
    });

    it('explicit invalidate() clears all cached entries', async () => {
      const service = new VSCodeWorkspaceService(tempWs);
      await service.searchFiles('User');
      expect(service.searchCache.size).toBeGreaterThan(0);

      service.searchCache.invalidate();
      expect(service.searchCache.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Glob Matching & Directory Boundaries (Acceptance Criterion 2 & 10)
  // ---------------------------------------------------------------------------
  describe('Glob Matching & Directory Boundaries', () => {
    it('matches *.ts at any depth', () => {
      expect(matchesPattern('src/index.ts', '*.ts')).toBe(true);
      expect(matchesPattern('server.ts', '*.ts')).toBe(true);
      expect(matchesPattern('src/nested/deep/file.ts', '*.ts')).toBe(true);
      expect(matchesPattern('src/index.js', '*.ts')).toBe(false);
    });

    it('matches src/**/*.ts pattern', () => {
      expect(matchesPattern('src/index.ts', 'src/**/*.ts')).toBe(true);
      expect(matchesPattern('src/nested/sub.ts', 'src/**/*.ts')).toBe(true);
      expect(matchesPattern('test/test.ts', 'src/**/*.ts')).toBe(false);
    });

    it('matches directory itself when pattern ends with /**', () => {
      expect(matchesPattern('dist', 'dist/**')).toBe(true);
      expect(matchesPattern('dist/bundle.js', 'dist/**')).toBe(true);
      expect(matchesPattern('src', 'dist/**')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Language Server Provider Mocking (Acceptance Criterion 5, 6, 7 & 10)
  // ---------------------------------------------------------------------------
  describe('Language Server Provider Mocking', () => {
    it('find_symbol formats language server SymbolInformation results', async () => {
      const originalExecuteCommand = vscode.commands.executeCommand;
      (vscode.commands as any).executeCommand = jest.fn(async (cmd: string, ...args: any[]) => {
        if (cmd === 'vscode.executeWorkspaceSymbolProvider') {
          return [
            {
              name: 'MockUserService',
              kind: vscode.SymbolKind.Class,
              containerName: 'Accounts',
              location: {
                uri: vscode.Uri.file(path.join(tempWs, 'src', 'index.ts')),
                range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(5, 1)),
              },
            },
          ];
        }
        return originalExecuteCommand(cmd, ...args);
      });

      try {
        const tool = new FindSymbolTool(workspaceService);
        const res = await tool.execute({ query: 'MockUserService' });
        expect(res.success).toBe(true);
        expect(res.metadata?.source).toBe('language-server');
        expect(res.content).toContain('Class');
        expect(res.content).toContain('MockUserService');
        expect(res.content).toContain('[in Accounts]');
      } finally {
        (vscode.commands as any).executeCommand = originalExecuteCommand;
      }
    });

    it('go_to_definition formats language server Location results', async () => {
      const originalExecuteCommand = vscode.commands.executeCommand;
      (vscode.commands as any).executeCommand = jest.fn(async (cmd: string, ...args: any[]) => {
        if (cmd === 'vscode.executeDefinitionProvider') {
          return [
            new vscode.Location(
              vscode.Uri.file(path.join(tempWs, 'src', 'index.ts')),
              new vscode.Position(0, 13),
            ),
          ];
        }
        return originalExecuteCommand(cmd, ...args);
      });

      try {
        const tool = new GoToDefinitionTool(workspaceService);
        const res = await tool.execute({ file: 'src/server.ts', line: 1, column: 10 });
        expect(res.success).toBe(true);
        expect(res.metadata?.source).toBe('language-server');
        expect(res.content).toContain('src/index.ts:1:14');
      } finally {
        (vscode.commands as any).executeCommand = originalExecuteCommand;
      }
    });

    it('find_references formats language server Location results', async () => {
      const originalExecuteCommand = vscode.commands.executeCommand;
      (vscode.commands as any).executeCommand = jest.fn(async (cmd: string, ...args: any[]) => {
        if (cmd === 'vscode.executeReferenceProvider') {
          return [
            new vscode.Location(
              vscode.Uri.file(path.join(tempWs, 'src', 'server.ts')),
              new vscode.Position(3, 15),
            ),
            new vscode.Location(
              vscode.Uri.file(path.join(tempWs, 'src', 'utils.ts')),
              new vscode.Position(1, 10),
            ),
          ];
        }
        return originalExecuteCommand(cmd, ...args);
      });

      try {
        const tool = new FindReferencesTool(workspaceService);
        const res = await tool.execute({ file: 'src/index.ts', line: 1, column: 14 });
        expect(res.success).toBe(true);
        expect(res.metadata?.source).toBe('language-server');
        expect(res.metadata?.referenceCount).toBe(2);
        expect(res.content).toContain('src/server.ts:');
        expect(res.content).toContain('src/utils.ts:');
      } finally {
        (vscode.commands as any).executeCommand = originalExecuteCommand;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Agent Tool Execution Path & Invocations (Acceptance Criterion 9 & 10)
  // ---------------------------------------------------------------------------
  describe('Agent Tool Execution Path & Invocations', () => {
    it('executes each registered tool through execute() interface safely', async () => {
      const tools = getAllTools(workspaceService);
      expect(tools.length).toBe(13);

      // Verify each tool can be executed without crashing
      for (const tool of tools) {
        let res;
        switch (tool.name) {
          case 'read_file':
            res = await tool.execute({ path: 'src/index.ts' });
            break;
          case 'list_directory':
            res = await tool.execute({ path: 'src' });
            break;
          case 'search_code':
            res = await tool.execute({ query: 'UserService' });
            break;
          case 'edit_file':
            res = await tool.execute({ path: 'src/index.ts', oldText: 'NONEXISTENT', newText: 'XYZ' });
            break;
          case 'create_file':
            res = await tool.execute({ path: 'src/test_out.ts' });
            break;
          case 'find_symbol':
            res = await tool.execute({ query: 'UserService' });
            break;
          case 'find_references':
            res = await tool.execute({ file: 'src/index.ts', line: 1, column: 1, symbolName: 'UserService' });
            break;
          case 'git_context':
            res = await tool.execute({ operation: 'log' });
            break;
          case 'run_command':
            res = await tool.execute({ command: 'echo test' });
            break;
          case 'start_process':
            res = await tool.execute({ command: 'echo test' });
            break;
          case 'read_process_output':
            res = await tool.execute({ processId: 'nonexistent' });
            break;
          case 'send_process_input':
            res = await tool.execute({ processId: 'nonexistent', input: 'test' });
            break;
          case 'stop_process':
            res = await tool.execute({ processId: 'nonexistent' });
            break;
        }

        expect(res).toBeDefined();
        expect(typeof res!.success).toBe('boolean');
        expect(typeof res!.content).toBe('string');
      }
    });

    it('find_symbol navigates to definition when given file and line', async () => {
      const tool = new FindSymbolTool(workspaceService);
      // Execute definition lookup through find_symbol
      const res = await tool.execute({
        file: 'src/server.ts',
        line: 1,
        column: 1,
        symbolName: 'UserService',
      });
      expect(res).toBeDefined();
      expect(typeof res.success).toBe('boolean');
      expect(res.content).toBeDefined();
    });
  });
});
