# Committed Temporal evidence

Temporal's local SQLite database is private working memory. GitHub Actions never receives that database.

To deliberately publish a sanitized, repository-scoped snapshot for CI:

```bash
npm run temporal:export -- --repo owner/repository
npm run temporal:export -- --repo owner/repository --yes
```

The first command is a dry run. The second writes `evidence/records.jsonl`, `evidence/edges.jsonl`, and a digest-bearing `evidence/manifest.json`. Inspect the complete diff before committing it.

The exporter excludes restricted ACL records, synthetic demo records, GitHub records that CI reconstructs itself, records explicitly scoped to another repository, unapproved metadata, and content fenced with `<private>...</private>`. CI verifies the manifest digest and rejects common credential patterns before assembling an artifact.

Do not manually place raw connector exports, SQLite databases, OAuth credentials, or private transcripts in this directory.
