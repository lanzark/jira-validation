const validate = require('./validate');

function makeMocks({
  jiraKeys = 'DOKTUZ',
  skipBranch = 'false',
  skipCommit = 'false',
  skipPrTitle = 'false',
  branch = 'feature/DOKTUZ-123-add-login',
  prTitle = 'DOKTUZ-123: Add login',
  commits = [{ sha: 'abc1234567', commit: { message: 'DOKTUZ-123 add login' } }],
  pullNumber = 42,
} = {}) {
  process.env.JIRA_KEYS = jiraKeys;
  process.env.SKIP_BRANCH_CHECK = skipBranch;
  process.env.SKIP_COMMIT_CHECK = skipCommit;
  process.env.SKIP_PR_TITLE_CHECK = skipPrTitle;
  process.env.GITHUB_SERVER_URL = 'https://github.com';
  process.env.GITHUB_RUN_ID = '12345';

  const core = {
    info: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    setFailed: jest.fn(),
    summary: { addRaw: jest.fn().mockReturnThis(), write: jest.fn() },
  };

  const context = {
    payload: {
      pull_request: {
        number: pullNumber,
        title: prTitle,
        head: { ref: branch, sha: 'abc123def456' },
      },
    },
    repo: { owner: 'lanzark', repo: 'my-repo' },
  };

  const github = {
    paginate: jest.fn().mockResolvedValue(commits),
    rest: {
      pulls: { listCommits: jest.fn() },
      checks: { create: jest.fn().mockResolvedValue({}) },
    },
  };

  return { core, context, github };
}

