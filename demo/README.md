# WL-12 demo: the missing context behind a three-field form

This prepared scenario matches the live [Temporal demo PR](https://github.com/seanowww/temporal-clean/pull/7).
The PR is intentionally ordinary: its final diff adds a whitelist form with only Name,
Organization, and Email. Temporal recovers why Phone Number and Picture of Face disappeared.

The timeline follows this exact sequence:

1. The WL-12 product requirement asks for Name, Organization, Email, Phone Number, and Picture of Face.
2. The PM removes Phone Number in Slack after privacy and legal review.
3. Johnny confirms the scope change.
4. Claude reviews the Supabase setup and finds no ready private photo-storage path.
5. A senior SWE defers the picture and S3-compatible storage work.
6. The Git history shows the implementation arriving at the approved three fields.

The Jira, Slack, and Claude records are prepared reference fixtures rather than captures
from a live company workspace. They are deliberately labelled and contain no private data.
The repository, branch, commits, PR event, traversal, bot comment, and generated HTML are real.

## Show it on GitHub

1. Open [PR #7](https://github.com/seanowww/temporal-clean/pull/7).
2. Show the final diff: only Name, Organization, and Email remain.
3. Find the `github-actions[bot]` comment headed **Temporal timeline**.
4. Point out the requirement, privacy decision, Claude finding, and senior approval inline.
5. Follow **Download the interactive timeline from this workflow run**.
6. Download `temporal-pr-7`, unzip it, and open `pr-7.html` locally.
7. Select the evidence nodes in chronological order to show the source-native references.

The workflow artifact is private to repository readers and retained for 30 days. It does
not depend on a local server, Cloudflare tunnel, or GitHub Pages deployment. A new push to
the PR rebuilds the HTML and updates the existing bot comment in place.

## Recreate the prepared local reference

The older source-shaped fixtures remain useful when demonstrating the local console:

```bash
npm install
npm run demo:prepare
npm run demo:export-static
```

The static export writes self-contained reference HTML files under `demo/static-artifacts`.
They use the same artifact renderer as the GitHub Actions download, but are local-only and
do not prove that the PR workflow ran.
