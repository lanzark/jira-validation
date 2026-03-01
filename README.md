# JIRA Validation Action

A reusable GitHub Action that validates PR titles, branch names, and commit messages contain a JIRA ticket reference (e.g. `DOKTUZ-123`).

## Usage

Add to `.github/workflows/jira-check.yml` in any repo:

```yaml
name: JIRA Validation
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

permissions:
  pull-requests: read
  checks: write

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: lanzark/jira-validation@v1
        with:
          jira-keys: 'DOKTUZ'
```

Multiple keys:

```yaml
      - uses: lanzark/jira-validation@v1
        with:
          jira-keys: 'DOKTUZ,PROJ,TEAM'
```

## Permissions

This action requires the following permissions:

```yaml
permissions:
  pull-requests: read
  checks: write
```

- **`pull-requests: read`** — required to list PR commits via the GitHub API.
- **`checks: write`** — required to publish a Check Run with the validation report. When a check fails, the rendered markdown report is visible directly via the **"Details"** link on the PR checks tab. If this permission is missing, the action still works but the inline report won't appear (a warning is logged instead).

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `jira-keys` | Yes | | Comma-separated JIRA project keys |
| `skip-branch-check` | No | `false` | Skip branch name validation |
| `skip-commit-check` | No | `false` | Skip commit message validation |
| `skip-pr-title-check` | No | `false` | Skip PR title validation |

## Behavior

- Matching is **case-insensitive** (`doktuz-123`, `DOKTUZ-123`, `Doktuz-123` all match)
- **Merge commits** are automatically skipped
- Only the **first line** of each commit message is checked
- On failure, a **Markdown report** with a remediation guide is published as a **Check Run** (visible via the "Details" link on the PR) and as a **Job Summary** on the workflow run page
- The GitHub API returns a maximum of 250 commits per PR

## Development

```bash
npm install
npm test
```

## License

MIT
