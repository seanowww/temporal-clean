# Temporal — Demo Handoff

Running log for the overnight demo-hardening session. Updated as work lands.
Audience: the teammate running the demo, and Codex picking up remaining work.

**Last updated:** 2026-08-23, session 2 (Codex) — local demo path green; live GitHub write path still needs UI install + approved push

---

## 1. Architecture as it actually exists

Next.js 16 (App Router, Turbopack) — single process, no separate backend.

| Layer | Where | Notes |
|---|---|---|
| Storage | `lib/db.ts` | **`node:sqlite`** (`DatabaseSync`), file at `TEMPORAL_DB_PATH` (default `./data/temporal.db`). Real schema, real persistence. Not Postgres — `PRODUCT.md` calls Postgres "intended", it is not wired. |
| Store API | `lib/store.ts` | Upserts, dedupe by `(workspace, source, source_id)`, monotonic artifact versions, webhook-delivery dedupe table. |
| Graph | `lib/graph.ts` | Scored BFS traversal from the PR anchor node. Score = graph depth + commit SHA + branch + repo + author + ticket-id mention + 14-day window. `minimumScore` 25. |
| Ingestion — GitHub | `lib/ingest/github.ts` | Webhook only. `pull_request` → PR row + anchor node. `push` → commit nodes. |
| Ingestion — agent sessions | `lib/ingest/claude.ts` + `bin/temporal.mjs` | Collector CLI posts a normalized session to `/api/collect/claude`. |
| Ingestion — file/paste/API | `lib/connectors/{catalog,parser,ingest,sync}.ts` | Slack / Jira / Notion / GitHub / Claude / Codex. Deterministic parsers, no LLM. |
| Artifact | `lib/artifact.ts` | Traverse → select → shape events → version and save. |
| Agent | `lib/agent/pr-agent.ts` | OpenAI Agents SDK, one tool (`crawl_provenance_graph`), instructions from `skills/temporal-artifact-builder/SKILL.md`. Falls back to deterministic assembly on any error. |
| Delivery | `lib/delivery.ts` | GitHub Check Run + PR comment. |
| UI — dashboard | `app/page.tsx`, `app/dashboard-client.tsx` | Constellation graph, PR rail, connection rail. |
| UI — timeline | `public/artifact/index.html` | Standalone renderer, fetches `/api/artifacts/:prId`, falls back to a baked-in demo story. |

### There is no wrapper/orchestration layer and no MCP

`grep -ri "mcp"` over the repo returns **zero hits**. There is no MCP client, no MCP server, no tool registry beyond the single `@openai/agents` tool in `pr-agent.ts`. The "wrapper" is `lib/connectors/` — a static catalog of six connectors plus per-source parse functions. Registration is a literal array in `catalog.ts`.

### There is no Granola integration

`grep -ri "granola"` returns zero hits. It does not exist in this codebase. Do not demo it.

---

## 2. System map — verified status

```
GitHub PR ──webhook──> ingest ──> anchor node ──> traversal ──> artifact ──> renderer
                                       ^                            |
   Slack / Jira / Notion ──import──────┤                            └──> Check Run + PR comment
   Claude / Codex ──collector/import───┘
```

| Edge | Status | Evidence |
|---|---|---|
| PR webhook → PR row + anchor node | **WORKING** | `scripts/e2e.mjs` signed delivery, verified 202 |
| HMAC signature verify + replay dedupe | **WORKING** | e2e asserts replay returns `duplicate: true` |
| push webhook → commit nodes | **WORKING** (untested against real GitHub) | unit-covered |
| Fetch PR commits / files from GitHub API | **MISSING** | Temporal never calls the GitHub API for PR detail. Commits only arrive if a separate `push` webhook fires. |
| Agent-session collector → nodes → PR link | **WORKING** | e2e: `linked 1 pull request` |
| File/paste import → nodes | **WORKING** | unit-covered, parsers deterministic |
| File/paste import → PR **edge** | **BROKEN** | see F-4 |
| Authenticated API sync (Slack/Jira/Notion/GitHub) | **UNVERIFIED** | no credentials present; code is real, never exercised |
| Traversal → artifact | **WORKING** | e2e |
| Artifact → renderer | **WORKING** | `/artifact/index.html?artifact=pr-202` returns 200 and renders |
| Artifact → Check Run | **UNVERIFIED** | needs `GITHUB_TOKEN` |
| Artifact → PR comment | **UNVERIFIED** | needs `GITHUB_TOKEN` |
| Node quality / ontology | **PARTIAL** | see F-5 |

