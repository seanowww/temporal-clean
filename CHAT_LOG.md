# Temporal — Session Log

**Date:** 2026-08-21
**Context:** YC × Greptile hackathon. Task: build a dev tool.
**Outcome:** Pitch stress-tested; interactive prototype artifact built.

Assistant turns are condensed but faithful to what was said. Tool calls, code
dumps, and verification output are omitted.

---

## 1. Framing

**Assistant:** Greptile's whole thing is codebase understanding for PR review, so a
dev tool hackathon with them probably rewards ideas that lean into code
comprehension, not just another wrapper. Asked for: the core idea, who it's for
and what pain it solves, and the tech approach — then offered to stress-test it
on three axes (differentiation vs. Greptile/Cursor, hackathon feasibility, and
whether the "why now" holds).

---

## 2. The pitch

**User:**

> pain point -> ai agents have been so fast now the bottleneck is human QA and
> comprehension to pass the code into prod.
>
> PR reviews are very one dimensional, ai gives insights, QA has to communicate
> with SWE.
>
> back in TikTok I always pushed stuff, then QA will have to ask me additional
> questions on decisions I made a while ago.
>
> So the our pitch:
>
> **Temporal**, a PR Review System QAs can see that is done by keeping a timeline
> of activities done by the dev leading up to the PR. Visualised all history, not
> just git:
>
> - codex / claude / cognition
> - notion
> - slack
> - important concepts grouped together
> - unimportant concepts are smaller
> - understanding focused
>
> For example:
>
> - 7 days ago: PM receives problem from user feedback
> - 6 days ago: senior engineer drafts out solution and plan, hands it to jnr Eng
> - 5 days ago: jnr Eng works on it, finds an issue in Claude Code, feeds back to
>   snr Eng, snr approves
> - 3 days ago: another minor design fork which causes change in plan, engineer
>   only thought to discuss it in cc
> - 1 day ago: deployment delay due to another engineer pushing
> - PR.
>
> QA will not have this context without temporal.

---

## 3. Stress test

**Assistant:**

**Strong idea — it comes from a real scar.** The "wait, why did you do it this
way" DM from QA three days after you already forgot the tradeoff. That
specificity lands better with judges than 90% of "AI PR reviewer" submissions.

**Differentiation is the strength; lean into it.** Greptile and most PR tools
answer *what changed and is the code good* — code-level, single-snapshot.
Temporal answers *why did the code end up this way, across a week of human +
agent decisions*. That's orthogonal, not competitive — a good story to tell at a
Greptile-sponsored hackathon. Frame it as "the missing timeline layer above code
review," not "a better Greptile."

**Scope is the real risk, not the idea.** Slack + Notion + Claude Code / Codex /
Cognition + git is 4–5 integrations. In a 24–36h build you will not get clean
OAuth for all of them *and* the importance-weighting and visualization, which is
the actual demo payoff. Cut hard:

- One real agent source (Claude Code session logs are local JSON — easiest to
  grab for real). Mock Cognition/Codex as "coming soon" logos.
- Git commits + PR description: real, easy, free timestamps.
- Slack/Notion: a thin real integration (single channel export) or seeded.

**The hard technical problem is the importance clustering, not ingestion.**
Deciding "this Slack message is a footnote, this one is the decision that
explains a design fork." One well-prompted LLM pass emitting
`{event, timestamp, source, importance_score, one-line why}` is enough to drive
the visualization for a demo.

**Build backward from one interaction.** QA opens a PR → sees the timeline →
clicks the "minor design fork" bubble → sees the actual Claude Code exchange
where the call was made → says "oh, *that's* why" out loud. That reaction is the
whole pitch. Make it rock solid even if everything else is a stub.

**Naming flag.** "Temporal" collides with Temporal.io, a well-known workflow
orchestration company — could confuse judges searching for you.

---

## 4. Deliverable format

**User:** one more thing, the final PR will be a html artifact

**Assistant:** Right format — judges click a live timeline instead of watching
slides. Recommended: PR anchor at top (diff summary, files changed) so judges
know what they're looking at; timeline below with grouped/sized nodes; click a
node to expand its source; the "aha" reachable in one click from first load.
Static, pre-seeded data rather than live API calls during the pitch — lower risk,
and judges only ever see the payoff, not the plumbing. Single self-contained HTML
file, no server dependency, for when the venue wifi breaks.

---

## 5. Prototype request

**User:**

> I need your help to prototype ONLY the artifact. no need for integrations or
> anything, i just want to test it. make it futuristic, galaxy-esque, with various
> timelines like in the final episode of Loki.

Supplied a **React Bits Pro "Synaptic Shift"** component (React Three Fiber +
three.js, neural-network-like connection animations) as the intended background,
with full source and a note to adapt it.

### Design plan

- **Palette:** void `#06060f`, nebula violet `#7B5CFF`, sacred-line gold
  `#E8B84B`, branch cyan `#4DE3E8`, pruned crimson `#FF4D6D`, text `#E9E6F7` /
  muted `#8B85A6`. Single deliberate dark world, painted explicitly.
- **Type:** `Saira Condensed` display (uppercase, tracked — TVA-institutional),
  `IBM Plex Sans` body, `IBM Plex Mono` for data and source excerpts.
