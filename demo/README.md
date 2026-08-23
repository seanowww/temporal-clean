# Demo evidence

**These are prepared fixtures, not live captures.** They exist because Slack and the
agent-session collector are not connected to a live workspace for the hackathon demo.

Everything else in the golden path is real: the repository, the pull request, its
commits, the webhook delivery, the traversal, and the bot comment.

Each record here is authored to match the actual commit history of the
`johnny/waitlist-signup` golden PR. The ticket starts with five fields; the final
diff contains three. Jira, Slack, Claude Code, and GitHub explain both removals:

1. Product removes phone number after a privacy review.
2. Claude identifies that the project has no provisioned private upload path.
3. Senior engineering defers profile photos until the storage controls are ready.

The reconstructed timeline is faithful to what the diff did; the Jira, Slack, and
Claude records are supplied by hand instead of pulled from live workspaces.

Load them with:

```bash
npm run demo:prepare
```

To create self-contained HTML snapshots that do not need the Temporal server, run:

```bash
npm run demo:export-static
```

This writes `pr-1.html` and `pr-2.html` to `demo/static-artifacts`. Pass an output
directory and optional PR ids after `--` when publishing them elsewhere.
Set `TEMPORAL_STATIC_ARTIFACT_BASE_URL` to their published directory URL so later
webhooks keep GitHub comments and checks on the static snapshots.

`static-artifact-policy.json` records any stable evidence ids excluded from a
snapshot after source verification. Exclusions are applied only to the published
demo and logged during export; the provenance store remains unchanged and auditable.

This imports all three prepared sources, assembles `pr-2`, updates the single bot
comment, creates the check, and creates or refreshes the GitHub Deployment.

## Stage runbook

Before presenting:

1. Keep the Next.js server and public tunnel running.
2. Confirm the GitHub App has Deployments, Checks, and Pull requests set to read/write.
3. Run `npm run demo:prepare` and require every delivery to report `delivered: true`.
4. Open `https://github.com/seanowww/temporal-golden-demo/pull/2`.

During the demo:

1. Show that the final diff stores only Name, Organization, and Email.
2. Point out that WL-12 originally required Phone Number and Profile Photo.
3. Use the Temporal deployment or the bot's **View timeline** link.
4. Select, in order: Jira ticket, PM privacy decision, Claude storage finding,
   senior engineering approval, and the final Git commits.
5. End on the PR node: QA can verify the three-field scope without messaging Johnny.