---

## 3. Findings

Severity: **P0** blocks the demo · **P1** damages credibility · **P2** worth fixing.

| ID | Sev | Finding | State |
|---|---|---|---|
| F-1 | P0 | **Synthetic demo evidence leaked into real PR timelines.** The seeded fake story (`acme/platform-api#4471`) lives in the same workspace as real data. A real PR opened against that repo scored those nodes at 45 (repo + time window) and inherited them — the artifact for real PR #202 was **18 events, 17 of them fabricated**, including one literally titled "PR #4471 opened for review". A judge reading that sees invented data. | **FIXED** |
| F-2 | P0 | **PR comment was not idempotent.** Every `pull_request` event POSTed a new comment — `opened`, `synchronize`, `edited`, `labeled`, all of them. Repeated demo runs would stack duplicate comments on the golden PR. | **FIXED** |
| F-3 | P1 | **Delivery failure destroyed the webhook response.** A GitHub 4xx on comment/check threw, the route returned 422, and the built artifact was reported as a failure even though it had been saved. | **FIXED** |
| F-4 | P1 | ~~**File/paste imports never create a PR edge.** `ingestConnectorDump` looks for the PR anchor *inside the dump being imported*, so a Slack or Claude export can never find it — `prNodeId` is always `undefined` and zero `CONTEXT_FOR` edges are written. Evidence still surfaces via repo/branch scoring, but at lower confidence and with `depth: null`.~~ | **FIXED** |
| F-5 | P1 | ~~**Chat imports produce raw dump nodes, not meaningful events.** `parseChat` emits one node per message titled `"user: <first line>"`, typed `agent_message`. The artifact's noise filter only excludes types `message`/`tool_call`, so imported agent transcripts bypass it entirely and flood the timeline.~~ | **FIXED** |
| F-6 | P1 | ~~**`metadata.importedFrom` is destroyed by every parser.** `base()` sets it, then each parser overwrites `metadata` wholesale. The connection-history UI shipped in `e316fc1` groups by exactly that key, so "Previous activity" is permanently empty for every source.~~ | **FIXED** |
| F-7 | P2 | **Hallucinated model id.** `lib/artifact.ts` `synthesizeSummary` defaults to `"gpt-5.6-luna"`, which is not a real model. Only reachable via `useAi: true` (the `/generate` route). `pr-agent.ts` correctly defaults to `gpt-5-mini`. | OPEN |
| F-8 | P1 | No GitHub API backfill meant a PR's existing commits never appeared. Backfill is now implemented (`lib/ingest/github-api.ts`) but **cannot be exercised without credentials** — it correctly no-ops with `reason: "github_not_configured"`. | **CODE DONE, UNVERIFIED** |
| F-9 | P1 | **No chronology guard.** A Slack record timestamped 372 days before the PR rendered on the timeline without complaint — repo + branch match alone cleared the score floor. Impossible chronology reads as fabrication. | **FIXED** |
| F-10 | P1 | **Every event was importance 5.** Importance bucketed raw traversal score; once repo and branch both matched, everything hit the ceiling. A uniformly loud timeline conveys no hierarchy. | **FIXED** |
| F-11 | P2 | Titles truncated at the first sentence, so a Slack message opening "Agreed." became an event titled "Agreed." | **FIXED** |

### Found by independent judge agents (round 1)

