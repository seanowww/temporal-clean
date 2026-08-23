# GitHub Actions reviewer workflow

Temporal is CI-native for reviewers and local-first for source configuration.

## Reviewer experience

Opening or updating a pull request runs `.github/workflows/temporal.yml`. The job reconstructs the PR anchor from `GITHUB_EVENT_PATH`, loads any approved snapshot under `.temporal/evidence`, assembles the graph deterministically, and publishes three durable surfaces:

1. The workflow itself is the PR check.
2. A single `github-actions[bot]` comment is created and updated in place with the summary, sources, key context, and QA focus.
3. A protected workflow artifact contains the self-contained interactive HTML, artifact JSON, and Markdown summaries.

The artifact is retained for 30 days by this workflow and can be downloaded only by people with repository read access. No GitHub Pages site, inbound webhook, tunnel, GitHub App, or service secret is required.

The workflow currently ships with the Temporal repository and executes its local scripts. New users can test it in a fork or copy of Temporal. Installing it into an unrelated repository will require a separately packaged Action or reusable tool release; copying only the YAML file is not sufficient today.

## Local evidence

The local dashboard and connectors continue to write `data/temporal.db`. That database is never uploaded. Export an intentional snapshot after reviewing the dry-run counts:

```bash
npm run temporal:export -- --repo owner/repository
npm run temporal:export -- --repo owner/repository --yes
git diff -- .temporal/evidence
```

When the evidence files are new, run `git add -N .temporal/evidence` before `git diff`; intent-to-add makes their contents reviewable without staging them.

Commit the snapshot when its contents are appropriate for every collaborator who can read the repository. Later workflow runs rebuild their graph from that immutable source evidence.

Evidence added only to local SQLite does not change an existing PR until it is exported, committed, and pushed. The resulting `synchronize` event reruns Temporal and updates the existing comment.

## Fork pull requests

GitHub gives fork-originated `pull_request` workflows a read-only token. Temporal still assembles the timeline, workflow summary, and downloadable artifact, but skips the PR comment. Do not replace this with `pull_request_target` while executing pull-request code; that would expose a privileged token to untrusted code.

## Permissions

The workflow requests only:

- `contents: read` for checkout and Git history.
- `pull-requests: write` for the same-repository PR comment.

The automatic `GITHUB_TOKEN` is scoped to the repository and expires with the job.
