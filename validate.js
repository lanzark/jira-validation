const { buildSummary } = require('./summary');

module.exports = async ({ github, context, core }) => {
  const jiraKeys = process.env.JIRA_KEYS;
  const skipBranch = process.env.SKIP_BRANCH_CHECK === 'true';
  const skipCommit = process.env.SKIP_COMMIT_CHECK === 'true';
  const skipPrTitle = process.env.SKIP_PR_TITLE_CHECK === 'true';

  if (!jiraKeys || jiraKeys.trim() === '') {
    core.setFailed('Input "jira-keys" is required but was not provided.');
    return;
  }

  const keys = jiraKeys.split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    core.setFailed('Input "jira-keys" must contain at least one project key.');
    return;
  }

  const escaped = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![a-zA-Z0-9])(${escaped.join('|')})-\\d+`, 'i');
  core.info(`JIRA pattern: ${pattern}`);

  const pr = context.payload.pull_request;
  if (!pr) {
    core.setFailed('This action only works on pull_request events.');
    return;
  }

  const { owner, repo } = context.repo;
  const pullNumber = pr.number;
  let failed = false;

  const results = { branch: null, prTitle: null, commits: [] };

  // --- Branch name ---
  if (skipBranch) {
    core.info('Branch check: skipped');
    results.branch = { status: 'skipped', value: pr.head.ref };
  } else {
    const branch = pr.head.ref;
    const pass = pattern.test(branch);
    results.branch = { status: pass ? 'pass' : 'fail', value: branch };
    if (pass) {
      core.info(`Branch check: PASSED ("${branch}" matches ${pattern})`);
    } else {
      core.error(`Branch check: FAILED ("${branch}" does not match ${pattern})`);
      failed = true;
    }
  }

  // --- PR title ---
  if (skipPrTitle) {
    core.info('PR title check: skipped');
    results.prTitle = { status: 'skipped', value: pr.title };
  } else {
    const title = pr.title;
    const pass = pattern.test(title);
    results.prTitle = { status: pass ? 'pass' : 'fail', value: title };
    if (pass) {
      core.info(`PR title check: PASSED ("${title}" matches ${pattern})`);
    } else {
      core.error(`PR title check: FAILED ("${title}" does not match ${pattern})`);
      failed = true;
    }
  }

  // --- Commit messages ---
  let badCommits = [];
  if (skipCommit) {
    core.info('Commit check: skipped');
  } else {
    const commits = await github.paginate(
      github.rest.pulls.listCommits,
      { owner, repo, pull_number: pullNumber, per_page: 100 }
    );

    core.info(`Found ${commits.length} commit(s) to check`);

    let skippedMerges = 0;
    for (const c of commits) {
      const msg = c.commit.message.split('\n')[0];
      const isMerge = msg.startsWith('Merge ');
      if (isMerge) {
        skippedMerges++;
        results.commits.push({ sha: c.sha.substring(0, 7), message: msg, status: 'skipped' });
        continue;
      }
      const pass = pattern.test(msg);
      results.commits.push({ sha: c.sha.substring(0, 7), message: msg, status: pass ? 'pass' : 'fail' });
      if (!pass) {
        badCommits.push({ sha: c.sha.substring(0, 7), message: msg });
      }
    }

    if (skippedMerges > 0) {
      core.info(`Commit check: skipped ${skippedMerges} merge commit(s)`);
    }

    const checked = commits.length - skippedMerges;
    if (badCommits.length === 0) {
      core.info(`Commit check: PASSED (all ${checked} commit(s) match ${pattern})`);
    } else {
      core.error(`Commit check: FAILED (${badCommits.length} of ${checked} commit(s) missing JIRA reference)`);
      for (const bc of badCommits) {
        core.error(`  ${bc.sha}: ${bc.message}`);
      }
      failed = true;
    }
  }

  // --- Write Markdown Job Summary ---
  const md = buildSummary({
    failed,
    skipCommit,
    exampleKey: keys[0],
    pattern,
    results,
    badCommits,
  });
  await core.summary.addRaw(md).write();

  // --- Publish Check Run with inline report (visible via "Details" link on PR) ---
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const runId = process.env.GITHUB_RUN_ID || '';
  const detailsUrl = runId
    ? `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`
    : undefined;

  try {
    await github.rest.checks.create({
      owner,
      repo,
      name: 'JIRA Validation Report',
      head_sha: pr.head.sha,
      status: 'completed',
      conclusion: failed ? 'failure' : 'success',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      ...(detailsUrl && { details_url: detailsUrl }),
      ...(runId && { external_id: runId }),
      output: {
        title: failed ? 'JIRA Validation Failed' : 'JIRA Validation Passed',
        summary: md,
      },
    });
  } catch (err) {
    core.warning(`Could not create check run (needs "checks: write" permission): ${err.message}`);
  }

  // --- Final status ---
  if (failed) {
    core.setFailed(`One or more JIRA validation checks failed. Expected pattern: ${pattern}`);
  } else {
    core.info('All JIRA validation checks passed!');
  }
};
