# Codex task — finish the Temporal demo path

You are continuing work on Temporal, a hackathon project. Claude worked on it overnight;
read `DEMO_HANDOFF.md` first — it has the architecture, the verified system map, and 24
findings with their state. Do not re-litigate fixed findings.

## What Temporal is

When a pull request opens, Temporal reconstructs *why the code looks the way it does* by
traversing a permission-aware graph of the work that preceded the diff — GitHub events,
Slack threads, and Claude Code / Codex agent sessions — then renders a timeline and posts
a bot comment back on the PR. The product thesis: the decision that shaped the diff often
lives only in an agent transcript, invisible to a reviewer.

## Ground truth, verified

- Next.js 16 App Router, single process. Storage is `node:sqlite` at `./data/temporal.db`.
- There is **no MCP integration and no Granola integration**. Do not add or claim either.
- Jira, Notion and Codex have **zero real records** — seeded fiction only.
- GitHub App `temporal-test-2` (id `4694037`, owner `seanowww`) is created, credentials are
  in `.env.local`, `GET /app` returns 200, and permissions/events are granted.
- Golden repo: `seanowww/temporal-golden-demo`, PR **#1**, branch `aria/export-idempotency`,
  4 real commits including an abandoned cursor-pagination approach.
- Prepared fixtures live in `demo/` and are labelled as fixtures in `demo/README.md`.
  Keep that labelling honest. Never present a fixture as live data.

## Golden path

```
signed pull_request webhook  ->  anchor node
    + demo/load.sh (Slack + agent evidence)
    -> traversal -> artifact -> /artifact/index.html?artifact=pr-1
    -> Check Run + bot comment on the PR, posted as temporal-test-2[bot]
```

Reproduce locally:
```bash
npx next dev -p 3000
SIG="sha256=$(openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" < /tmp/golden-webhook.json | awk '{print $2}')"
curl -sS -X POST http://localhost:3000/api/webhooks/github \
  -H 'Content-Type: application/json' -H 'X-GitHub-Event: pull_request' \
  -H "X-GitHub-Delivery: $(uuidgen)" -H "X-Hub-Signature-256: $SIG" \
  --data-binary @/tmp/golden-webhook.json
./demo/load.sh
```
Validate with `npm run typecheck && npm test && npm run test:e2e`. 21 unit tests pass now;
keep them passing and add tests for what you build.

## Tasks, in priority order

### 1. Install the App and prove the write path (highest value, currently unverified)
Everything below depends on this. Install `temporal-test-2` on `seanowww/temporal-golden-demo`
via the UI at `/connections` (GitHub tile -> Connect GitHub), then trigger a **real** delivery
by pushing a commit to the PR branch. Verify, with evidence:
- the delivery id in `webhook_deliveries` is a GitHub UUID, not a hand-made `g-one-…`
- `backfillPullRequestFromApi` ingests the 4 commits and the changed files
- artifact coverage flips `git: 1/unverified` -> `git: 5/complete` and the `gaps[]` entry
  about missing commits disappears
- the comment posts as `temporal-test-2[bot]`, confirmed by `postedAs` / `isBot` in the
  delivery response — not as a human account
- redelivering **edits the same comment** rather than creating a second one
- the Check Run appears. Note Check Runs are App-only; a PAT gets 403.

### 2. Cache installation access tokens
`getGitHubAccessToken()` in `lib/github-app.ts` mints a fresh installation token on **every
call** — the webhook path alone calls it repeatedly. Tokens last an hour. Cache by
installation id with expiry, refresh ~60s early, and invalidate when the stored installation
changes. Add a unit test that a second call inside the window does not re-mint.

### 3. QA focus on the live path (finding J-9)
`tests` is empty for every event on a real PR, so the "What to verify" panel — the product's
stated purpose — never renders outside the seeded fixture. It only populates when the OpenAI
agent runs. Either make `lib/agent/pr-agent.ts` emit per-event verification prompts rather
than only a PR-level `qaFocus`, or derive defensible checks deterministically. **Do not invent
checks that the evidence does not support** — an unsupported QA step is worse than none.
Requires `OPENAI_API_KEY`; degrade cleanly without it.

### 4. Reconcile the two counts the UI shows (finding J-10)
The dashboard dock says "10 related nodes · 3 sources"; the artifact for the same PR says 6
events / 4 sources. `lib/dashboard.ts` counts repo+branch matches, traversal selects
differently. Two screens disagreeing in front of a judge reads as broken. Make the dashboard
report what traversal actually selected, or label the two numbers as different things.

### 5. Honest demo-data marker (finding J-11)
`lib/dashboard.ts` sets `synthetic` only when *every* PR is synthetic, so one real PR
suppresses the "demo data" badge for a graph that is still mostly seeded. Mark per-PR instead.

### 6. Recover real branch structure (finding J-13)
On the live path the edge set is decorative: `spine` edges chaining events by time plus one
`branch` edge from the PR to every node. No branch or prune structure is actually recovered,
yet the renderer legend still says "dashed orbs are pruned branches". Either derive real
structure (the golden PR genuinely contains an abandoned approach in commit `cd9ea21`) or
stop claiming it in the legend.

### 7. Narrow the App permissions
The app currently holds `administration: write`, `actions: write`, `workflows: write` and
several `agent_*: write` scopes it does not use. It needs exactly: Contents read,
Pull requests read, Issues write, Checks write, Metadata read. Reduce it in the GitHub UI
(there is no API for this) and note the change in `DEMO_HANDOFF.md`.

## Rules

- Smallest robust fix. No broad refactors, no new integrations, no redesign.
- Every claim the product makes must be checkable against a source record. The worst bug
  found overnight was `coverage[].status` hardcoded to `"complete"` while 4 of 5 records were
  missing — asserting completeness you have not verified is worse than admitting a gap.
- Update `DEMO_HANDOFF.md` as you go: what you changed, what you verified, what remains.
- Do not commit or push without the human's explicit approval.
