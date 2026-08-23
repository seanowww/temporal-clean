# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: Next.js and TypeScript for the dashboard, API routes, connector webhooks, and artifact delivery; PostgreSQL is the intended production graph store.

## Users

QA engineers reviewing pull requests are the primary users. Developers, engineering leads, and company administrators contribute or govern the context QA can inspect.

## Product Purpose

Temporal reconstructs how a pull request came to exist across code, agent sessions, workplace conversations, and planning documents. Success means QA can understand a material decision absent from the diff and turn it into a concrete verification step.

## Positioning

Temporal is the provenance layer above code review: it explains why code reached its current form by traversing a permission-aware graph of the work that preceded the PR.

## Operating Context

Company administrators approve GitHub, Slack, Claude Code, Codex, Notion, and future connections. Sources continuously populate a provenance graph. Opening or updating a PR triggers a bounded traversal, evidence-backed synthesis, artifact generation, and delivery of the artifact link to the PR.

## Capabilities and Constraints

- GitHub is the anchor for repositories, branches, commits, changed files, authors, and PR lifecycle events.
- Source records remain immutable and distinct from derived summaries.
- Every generated claim must cite accessible evidence.
- Traversal is bounded by repository, time, participant, confidence, and permissions.
- Artifacts are versioned when PR evidence changes.
- The first vertical slice uses GitHub and Claude Code before adding Slack and Notion.
- Source access must be enforced during traversal, not only when rendering.

## Brand Commitments

The product is named Temporal. The existing galaxy-like branch monitor, vertical timeline, source logos, floating nodes, pruned branches, and source-native record drawer are binding interface assets for the artifact experience.

## Evidence on Hand

- `CHAT_LOG.md`: product framing, seeded narrative, and prototype decisions.
- `temporal-prototype.html`: working artifact renderer.
- `temporal-claude-chat.png`, `temporal-slack-chat.png`, and `temporal-timeline.png`: verified reference captures.
- No customer claims, production benchmarks, or security certifications exist yet and must not be fabricated.

## Product Principles

- Evidence before inference.
- Recover decisions that the diff cannot carry.
- Show less context, but make every surfaced record consequential.
- Preserve source permissions and provenance.
- Build backward from the QA verification action.

## Accessibility & Inclusion

The web experience must support keyboard operation, reduced motion, visible focus, responsive layouts, and text alternatives for source and graph controls.