afterEach(() => {
  delete process.env.JIRA_KEYS;
  delete process.env.SKIP_BRANCH_CHECK;
  delete process.env.SKIP_COMMIT_CHECK;
  delete process.env.SKIP_PR_TITLE_CHECK;
  delete process.env.GITHUB_SERVER_URL;
  delete process.env.GITHUB_RUN_ID;
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('input validation', () => {
  test('fails when jira-keys is empty', async () => {
    const { core, context, github } = makeMocks({ jiraKeys: '' });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('jira-keys')
    );
  });

  test('fails when jira-keys is whitespace only', async () => {
    const { core, context, github } = makeMocks({ jiraKeys: '   ' });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('jira-keys')
    );
  });

  test('fails when jira-keys is commas only', async () => {
    const { core, context, github } = makeMocks({ jiraKeys: ',,,' });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('at least one')
    );
  });

  test('fails when not a pull_request event', async () => {
    const { core, github } = makeMocks();
    const context = { payload: {}, repo: { owner: 'o', repo: 'r' } };
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('pull_request')
    );
  });

  test('fails when JIRA_KEYS env var is undefined', async () => {
    const { core, context, github } = makeMocks();
    delete process.env.JIRA_KEYS;
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('jira-keys')
    );
  });

  test('handles single key with trailing comma', async () => {
    const { core, context, github } = makeMocks({
      jiraKeys: 'DOKTUZ,',
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Regex pattern matching
// ---------------------------------------------------------------------------

describe('regex pattern', () => {
  test('matches standard ticket at start of string', async () => {
    const { core, context, github } = makeMocks({
      branch: 'DOKTUZ-100',
      prTitle: 'DOKTUZ-100 title',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-100 work' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('matches ticket after slash in branch name', async () => {
    const { core, context, github } = makeMocks({
      branch: 'feature/DOKTUZ-999-thing',
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('matches ticket with underscore separator in branch', async () => {
    const { core, context, github } = makeMocks({
      branch: 'feature/DOKTUZ-55_my_feature',
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('matches ticket in brackets', async () => {
    const { core, context, github } = makeMocks({
      prTitle: '[DOKTUZ-1] Fix bug',
      commits: [{ sha: 'a'.repeat(40), commit: { message: '[DOKTUZ-1] Fix' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('is case insensitive', async () => {
    const { core, context, github } = makeMocks({
      branch: 'feature/doktuz-123-fix',
      prTitle: 'Doktuz-123: Fix',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'doktuz-123 fix' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('rejects key embedded in a longer word', async () => {
    const { core, context, github } = makeMocks({
      branch: 'feature/NOTDOKTUZ-123',
      prTitle: 'DOKTUZ-1 ok',
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining('Branch check: FAILED')
    );
  });

  test('rejects key preceded by digits', async () => {
    const { core, context, github } = makeMocks({
      branch: '2DOKTUZ-123',
      prTitle: 'DOKTUZ-1 ok',
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
  });

  test('rejects string without any ticket reference', async () => {
    const { core, context, github } = makeMocks({
      branch: 'feature/add-login',
      prTitle: 'DOKTUZ-1 ok',
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
  });

  test('rejects key without a number', async () => {
    const { core, context, github } = makeMocks({
      prTitle: 'DOKTUZ- no number',
      branch: 'DOKTUZ-1',
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining('PR title check: FAILED')
    );
  });

  test('matches ticket with multiple path segments in branch', async () => {
    const { core, context, github } = makeMocks({
      branch: 'feature/team/DOKTUZ-123-thing',
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('matches ticket preceded by underscore', async () => {
    const { core, context, github } = makeMocks({
      branch: '_DOKTUZ-123',
      prTitle: '_DOKTUZ-123 title',
      commits: [{ sha: 'a'.repeat(40), commit: { message: '_DOKTUZ-123 work' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('matches ticket in parentheses', async () => {
    const { core, context, github } = makeMocks({
      prTitle: 'Fix bug (DOKTUZ-456)',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'Fix bug (DOKTUZ-456)' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('matches ticket after colon', async () => {
    const { core, context, github } = makeMocks({
      prTitle: 'fix: DOKTUZ-789 auth flow',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'fix: DOKTUZ-789 auth flow' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('matches large ticket number', async () => {
    const { core, context, github } = makeMocks({
      branch: 'feature/DOKTUZ-99999',
      prTitle: 'DOKTUZ-99999: big project',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-99999 work' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Multiple JIRA keys
// ---------------------------------------------------------------------------

describe('multiple jira keys', () => {
  test('accepts any of the configured keys', async () => {
    const { core, context, github } = makeMocks({
      jiraKeys: 'DOKTUZ,PROJ,TEAM',
      branch: 'feature/PROJ-42-thing',
      prTitle: 'TEAM-7: Update',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-1 init' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('handles whitespace around keys', async () => {
    const { core, context, github } = makeMocks({
      jiraKeys: ' DOKTUZ , PROJ ',
      branch: 'feature/PROJ-10',
      prTitle: 'DOKTUZ-5: thing',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'PROJ-10 fix' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('rejects ticket from a key not in the list', async () => {
    const { core, context, github } = makeMocks({
      jiraKeys: 'DOKTUZ,PROJ',
      branch: 'feature/OTHER-123',
      prTitle: 'DOKTUZ-1 ok',
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
  });

  test('case insensitivity works across multiple keys', async () => {
    const { core, context, github } = makeMocks({
      jiraKeys: 'DOKTUZ,PROJ',
      branch: 'feature/proj-42-thing',
      prTitle: 'doktuz-7: Update',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'Proj-1 init' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Special characters in keys (regex escaping)
// ---------------------------------------------------------------------------

describe('regex escaping', () => {
  test('keys with special regex characters do not crash', async () => {
    const { core, context, github } = makeMocks({
      jiraKeys: 'DO.KT',
      branch: 'feature/DO.KT-123',
      prTitle: 'DO.KT-123 title',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'DO.KT-123 work' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('escaped dot does not match arbitrary character', async () => {
    const { core, context, github } = makeMocks({
      jiraKeys: 'DO.KT',
      branch: 'feature/DOXKT-123',
      prTitle: 'DO.KT-1 ok',
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Commit message checks
// ---------------------------------------------------------------------------

describe('commit messages', () => {
  test('all valid commits pass', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-1 first' } },
        { sha: 'b'.repeat(40), commit: { message: 'DOKTUZ-2 second' } },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('one bad commit among good ones fails', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-1 good' } },
        { sha: 'b'.repeat(40), commit: { message: 'fix typo' } },
        { sha: 'c'.repeat(40), commit: { message: 'DOKTUZ-3 also good' } },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining('1 of 3')
    );
  });

  test('only checks first line of multi-line commit message', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        {
          sha: 'a'.repeat(40),
          commit: { message: 'DOKTUZ-1 summary\n\nBody without ticket ref' },
        },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('merge commits are skipped', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-1 real work' } },
        { sha: 'b'.repeat(40), commit: { message: 'Merge branch \'main\' into feature' } },
        { sha: 'c'.repeat(40), commit: { message: 'Merge pull request #10 from org/branch' } },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('skipped 2 merge commit(s)')
    );
  });

  test('merge commits without real commits still pass', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'Merge branch \'main\'' } },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('revert commits with ticket reference pass', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'Revert "DOKTUZ-99: broken feature"' } },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('revert commits without ticket reference fail', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'Revert "broken feature"' } },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
  });

  test('empty commit list passes', async () => {
    const { core, context, github } = makeMocks({
      commits: [],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  test('ticket ref in commit body but not first line fails', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        {
          sha: 'a'.repeat(40),
          commit: { message: 'fix typo\n\nRelated to DOKTUZ-123' },
        },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Skip flags
// ---------------------------------------------------------------------------

describe('skip flags', () => {
  test('skip-branch-check skips branch validation', async () => {
    const { core, context, github } = makeMocks({
      skipBranch: 'true',
      branch: 'no-ticket-here',
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('Branch check: skipped');
  });

  test('skip-pr-title-check skips PR title validation', async () => {
    const { core, context, github } = makeMocks({
      skipPrTitle: 'true',
      prTitle: 'no ticket here',
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('PR title check: skipped');
  });

  test('skip-commit-check skips commit validation', async () => {
    const { core, context, github } = makeMocks({
      skipCommit: 'true',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'no ticket' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('Commit check: skipped');
  });

  test('all checks skipped passes even with no references', async () => {
    const { core, context, github } = makeMocks({
      skipBranch: 'true',
      skipPrTitle: 'true',
      skipCommit: 'true',
      branch: 'no-ticket',
      prTitle: 'no ticket',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'no ticket' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Markdown summary
// ---------------------------------------------------------------------------

describe('markdown summary', () => {
  test('writes a passing summary', async () => {
    const { core, context, github } = makeMocks();
    await validate({ github, context, core });
    expect(core.summary.addRaw).toHaveBeenCalled();
    expect(core.summary.write).toHaveBeenCalled();

    const md = core.summary.addRaw.mock.calls[0][0];
    expect(md).toContain('JIRA Validation Passed');
  });

  test('writes a failing summary with remediation guide', async () => {
    const { core, context, github } = makeMocks({
      branch: 'bad-branch',
      prTitle: 'bad title',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'bad commit' } }],
    });
    await validate({ github, context, core });

    const md = core.summary.addRaw.mock.calls[0][0];
    expect(md).toContain('JIRA Validation Failed');
    expect(md).toContain('How to Fix Failed Commits');
    expect(md).toContain('How to Fix the Branch Name');
    expect(md).toContain('How to Fix the PR Title');
  });

  test('summary includes commit details table', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        { sha: 'abc1234567', commit: { message: 'DOKTUZ-1 good' } },
        { sha: 'def7654321', commit: { message: 'bad commit' } },
      ],
    });
    await validate({ github, context, core });

    const md = core.summary.addRaw.mock.calls[0][0];
    expect(md).toContain('abc1234');
    expect(md).toContain('def7654');
  });

  test('summary escapes pipe characters in commit messages', async () => {
    const { core, context, github } = makeMocks({
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-1 fix | operator' } },
      ],
    });
    await validate({ github, context, core });

    const md = core.summary.addRaw.mock.calls[0][0];
    expect(md).toContain('fix \\| operator');
  });
});

// ---------------------------------------------------------------------------
// Check run (inline report on PR)
// ---------------------------------------------------------------------------

describe('check run report', () => {
  test('creates a passing check run on success', async () => {
    const { core, context, github } = makeMocks();
    await validate({ github, context, core });

    expect(github.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'lanzark',
        repo: 'my-repo',
        name: 'JIRA Validation Report',
        head_sha: 'abc123def456',
        status: 'completed',
        conclusion: 'success',
        details_url: 'https://github.com/lanzark/my-repo/actions/runs/12345',
        external_id: '12345',
        output: expect.objectContaining({
          title: 'JIRA Validation Passed',
        }),
      })
    );
  });

  test('creates a failing check run on failure', async () => {
    const { core, context, github } = makeMocks({
      branch: 'bad-branch',
    });
    await validate({ github, context, core });

    expect(github.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conclusion: 'failure',
        output: expect.objectContaining({
          title: 'JIRA Validation Failed',
        }),
      })
    );
  });

  test('includes markdown summary in check run output', async () => {
    const { core, context, github } = makeMocks();
    await validate({ github, context, core });

    const call = github.rest.checks.create.mock.calls[0][0];
    expect(call.output.summary).toContain('JIRA Validation Passed');
  });

  test('includes started_at and completed_at timestamps', async () => {
    const { core, context, github } = makeMocks();
    await validate({ github, context, core });

    const call = github.rest.checks.create.mock.calls[0][0];
    expect(call.started_at).toBeDefined();
    expect(call.completed_at).toBeDefined();
    expect(() => new Date(call.started_at)).not.toThrow();
    expect(() => new Date(call.completed_at)).not.toThrow();
  });

  test('omits details_url and external_id when GITHUB_RUN_ID is not set', async () => {
    const { core, context, github } = makeMocks();
    delete process.env.GITHUB_RUN_ID;
    await validate({ github, context, core });

    const call = github.rest.checks.create.mock.calls[0][0];
    expect(call.details_url).toBeUndefined();
    expect(call.external_id).toBeUndefined();
  });

  test('warns but does not fail if checks.create throws', async () => {
    const { core, context, github } = makeMocks();
    github.rest.checks.create.mockRejectedValue(new Error('Forbidden'));
    await validate({ github, context, core });

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('checks: write')
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// End-to-end scenarios
// ---------------------------------------------------------------------------

describe('end-to-end scenarios', () => {
  test('everything valid passes', async () => {
    const { core, context, github } = makeMocks({
      jiraKeys: 'DOKTUZ,PROJ',
      branch: 'feature/DOKTUZ-100-new-thing',
      prTitle: 'DOKTUZ-100: Add new thing',
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-100 initial implementation' } },
        { sha: 'b'.repeat(40), commit: { message: 'PROJ-5 extracted helper' } },
        { sha: 'c'.repeat(40), commit: { message: 'Merge branch \'main\'' } },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('All JIRA validation checks passed')
    );
  });

  test('everything invalid fails with three errors', async () => {
    const { core, context, github } = makeMocks({
      branch: 'feature/no-ticket',
      prTitle: 'Fix the thing',
      commits: [
        { sha: 'a'.repeat(40), commit: { message: 'quick fix' } },
      ],
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Branch check: FAILED'));
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('PR title check: FAILED'));
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Commit check: FAILED'));
  });

  test('branch fails but PR and commits pass', async () => {
    const { core, context, github } = makeMocks({
      branch: 'hotfix/urgent',
      prTitle: 'DOKTUZ-1: Hotfix',
      commits: [{ sha: 'a'.repeat(40), commit: { message: 'DOKTUZ-1 hotfix' } }],
    });
    await validate({ github, context, core });
    expect(core.setFailed).toHaveBeenCalled();
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Branch check: FAILED'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('PR title check: PASSED'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Commit check: PASSED'));
  });
});
