@AGENTS.md

# Working in this repo

## Commits

Commit messages use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
with a short imperative subject, matching the existing history.

**Do not add AI attribution trailers to commits.** No `Co-Authored-By` line for any
assistant, no `Generated with` footer, no session links. The repo's history carries no
tool attribution and new commits must not introduce any. The commit author stays the
human git identity configured in `git config user.name` / `user.email`.

## Validation

Run before every commit:

```bash
npm run typecheck
npm test
```

`npm run build` and `npm run test:e2e` cover the full HTTP workflow; run them when the
change touches API routes, webhooks, or artifact assembly.

## Architecture

- `lib/db.ts` owns the SQLite schema. Every source normalizes into `graph_nodes` keyed by
  `(workspace_id, source, source_id)`; never write source-specific tables.
- `lib/store.ts` is the only module that talks to the database. Keep SQL there.
- `lib/graph.ts` scores traversal candidates. New linkage signals belong in
  `scoreCandidate()` so every source benefits, not in a single connector.
- `lib/artifact.ts` reads presentation hints from `node.metadata` (`imp`, `short`, `why`,
  `excerpt`, `tests`, `stamp`). Connectors set those at ingest time rather than adding
  per-source branches to artifact assembly.
- Deterministic parsing over LLM parsing: known formats normalize without a model call.
  The OpenAI agent is only for evidence selection and reviewer prose.

## Product constraints

`PRODUCT.md` is binding. In particular: source records stay immutable and distinct from
derived summaries, every generated claim cites accessible evidence, and source ACLs are
enforced during traversal rather than at render time.
