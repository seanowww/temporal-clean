# Temporal

Temporal builds evidence-backed timelines for pull request review from a permission-aware provenance graph.

## Try Temporal on a pull request

The reviewer-facing product runs in GitHub Actions: no tunnel, GitHub App, hosted backend, environment file, or API key is required.

1. Fork or copy this repository into an account where you can run Actions. If GitHub shows **Workflows aren't being run on this forked repository**, open the **Actions** tab and select **I understand my workflows, go ahead and enable them**.
2. Create a branch, make any small change, push it, and open a pull request against `main` in that same repository.
3. Wait for **Temporal / Build PR timeline**. A clean run currently takes about 30 seconds.
4. In a public repository with Pages enabled, click **Open the Temporal HTML timeline** in the `github-actions[bot]` comment. It opens immediately in the browser.
5. In a private repository, use the protected fallback: open the linked workflow run, download `temporal-pr-<number>`, unzip it, and open `pr-<number>.html`.

Public repositories need one-time Pages setup; follow the [instant HTML setup](docs/GITHUB_ACTIONS.md#reviewer-experience). Published timelines are public, while fallback artifacts require repository read access and are retained for 30 days. Fork-originated PRs into somebody else's repository still receive the Check and artifact, but GitHub's read-only fork token prevents publishing and commenting; see [fork behavior](docs/GITHUB_ACTIONS.md#fork-pull-requests).

> **Current distribution boundary:** the workflow uses Temporal's scripts from this repository. It is ready for dogfooding in a fork or copy of Temporal, but it is not yet packaged as a one-file Action for unrelated repositories.

## Add local Claude, Slack, and planning evidence

The workflow works immediately with GitHub PR context. To include locally collected Claude, Codex, Slack, Jira, or Notion evidence, first run the local console and import or sync records:

```bash
npm install
npm run dev
```

Open [http://localhost:3000/connections](http://localhost:3000/connections). No `.env.local` is required for file imports. The seeded example is visible on the dashboard; its ready interactive artifact is [http://localhost:3000/artifact/index.html?artifact=pr-4471](http://localhost:3000/artifact/index.html?artifact=pr-4471).

Then export only evidence explicitly scoped to the repository:

```bash
npm run temporal:export -- --repo owner/repository
npm run temporal:export -- --repo owner/repository --yes
git add -N .temporal/evidence
git diff -- .temporal/evidence
```

The first command is a dry run; `--yes` writes the snapshot. `git add -N` makes new files visible to `git diff` without staging their contents. Review every exported record before committing and pushing it. That push reruns Temporal and updates the existing PR comment. See **[`docs/GITHUB_ACTIONS.md`](docs/GITHUB_ACTIONS.md)** for the security boundary and data lifecycle.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first run seeds a synthetic PR; select the ready PR on the dashboard or open `http://localhost:3000/artifact/index.html?artifact=pr-4471` directly.

Use `http://localhost:3000/connections` to connect a source, sync an authenticated API, or upload/paste a JSON, JSONL, Markdown, or text export. Set `TEMPORAL_SEED_DEMO=false` for a clean workspace; production does not seed demo data unless explicitly enabled.

To load a curated demo dataset instead of the synthetic seed, run `npm run demo:prepare` — it loads `demo/*` fixtures and publishes an artifact end to end. See `demo/README.md`.

## Environment

Copy `.env.example` to `.env.local` and configure only the integrations you need. `.env.local` is ignored by Git.

Required for the PR context agent:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (defaults to `gpt-5-mini`)

Required for GitHub App repository access — in local development the **Create Temporal app** flow on `/connections` writes these four for you (see [GitHub App](#github-app) below):

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY` with escaped newlines, or `GITHUB_APP_PRIVATE_KEY_BASE64`
- `GITHUB_WEBHOOK_SECRET`

Required only for the legacy GitHub App webhook mode: `TEMPORAL_APP_URL`, for artifact links and the Manifest flow's callback URL.

For the legacy GitHub App demo, `TEMPORAL_STATIC_ARTIFACT_BASE_URL` can point GitHub comments,
checks, and deployments at self-contained `<pull-request-id>.html` snapshots instead
of the running Temporal server.

`GITHUB_TOKEN` and `GITHUB_ORG` remain available only as a local legacy fallback.

Recommended for the local collector:

- `TEMPORAL_COLLECTOR_TOKEN`

Optional authenticated connectors:

- Slack: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_IDS`
- Jira: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, optional `JIRA_PROJECT_KEYS`
- Notion: no token is required for the recommended dashboard OAuth flow; `NOTION_TOKEN` remains a legacy API fallback

Every connector also supports file/paste fallback. Claude Code and Codex use local chat dumps by default; both also arrive live through the [claude-mem connector](#claude-mem-connector) below when it's installed.

## GitHub App (legacy local webhook mode)

Full setup instructions live in **[`docs/GITHUB_APP_SETUP.md`](docs/GITHUB_APP_SETUP.md)**. In short: open `/connections`, expand GitHub, and select **Create Temporal app**. This runs a GitHub App Manifest flow that creates the App, sets the webhook and callback URLs, requests only the permissions Temporal uses (Contents read; Pull requests, Checks, and Deployments write), and writes the generated credentials and webhook secret straight into `.env.local`. The one-click writer is disabled in production — see that doc for the manual/hosting-provider path, and run `npm run github:check` any time to verify an installation end to end.

The user chooses the organization and repositories on GitHub; Temporal persists only the installation ID and repository metadata, then mints short-lived installation tokens when it syncs or comments on a PR.

## GitHub webhook

Configure the GitHub webhook URL as:

```text
https://your-temporal-host/api/webhooks/github
```

(The Manifest flow above sets this automatically; only needed if you're wiring an App by hand.)

Pull-request events (`opened`, `reopened`, `synchronize`, `edited`, `ready_for_review`) create or refresh the traversal anchor, backfill commits and diff size from the API, invoke the PR context agent, render an immutable artifact, and deliver a GitHub Deployment, a Check Run, and a PR comment linking to it. Other pull-request actions are ingested but don't trigger a rebuild. Push events add commit evidence. Installation events keep repository access state current. Deliveries are deduplicated by `X-GitHub-Delivery` and verified with `X-Hub-Signature-256` whenever a webhook secret is configured. Delivery to GitHub is best-effort — a failed comment or check never discards an artifact Temporal already built.

## Connector pipeline

1. `POST /api/connections/:source/import` accepts a file or pasted export.
2. `POST /api/connections/:source/sync` retrieves authenticated GitHub, Slack, Jira, or Notion data.
3. Deterministic source parsers normalize known records into auditable graph nodes and relationships.
4. Repository, branch, commit, and ticket identifiers attach evidence to matching PR anchors.

Known formats do not require an LLM. This keeps ingestion deterministic, fast, and cheap; the OpenAI agent is used where judgment matters—selecting the bounded evidence set and writing a reviewer summary.

## Connect sources

Open `http://localhost:3000/connections`. Each source appears once, regardless of whether it uses an app, API, MCP, collector, or file import. Open a source card to follow the same three-stage flow: connect, sync or record, then verify the imported records.

- **GitHub:** create or install the Temporal GitHub App, choose repositories, then sync.
- **Notion:** select **Connect Notion**, approve OAuth, enter a workspace search topic, then select **Sync now**.
- **Claude Code:** connect Claude to Temporal's MCP server using the repository configuration below, then ask Claude to record the session. Existing sessions can also be imported as JSON or JSONL.
- **Slack and Jira:** use the configured API connection or import an export file.

The **Other MCP server** section is an advanced path for a remote Streamable HTTP server not already covered by the source cards. Inspect the server, explicitly choose the read tool Temporal may call, then connect it. Temporal normalizes that tool's responses into the selected source type.

### Demo walkthrough

1. Start Temporal with `npm run dev`, then open `/connections`.
2. Open **GitHub**, install or confirm the GitHub App, and select **Sync API**.
3. Open **Notion**, select **Connect Notion**, approve the workspace, enter a topic that exists in that workspace, and select **Sync now**.
4. Open **Claude Code** and follow the displayed launch instructions. In Claude, run `/mcp`, approve `temporal`, then ask: `Record this session in Temporal.`
5. Return to the main company-memory view. Select a pull request to inspect the GitHub, Notion, and Claude evidence linked to it.

The connector label describes the source. Its setup panel describes the transport currently used for that source. For example, Notion remains one Notion connector even though its live transport is MCP.

### MCP direction

MCP can run in either direction in this demo:

```text
Notion MCP server  →  Temporal MCP client  →  provenance graph
Claude Code client →  Temporal MCP server  →  provenance graph
```

Notion is a source Temporal reads. Claude Code is a client that calls Temporal's tools. This is why Notion authorization happens in the dashboard while Claude authorization happens through `/mcp` inside Claude Code.

### Claude Code setup

The repository includes a project-scoped `.mcp.json` with Temporal already registered. Export the collector token from `.env.local` before launching Claude Code:

```bash
export TEMPORAL_COLLECTOR_TOKEN="$(sed -n 's/^TEMPORAL_COLLECTOR_TOKEN=//p' .env.local)"
claude
```

On the first launch, run `/mcp` and approve the `temporal` project server. Temporal exposes `temporal_record_session` and `temporal_get_pr_context`. Ask Claude to record the session when its work should enter the provenance graph. Notion connects directly to Temporal from the Notion dashboard card; it does not need to be approved inside Claude.

To verify the project configuration without opening an interactive session:

```bash
claude mcp list
```

Slack has no verified official hosted MCP URL in its primary documentation. The direct Slack API connector remains available through `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_IDS`. A trusted remote Slack MCP implementation can be added through **Other MCP server**.

### Connect Notion directly to Temporal

1. Open `/connections` and select **Notion**.
2. Select **Connect Notion**. Temporal performs OAuth discovery and redirects to Notion.
3. Choose the Notion workspace and approve access.
4. Notion returns to `/api/auth/mcp/callback`; the Notion card now shows as connected.
5. Enter a search topic and select **Sync now** to ingest matching Notion records and rebuild linked PR artifacts.

OAuth client registration, PKCE verifier, access token, refresh token, and discovery state are stored per connection. Credential material is AES-256-GCM encrypted using `TEMPORAL_CREDENTIAL_KEY`, falling back to `TEMPORAL_COLLECTOR_TOKEN` only in local development. Bearer-authenticated MCP connections reference an environment-variable name rather than persisting the token.

## PR artifact agent

The single-agent workflow is implemented with the OpenAI Agents SDK. Its only tool performs an ACL-filtered, depth-bounded graph crawl for the webhook PR. The reusable contract lives in `skills/temporal-artifact-builder/SKILL.md`; it requires evidence citations, forbids invented facts, caps selected context, and emits structured QA focus points. If the API is unavailable, Temporal falls back to deterministic traversal and artifact assembly.

## Claude Code collector

Upload an existing Claude Code JSON or JSONL session:

```bash
npm run collector -- collect claude --file /path/to/session.jsonl
```

The collector infers the GitHub repository, current branch, and actor from Git when possible. Override them with `--repo`, `--branch`, and `--actor`.

Check connectivity:

```bash
npm run collector -- status
```

## claude-mem connector

[claude-mem](https://github.com/thedotmack/claude-mem) compresses agent sessions into typed
observations (`decision`, `bugfix`, `feature`, `refactor`, `discovery`, `change`), session
summaries, and raw prompts. Temporal reads those instead of a raw transcript, so an agent
decision arrives already distilled into artifact-shaped evidence.

```bash
npx claude-mem install          # installs the local worker
npm run collector -- collect claude-mem
```

Temporal reads the local worker first (`http://127.0.0.1:{37700 + uid % 100}`, or
`CLAUDE_MEM_WORKER_URL`) and falls back to reading `~/.claude-mem/claude-mem.db` directly.
The **claude-mem** tile on `/connections` runs the same sync, and accepts a JSON export
containing `observations`, `summaries`, or `prompts` when claude-mem is not installed
locally.

### Every agent claude-mem supports, not just Claude Code

claude-mem is not Claude-Code-only — it installs into any of the coding agents it supports,
and each installed agent writes into the same local worker/database:

```bash
npx claude-mem install --ide claude-code   # default
npx claude-mem install --ide codex-cli
npx claude-mem install --ide cursor
```

Full identifier list: `claude-code`, `cursor`, `opencode`, `openclaw`, `windsurf`, `codex-cli`,
`copilot-cli`, `antigravity`, `goose`, `roo-code`, `warp`. Install for whichever agents are
actually used against a repository Temporal watches — installing for an agent that never runs
is a no-op hook, not a problem, but it's still one more thing sitting in that agent's config.

claude-mem tags every session with the agent that wrote it (`sdk_sessions.platform_source`),
and Temporal reads that tag. A Codex session gets Temporal's dedicated `codex` source — its own
logo and accent color, same as a Codex file/paste import — instead of being folded into Claude
Code's. Every other platform (Cursor, Windsurf, Antigravity, ...) doesn't have dedicated styling
in Temporal yet, so it falls back to the `claude` source for display, but the real platform is
never lost: it's always on the node as `metadata.platform`, so a future connector tile or filter
can split it back out without re-ingesting anything.

### Repository and branch resolution

claude-mem scopes memory by project name and records no repository, branch, or commit,
which is exactly what Temporal links on. `bin/temporal-hook.mjs` closes that gap by stamping
the git state of a working directory into `~/.claude/temporal/git-context.jsonl`; each
observation then inherits the branch that was checked out when it was captured. Install it
in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /abs/path/to/bin/temporal-hook.mjs" }] }],
    "PostToolUse": [{ "matcher": "Edit|Write|Bash", "hooks": [{ "type": "command", "command": "node /abs/path/to/bin/temporal-hook.mjs" }] }]
  }
}
```

Without the hook, set `TEMPORAL_CLAUDE_MEM_PROJECTS="temporal=acme/platform-api"` to map
project names to repositories. Records that resolve to neither are still ingested and are
reported as unlinked by the collector and the dashboard.

Content fenced in `<private>…</private>` is stripped at the ingest boundary and never
reaches a node, an artifact, or the model.

### Changed-file linkage

claude-mem records the files each observation read and modified. Temporal fetches the PR's
changed files and scores an overlap during traversal (`+50` modified, `+25` read), which
links agent memory to a PR even when branch and commit metadata are missing. GitHub
webhooks carry only a file count, so paths are fetched on demand and cached on the pull
request; if GitHub is unreachable the traversal simply loses that one signal.

## API flow

1. `POST /api/webhooks/github` ingests GitHub events.
2. `POST /api/collect/claude` ingests a normalized local session.
3. Temporal links evidence to matching PR graph anchors.
4. A PR webhook invokes the context agent; `POST /api/artifacts/:prId/generate` remains available for deterministic manual regeneration.
5. `GET /api/artifacts/:prId` returns the latest immutable artifact version.
6. GitHub receives a Deployment, a Check Run, and a PR comment linking to the artifact.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

For the full HTTP workflow, run the app with the E2E secrets from `.env.example`, then:

```bash
npm run test:e2e
```

This exercises signed GitHub delivery and replay protection, Claude JSONL collection, graph linkage, immutable artifact versioning, dashboard readiness, and GitHub Check payload assembly.

For the self-contained MCP path, run:

```bash
npm run test:e2e:mcp
```

It builds Temporal, starts an isolated server and mock Slack MCP server, syncs Slack evidence into a PR, submits a Claude session through Temporal's MCP endpoint, and verifies that both sources appear in the rebuilt artifact.
