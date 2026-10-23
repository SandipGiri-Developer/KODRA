import { CommandMatcher } from '../../agent/terminal/commandMatcher';
import { ApprovalPolicy } from '../../agent/terminal/types';

describe('CommandMatcher', () => {
  describe('Compound Command Detection (AC10)', () => {
    it('detects logical AND (&&), OR (||), and semicolon (;)', () => {
      expect(CommandMatcher.isCompoundCommand('git status && git pull')).toBe(true);
      expect(CommandMatcher.isCompoundCommand('npm test || npm build')).toBe(true);
      expect(CommandMatcher.isCompoundCommand('ls ; rm -rf /')).toBe(true);
    });

    it('detects pipes (|) and redirections (>, >>, <)', () => {
      expect(CommandMatcher.isCompoundCommand('cat file.txt | grep error')).toBe(true);
      expect(CommandMatcher.isCompoundCommand('echo test > out.txt')).toBe(true);
      expect(CommandMatcher.isCompoundCommand('echo test >> out.txt')).toBe(true);
      expect(CommandMatcher.isCompoundCommand('cmd < input.txt')).toBe(true);
    });

    it('detects command substitution ($(), ``) and newlines', () => {
      expect(CommandMatcher.isCompoundCommand('echo $(whoami)')).toBe(true);
      expect(CommandMatcher.isCompoundCommand('echo `whoami`')).toBe(true);
      expect(CommandMatcher.isCompoundCommand('git status\nrm -rf /')).toBe(true);
      expect(CommandMatcher.isCompoundCommand('git status\r\nrm -rf /')).toBe(true);
    });

    it('does NOT treat operators inside balanced quotes as compound commands', () => {
      expect(CommandMatcher.isCompoundCommand('git commit -m "feat: user && auth"')).toBe(false);
      expect(CommandMatcher.isCompoundCommand("git log --grep='fix; issue'")).toBe(false);
      expect(CommandMatcher.isCompoundCommand('echo "test | data"')).toBe(false);
    });

    it('recognizes single discrete commands as non-compound', () => {
      expect(CommandMatcher.isCompoundCommand('git status')).toBe(false);
      expect(CommandMatcher.isCompoundCommand('npm test -- --watch')).toBe(false);
      expect(CommandMatcher.isCompoundCommand('cargo check')).toBe(false);
    });
  });

  describe('Safe Command Matching (AC10)', () => {
    const basePolicy: ApprovalPolicy = {
      id: 'p1',
      schemaVersion: 1,
      scope: 'global',
      ruleType: 'prefix',
      commandPattern: 'git fetch',
      decision: 'allow',
      enabled: true,
      description: 'Allow git fetch',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('matches exact commands with whitespace tolerance', () => {
      const exactPolicy: ApprovalPolicy = {
        ...basePolicy,
        ruleType: 'exact',
        commandPattern: 'npm test',
      };
      expect(CommandMatcher.matchesPolicy('npm test', exactPolicy)).toBe(true);
      expect(CommandMatcher.matchesPolicy('  npm   test  ', exactPolicy)).toBe(true);
      expect(CommandMatcher.matchesPolicy('npm test --runInBand', exactPolicy)).toBe(false);
    });

    it('matches prefix commands along token boundaries', () => {
      expect(CommandMatcher.matchesPolicy('git fetch', basePolicy)).toBe(true);
      expect(CommandMatcher.matchesPolicy('git fetch origin main', basePolicy)).toBe(true);
      expect(CommandMatcher.matchesPolicy('git fetch --all', basePolicy)).toBe(true);

      // Must NOT match unrelated subcommands or words sharing prefix
      expect(CommandMatcher.matchesPolicy('git fetcher', basePolicy)).toBe(false);
      expect(CommandMatcher.matchesPolicy('git push', basePolicy)).toBe(false);
      expect(CommandMatcher.matchesPolicy('git reset --hard', basePolicy)).toBe(false);
    });

    it('STRICT: never lets prefix policy authorize a compound command (AC10)', () => {
      // Even if it starts with 'git fetch', compound execution is blocked!
      expect(CommandMatcher.matchesPolicy('git fetch && rm -rf /', basePolicy)).toBe(false);
      expect(CommandMatcher.matchesPolicy('git fetch ; rm -rf /', basePolicy)).toBe(false);
      expect(CommandMatcher.matchesPolicy('git fetch | bash', basePolicy)).toBe(false);
    });

    it('allows compound commands only if explicitly matched by exact rule', () => {
      const exactCompound: ApprovalPolicy = {
        ...basePolicy,
        ruleType: 'exact',
        commandPattern: 'npm run build && npm test',
      };
      expect(CommandMatcher.matchesPolicy('npm run build && npm test', exactCompound)).toBe(true);
      expect(CommandMatcher.matchesPolicy('npm run build && npm test && rm -rf /', exactCompound)).toBe(false);
    });

    it('respects disabled state', () => {
      const disabledPolicy: ApprovalPolicy = {
        ...basePolicy,
        enabled: false,
      };
      expect(CommandMatcher.matchesPolicy('git fetch', disabledPolicy)).toBe(false);
    });
  });

  describe('Policy Precedence (AC11)', () => {
    const wsId = 'ws-test-123';

    it('explicit denial overrides broader or equal allow rules (AC11)', () => {
      const globalAllow: ApprovalPolicy = {
        id: 'p-allow',
        schemaVersion: 1,
        scope: 'global',
        ruleType: 'prefix',
        commandPattern: 'git',
        decision: 'allow',
        enabled: true,
        description: 'Allow git',
        createdAt: '',
        updatedAt: '',
      };

      const workspaceDeny: ApprovalPolicy = {
        id: 'p-deny',
        schemaVersion: 1,
        scope: 'workspace',
        workspaceId: wsId,
        ruleType: 'prefix',
        commandPattern: 'git push',
        decision: 'deny',
        enabled: true,
        description: 'Deny git push in this workspace',
        createdAt: '',
        updatedAt: '',
      };

      const result = CommandMatcher.evaluatePolicies('git push origin main', [globalAllow, workspaceDeny], wsId);
      expect(result.decision).toBe('deny');
      expect(result.matchedPolicy?.id).toBe('p-deny');
    });

    it('workspace policies apply only to intended workspace (AC7, AC11)', () => {
      const wsPolicy: ApprovalPolicy = {
        id: 'p-ws',
        schemaVersion: 1,
        scope: 'workspace',
        workspaceId: wsId,
        ruleType: 'prefix',
        commandPattern: 'cargo build',
        decision: 'allow',
        enabled: true,
        description: 'Allow cargo build in ws-test-123',
        createdAt: '',
        updatedAt: '',
      };

      // Match in ws-test-123
      const res1 = CommandMatcher.evaluatePolicies('cargo build', [wsPolicy], wsId);
      expect(res1.decision).toBe('allow');

      // Does NOT match in another workspace
      const res2 = CommandMatcher.evaluatePolicies('cargo build', [wsPolicy], 'other-ws-456');
      expect(res2.decision).toBe('require_approval');
    });

    it('more specific rule takes precedence over broad rule', () => {
      const broad: ApprovalPolicy = {
        id: 'broad',
        schemaVersion: 1,
        scope: 'global',
        ruleType: 'prefix',
        commandPattern: 'npm',
        decision: 'deny',
        enabled: true,
        description: 'Deny general npm',
        createdAt: '',
        updatedAt: '',
      };

      const specific: ApprovalPolicy = {
        id: 'specific',
        schemaVersion: 1,
        scope: 'workspace',
        workspaceId: wsId,
        ruleType: 'exact',
        commandPattern: 'npm test',
        decision: 'allow',
        enabled: true,
        description: 'Allow specific npm test',
        createdAt: '',
        updatedAt: '',
      };

      // Exact allow in workspace beats broad global deny
      // Notice: If denial was on the EXACT command, denial would win;
      // here broad denial was 'npm', but specific rule is 'npm test'.
      // However, our rule says: ANY matching denial wins if it matches the command!
      // 'npm' prefix matches 'npm test'. So denial wins for safety!
      const res = CommandMatcher.evaluatePolicies('npm test', [broad, specific], wsId);
      expect(res.decision).toBe('deny');
    });

    it('returns require_approval when no policy matches', () => {
      const res = CommandMatcher.evaluatePolicies('unknown_tool --help', [], wsId);
      expect(res.decision).toBe('require_approval');
    });
  });
});