| ID | Sev | Finding | State |
|---|---|---|---|
| J-1 | P0 | **The renderer labelled the fabricated fixture "LIVE ARTIFACT".** `artifactMode` was set to `SYNTHETIC DEMO` in static markup and overwritten with `LIVE ARTIFACT` whenever the API fetch *succeeded* — and the fixture is stored in the database, so it always succeeded. The only time a judge saw the word "synthetic" was when the fetch failed. Exactly inverted. | **FIXED** — label is now derived from whether the events carry `demo:` evidence ids. |
| J-2 | P0 | **Unknown artifact ids silently rendered another PR's fabricated story.** `?artifact=pr-4470` 404s, the fallback fired, and the page rendered `PR #4471`, `14 files`, `+812 −196`. Any mistyped or shared link showed invented data with no error. | **FIXED** — an explicit "Temporal has not reconstructed this PR" state; no fixture fallback when an id was requested. |
| J-3 | P0 | **`coverage[].status` was the hardcoded string `"complete"`.** Nothing computed it. The artifact asserted complete GitHub coverage while holding 1 of 5 git records. As Judge 4 put it: a gap is forgivable, asserting the gap isn't there converts it into a credibility failure. | **FIXED** — status is now `complete` / `partial` / `unverified` / `imported`, computed against the PR's own declared commit count, plus a new `gaps[]` naming what is missing and why. |
| J-4 | P1 | **Inclusion rationale was a scoring log.** Every event on the live path read `"Included because it has graph path depth 1, matching branch, same repository, mentions EXP-99, inside PR development window."` in the panel headed "Why this matters to QA". | **FIXED** — rationale is now checkable prose. |
| J-5 | P1 | **Correlation reasons were circular.** `demo/load.sh` stamps `repository` and `branch` onto every fixture at import time; traversal then scored +70 for "matching branch" against a value it was handed, and presented a manufactured signal as a discovered one. | **FIXED** — records carrying `importedFrom` now say so: "filed under branch X when this export was imported, rather than carrying that branch itself." |
| J-6 | P1 | **Importance inverted the causal hierarchy.** Ranking by traversal score percentile gave the agent session that killed the entire approach `imp: 3`, and the decision governing the shipped design `imp: 2` — the lowest on the board — while the bug report got `imp: 5`. | **FIXED** — importance now weights evidence the diff does *not* already carry, per `PRODUCT.md`'s own principle. |
| J-7 | P1 | **A rolled-up session collapsed 27 hours into one instant.** The event is timestamped at the session start but its excerpt ends a day later, so turns rendered above events that actually preceded them — an effect before its cause inside a single event. | **FIXED** — sessions spanning >2h declare their window in `why`, and carry `spanEndsAt`. |
| J-8 | P1 | **The dashboard never said what the product does.** The H1 is "Company memory"; the only accurate one-liner in the product was in a `<meta name="description">`, invisible to a human. A judge spending 90 seconds without a talk track left not knowing what it was. | **FIXED** — thesis line added under the masthead. |
| J-9 | P1 | **`tests` is empty on the live path**, so the "What to verify" panel — the product's stated purpose — never renders for a real PR. QA focus only exists when the OpenAI agent runs. | **FIXED** — artifact assembly now derives narrow, source-backed checks for commits, Slack messages, Jira issues, Notion docs, and Claude/Codex sessions; existing fixture-provided checks still win. No `OPENAI_API_KEY` required. |
| J-10 | P2 | Dashboard and artifact disagree in front of the judge: the dock says "10 related nodes · 3 sources", the artifact says 6 events / 4 sources. `lib/dashboard.ts` counts repo+branch matches; traversal selects differently. | **FIXED** — dashboard PR counts use the latest saved artifact when present and label them as "artifact events"; only falls back to "related nodes" before an artifact exists. |
| J-11 | P2 | `synthetic` only flags when *every* PR is synthetic, so one real PR suppresses the "demo data" marker for a graph that is still mostly seeded. | **FIXED** — graph header marks demo data when any seeded PR is present, and each PR row/dock carries its own demo-data marker. |
| J-12 | P2 | `#4470` is permanently "traversing graph" and `#4468` permanently "Partial context"; both have `eventCount: 0` and 404 artifacts. They exist to populate the rail. | PARTLY MITIGATED — clicking them now shows the honest empty state rather than the fixture. |
| J-13 | P2 | On the live path the edge set is decorative: `spine` edges chaining events by time, plus one `branch` edge from the PR to every node. No branch structure is actually recovered, yet the legend still says "dashed orbs are pruned branches". | **FIXED BY HONESTY** — non-reject graph links are now neutral `context` edges, and the renderer says "no pruned branch recovered" unless the selected artifact contains real pruned evidence. No branch recovery was added. |

---

## 4. What changed this session

| File | Change |
|---|---|
| `lib/graph.ts` | Added `isDemoNode` / `evidenceVisibleToPullRequest`. Demo evidence is visible only to the demo PR that owns it. |
| `lib/artifact.ts`, `lib/agent/pr-agent.ts` | Both traversal sites filter through `evidenceVisibleToPullRequest`. |
| `lib/delivery.ts` | Comment is now find-by-marker then `PATCH`, else `POST`. Body rewritten: summary, source coverage, top-5 timeline table, QA focus list, partial-state notice, link. Added `artifactUrl` helper. |
| `app/api/webhooks/github/route.ts` | Rebuild only on `opened`/`reopened`/`synchronize`/`edited`/`ready_for_review`. Check and comment delivery wrapped so failures are reported, not thrown. |
| `tests/ingestion.test.ts` | Comment assertions updated to the new contract (marker must lead, so the comment is findable for in-place edit). |

