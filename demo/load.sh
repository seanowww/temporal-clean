#!/usr/bin/env bash
# Load the prepared demo evidence for the golden PR. See demo/README.md — these are
# labelled fixtures, not live captures.
set -euo pipefail

ENDPOINT="${TEMPORAL_ENDPOINT:-http://localhost:3000}"
REPO="${GOLDEN_REPO:-seanowww/temporal-golden-demo}"
BRANCH="${GOLDEN_BRANCH:-johnny/waitlist-signup}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

post() {
  local source="$1" file="$2"
  jq -n --arg content "$(cat "$file")" --arg filename "$(basename "$file")" \
        --arg repository "$REPO" --arg branch "$BRANCH" \
        '{content:$content, filename:$filename, repository:$repository, branch:$branch}' \
  | curl -sS -X POST "$ENDPOINT/api/connections/$source/import" \
      -H 'Content-Type: application/json' --data-binary @- \
  | jq -c '{source, records, edges, linkedPullRequestIds}'
}

echo "→ Jira"
post jira "$HERE/jira-waitlist-ticket.json"
echo "→ Slack"
post slack "$HERE/slack-exports-channel.json"
echo "→ Claude Code"
post claude "$HERE/claude-session.jsonl"
