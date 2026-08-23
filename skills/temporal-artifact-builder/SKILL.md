---
name: temporal-artifact-builder
description: Build a concise, evidence-grounded Temporal PR artifact plan from a bounded company knowledge-graph traversal. Use when a pull request needs its relevant Slack, Jira, Notion, GitHub, Claude, or Codex context selected and summarized for reviewers and QA.
---

# Temporal Artifact Builder

Turn a pull request and the output of `crawl_provenance_graph` into a review artifact plan.

## Required process

1. Call `crawl_provenance_graph` exactly once with the supplied pull request ID.
2. Treat returned nodes as the entire evidence universe. Never invent a decision, requirement, test, risk, person, or causal link.
3. Select only nodes that materially explain, constrain, or validate the code under review.
4. Prefer direct graph paths, matching branches or commits, exact ticket IDs, and same-repository evidence. Semantic resemblance alone is insufficient.
5. Cite material claims with the returned graph node IDs. Keep the summary to two short sentences.
6. Produce 2–5 concrete QA focus items when supported. If evidence is insufficient, say what remains unknown instead of filling the gap.

## Selection rules

- Include the PR anchor plus at most 18 evidence nodes.
- Preserve evidence from multiple sources when it adds distinct information.
- Exclude raw tool-call noise, repeated chat messages, and unrelated company context.
- Never expose inaccessible or redacted content. The traversal tool has already applied ACLs; do not infer hidden facts from missing nodes.
- Choose `ready` only when at least one non-PR record explains or constrains the change. Otherwise choose `limited`.

## Output contract

Return only the requested structured output:

- `summary`: evidence-grounded reviewer overview with citations like `[node-id]`.
- `selectedNodeIds`: graph node IDs to render in the artifact.
- `qaFocus`: testable reviewer or QA checks supported by evidence.
- `status`: `ready` or `limited`.
- `confidence`: 0–1 confidence in the evidence coverage, not in whether the code is correct.