- **Layout:** full-bleed WebGL nebula; time axis 7 days ago → PR; gold "shipped"
  spine with cyan branches that either rejoin or get **pruned** (crimson).
  Orb size = importance. Click → glass drawer with the source excerpt.

### What was built (v1, horizontal)

- **Synaptic Shift ported from React Three Fiber to raw WebGL** — same shader
  math, no three.js, no build step, zero dependencies. Tuned down (violet, low
  intensity) so it reads as atmosphere rather than competing with the data.
- Gold spine = shipped path; cyan = divergences that rejoin; **crimson dashed =
  pruned timelines**, work that happened and never reached the diff.
- Orb radius scales with importance; minor events hide their labels until hover.
- **"Replay 7 days"** — a temporal cursor sweeps across and ignites the timeline
  as it passes. Runs once on load.
- Click a node → drawer with the source excerpt (Slack thread, Claude Code
  transcript, Notion doc, commit) plus **"Why this matters to QA"** and
  **"What to verify"**.
- Source filter chips — killing Claude Code + Codex visibly guts the timeline.
  Live demo move: *this is what your PR review sees today.*

### Seeded narrative

The TikTok story made concrete, on a bulk-export PR:

| When | Source | Event |
|---|---|---|
| 7.2d | Slack | Support escalates: exports silently truncate |
| 6.4d | Notion | Sr. eng drafts remediation plan (never updated after day 3) |
| 6.1d | Slack | Handoff to junior with scope guardrails |
| 5.6d | Git | Spike branch: cursor pagination |
| 5.2d | Claude Code | **Agent session finds the planned approach is fatally broken** |
| 5.0d | Slack | Escalation — branch pruned |
| 4.8d | Slack | New direction approved verbally, nowhere else |
| 4.1d | Git | Implementation commits |
| 3.8d | Codex | Generated tests — happy path only |
| 3.1d | Claude Code | **Undocumented design fork: key derivation changed, schema consequences** |
| 2.8d | Git | Migration lands |
| 2.3d | Git | Fork merged back |
| 2.1d | Notion | Plan doc now stale — two reversals unrecorded |
| 1.1d | Slack | Deploy slot lost to unrelated push (pruned) |
| 0.15d | Git | PR #4471 opened, description mentions none of it |

Two additions beyond the original spec, flagged for the user to keep or cut:

1. **Documentation drift flags** — Temporal knows the Notion doc predates two
   design reversals and tells QA *not to review against it*. Turns it from "nice
   timeline" into something that prevents false QA failures.
2. **Pruned branches** — showing abandoned work answers "why didn't you just do
   what the spec said," which is exactly the TikTok question.

### Design-hook fixes

- Context meter was animating `width` → now `transform: scaleX()` (it repaints
  every sweep frame, so this mattered).
- Orb hover was overshooting its target scale → now ease-out-expo. Reads as a
  light source coming up to power rather than a springy pop.

---

## 6. Revision — vertical graph

**User:** can you make the nodes arranged vertically, make the nodes hover a bit
like obsidian's knowledge graph, and draggable, but they will go back to original
position

**Assistant:** Rebuilt the layout and added a small physics loop.

**Vertical.** Time runs top (7d ago) → bottom (PR opened). Gold spine drops down
the center; branches swoop left (pruned spike) and right (design fork). Labels
sit beside their orbs with a `5.2d before PR` stamp. Day markers in the left
gutter. The field scrolls; spacing is time-proportional with a minimum gap so
nothing collides — real elapsed time still shows in the gaps.

**Obsidian-style behaviour, three parts:**

- **Idle drift** — every node wanders on its own sine phase; smaller/less
  important nodes wander further, so the graph breathes at rest. Edges redraw
  against live positions each frame, so filaments stretch and flex with them.
- **Neighbour highlight** — hovering drops everything unconnected to 20%,
  threads included. Hovering the day-3 fork isolates exactly the chain that
  produced the schema migration.
- **Drag with spring-back** — grab an orb and throw it; on release it springs
  home with one soft overshoot (~1s settle), `K = 0.055`, damping `0.86`. A
  pointer that moves under 5px counts as a click and opens the record instead, so
  dragging never fights the drawer.

**Replay** now sweeps top→bottom and auto-scrolls the field to follow the cursor
down through the week.

**Verified headless** (Playwright, no console errors). Two issues it surfaced,
both fixed:

- Missing `charset` declaration was mangling `·` and `—` into mojibake.
- Nebula was bright enough on the left to compete with branch labels — dropped
  from 85% to 55% opacity.

Reduced-motion path: no drift, no sweep, drag snaps home instantly.

---

## Open questions (unanswered)

1. **Branch geometry** — currently orthogonal swoops off a spine. The Loki finale
   is more *radial*, filaments fanning from a center. Radial looks more like the
   show but reads time-order worse.
2. **Density** — 15 events reads well. Denser (30+) would give the
   importance-sizing more visible work and more "overwhelming archive" energy.
3. **Palette semantics** — gold-shipped / crimson-pruned encodes meaning. Colder
   and more uniform (all cyan/violet) would read more TVA-screen, at some cost to
   legibility.
4. **The name** — "Temporal" collides with Temporal.io.

## Artifact

- Source: `temporal-prototype.html` (single file, no dependencies, no build)
- Published: https://claude.ai/code/artifact/7811eca8-147f-4080-9750-8fd49865b775