**Verified after the change, from a wiped database:**
- real PR #202 → **2 events**, both real (was 18, 17 fabricated)
- demo PR #4471 → **15 events**, story intact
- `npm run typecheck` clean · `npm test` 13/13 · `npm run test:e2e` passes

### Session 2 (Codex)

| File | Change |
|---|---|
| `lib/github-app.ts` | Added in-memory installation-token cache keyed by installation id, with 60s early refresh and cache invalidation when the stored installation id changes. |
| `tests/github-app.test.ts` | Added regression test proving a second `getGitHubAccessToken()` call inside the validity window does not re-mint. |
| `lib/artifact.ts` | Added deterministic, evidence-backed `tests[]` generation for live artifacts and `hasPrunedBranch`; stopped labeling ordinary graph edges as branch structure. |
| `public/artifact/index.html`, `temporal-prototype.html` | Renderer now shows pruned-branch language only when the artifact proves it; otherwise it states no pruned branch was recovered. Added neutral `context` edge rendering. |
| `lib/dashboard.ts`, `app/dashboard-client.tsx`, `lib/types.ts` | Dashboard PR counts now use latest artifact counts when available, label fallback counts honestly, and mark demo data per PR plus globally when seeded PRs remain. |

**Verified locally:**
- `npm run typecheck` clean
- `npm test` 22/22
- `TEMPORAL_ENDPOINT=http://localhost:3000 GITHUB_WEBHOOK_SECRET=e2e-secret TEMPORAL_COLLECTOR_TOKEN=e2e-collector npm run test:e2e` passes against the existing dev server: `PR #202 → 2 events → artifact v4 → GitHub Check payload ready`

**Still not verified locally:**
- GitHub App installation on `seanowww/temporal-golden-demo`
- real GitHub delivery UUID in `webhook_deliveries`
- API backfill against the golden PR's 4 commits/files
- comment posted as `temporal-test-2[bot]`
- redelivery editing the same real comment
- real Check Run creation
- App permission narrowing in GitHub UI

Codex did not commit or push. The live write path requires browser/UI work and a separate explicit approval before pushing a commit to the golden PR branch.

---

## 5. Remaining work queue

Substantial, verifiable engineering — not cosmetics.

1. **Install and verify the GitHub App write path.** Use `/connections` → GitHub tile → Connect GitHub, install `temporal-test-2` on `seanowww/temporal-golden-demo`, then, after explicit approval, push a commit to `aria/export-idempotency` to trigger a real delivery. Capture delivery UUID, backfill evidence, bot identity, idempotent comment edit, and Check Run.
2. **Narrow GitHub App permissions in the GitHub UI.** Target permissions: Contents read, Pull requests read, Issues write, Checks write, Metadata read. Remove unused administration/actions/workflows/agent write scopes. There is no API for this.
3. **F-7 · Model id / config hardening.** Replace any remaining fake model ids and add a startup assertion or visible config warning when `OPENAI_MODEL` is unset.

---

## 6. Runbook

```bash
cp .env.example .env.local     # fill in the values in §7
rm -rf data                    # clean state
npx next dev -p 3000
```

Smoke test without GitHub credentials:

```bash
TEMPORAL_ENDPOINT=http://localhost:3000 \
GITHUB_WEBHOOK_SECRET=e2e-secret \
TEMPORAL_COLLECTOR_TOKEN=e2e-collector \
node scripts/e2e.mjs
```

Surfaces: `/` dashboard · `/connections` · `/artifact/index.html?artifact=<prId>`

---

## 7. Blocked on

Real GitHub credentials. Until these exist, the two highest-priority edges
(Check Run delivery, PR comment delivery) cannot be exercised — only their
payload construction is unit-tested.

- `GITHUB_TOKEN` — needs `repo` scope (Contents: read, Issues: write, Checks: write, Pull requests: read)
- `GITHUB_WEBHOOK_SECRET` — any shared string, must match the GitHub webhook config
- a public tunnel to `localhost:3000` for webhook delivery
- the golden repository and PR number
