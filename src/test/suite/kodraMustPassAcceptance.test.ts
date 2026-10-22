/**
 * KODRA MUST-PASS ACCEPTANCE TESTS
 *
 * DO NOT MODIFY THIS TEST FILE.
 * These tests define required behavior, not current implementation behavior.
 * If a test fails, fix the production code; do not weaken, skip, delete, or
 * rewrite the assertion to make the suite pass.
 *
 * Keep this suite independent from mocks of filesystem behavior: it uses real
 * temporary directories and real symlinks/junctions where supported.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { VSCodeWorkspaceService } from '../../agent/workspaceService';

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function makeDirectoryLink(target: string, linkPath: string): Promise<void> {
  // Windows requires a junction for directory links; POSIX uses a directory symlink.
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    await fs.symlink(target, linkPath, type);
  } catch (error) {
    throw new Error(
      `Cannot create required symlink/junction; this acceptance test is BLOCKED, not passed. ${String(error)}`,
    );
  }
}

describe('KODRA Must-Pass Acceptance — Workspace Boundary Enforcement', () => {
  let workspaceRoot: string;
  let outsideRoot: string;
  let service: VSCodeWorkspaceService;

  beforeEach(async () => {
    workspaceRoot = await makeTempDir('kodra-accept-workspace-');
    outsideRoot = await makeTempDir('kodra-accept-outside-');
    await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'OUTSIDE_SECRET_SENTINEL');
    service = new VSCodeWorkspaceService(workspaceRoot);
    await makeDirectoryLink(outsideRoot, path.join(workspaceRoot, 'external'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  });

  it('must deny read_file access through a symlink that points outside the workspace', async () => {
    await expect(service.readFile('external/secret.txt')).rejects.toThrow(/access denied|outside.*workspace|outside.*root/i);
  });

  it('must deny stat access through a symlink that points outside the workspace', async () => {
    await expect(service.stat('external/secret.txt')).rejects.toThrow(/access denied|outside.*workspace|outside.*root/i);
  });

  it('must deny directory listing through a symlink that points outside the workspace', async () => {
    await expect(service.readDirectory('external')).rejects.toThrow(/access denied|outside.*workspace|outside.*root/i);
  });

  it('must deny write_file through a symlink and leave the outside file unchanged', async () => {
    const outsideFile = path.join(outsideRoot, 'secret.txt');
    await expect(
      service.writeFile('external/secret.txt', 'MUST_NOT_OVERWRITE_OUTSIDE_FILE'),
    ).rejects.toThrow(/access denied|outside.*workspace|outside.*root/i);
    await expect(fs.readFile(outsideFile, 'utf8')).resolves.toBe('OUTSIDE_SECRET_SENTINEL');
  });

  it('must deny create_file through a symlink and never create a file outside the workspace', async () => {
    const outsideFile = path.join(outsideRoot, 'new-secret.txt');
    await expect(
      service.createFile('external/new-secret.txt', 'MUST_NOT_CREATE_OUTSIDE_FILE'),
    ).rejects.toThrow(/access denied|outside.*workspace|outside.*root/i);
    await expect(fs.access(outsideFile)).rejects.toThrow();
  });

  it('must not return files reached by traversing an external directory symlink', async () => {
    const found = await service.findFiles('**/*.txt', { maxResults: 100 });
    expect(found).not.toContain('external/secret.txt');
    expect(found.some((file) => file.replace(/\\/g, '/').endsWith('/secret.txt'))).toBe(false);
  });

  it('must not expose outside-file content through search_code when reached by a symlink', async () => {
    const matches = await service.searchFiles('OUTSIDE_SECRET_SENTINEL', { maxResults: 100 });
    expect(matches).toEqual([]);
  });
});
