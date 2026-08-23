---
name: Temporal
description: A provenance operations console that turns fragmented company activity into a reviewable path to code.
colors:
  void: "#06060f"
  surface: "#0b0918"
  surface-raised: "#100d21"
  ink: "#e9e6f7"
  ink-dim: "#a49dc0"
  ink-faint: "#817a98"
  line: "rgba(155, 145, 210, 0.16)"
  line-bright: "rgba(155, 145, 210, 0.28)"
  path-gold: "#e8b84b"
  evidence-cyan: "#4de3e8"
  agent-violet: "#a87bff"
  pruned-red: "#ff4d6d"
  ready-green: "#5ee6a8"
  path-rose: "#ff6b8a"
  github-accent: "#f2f0f7"
  slack-accent: "#36c5f0"
  jira-accent: "#2684ff"
  notion-accent: "#e9e6f7"
  claude-accent: "#d97757"
  codex-accent: "#a87bff"
typography:
  display:
    fontFamily: "Saira Condensed, IBM Plex Sans, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
  headline:
    fontFamily: "Saira Condensed, IBM Plex Sans, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.05em"
  title:
    fontFamily: "Saira Condensed, IBM Plex Sans, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.035em"
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "0.12em"
  connector-title:
    fontFamily: "Saira Condensed, IBM Plex Sans, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.025em"
  micro-label:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.07em"
rounded:
  control-tight: "2px"
  action: "3px"
  navigation: "4px"
  source-record: "12px"
  connector-logo: "15px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  compact: "14px"
  md: "18px"
  lg: "22px"
  xl: "28px"
  2xl: "34px"
components:
  selection-action:
    backgroundColor: "rgba(77, 227, 232, 0.11)"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    padding: "0 13px"
    height: "44px"
  selection-action-hover:
    backgroundColor: "rgba(77, 227, 232, 0.18)"
    textColor: "{colors.ink}"
    rounded: "{rounded.action}"
  rail-toggle:
    backgroundColor: "rgba(16, 13, 33, 0.72)"
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.action}"
    size: "44px"
  pr-choice:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "16px 13px"
    height: "132px"
  filter-chip:
    backgroundColor: "rgba(12, 10, 26, 0.60)"
    textColor: "{colors.ink-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 13px 8px 11px"
    height: "44px"
  source-record:
    backgroundColor: "#f7f7f8"
    textColor: "#222222"
    rounded: "{rounded.source-record}"
  connector-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.connector-title}"
    rounded: "{rounded.navigation}"
    padding: "22px"
    height: "188px"
  connection-field:
    backgroundColor: "rgba(6, 6, 15, 0.72)"
    textColor: "{colors.ink}"
    typography: "{typography.micro-label}"
    rounded: "{rounded.action}"
    padding: "0 12px"
    height: "42px"
---

# Design System: Temporal

## Overview

**Creative North Star: "The Provenance Constellation"**

Temporal is a void-black operations console where scattered work resolves into an inspectable path. The system pairs the scanability of an engineering control room with the spatial memory of a star chart: gold marks the path that shipped, cyan exposes live evidence, violet identifies agent activity, and red preserves consequential work that was pruned rather than erased.

The authenticated dashboard makes that memory spatial. An Obsidian-like provenance field owns the full-height canvas, framed by a compact source rail and a collapsible pull-request index. Selecting a PR lights one evidence-colored path, quiets unrelated context, and raises the artifact action above the graph. The Connections surface is the focused setup exception: a compact source-native logo-card catalog opens one inline import workbench without leaving the page. The artifact renderer remains the deeper reading environment, intensifying the same world with luminous branches, a glass evidence drawer, and source-native record reconstructions. None of these surfaces should drift into a generic integration dashboard or generic cyberpunk ornament.

**Key Characteristics:**

- Void-black canvases with quiet violet tonal layering.
- Sacred gold paths, cyan evidence signals, violet agent state, and red pruned branches.
- Condensed uppercase operating headlines, neutral sans-serif reading text, and mono provenance labels.
- A graph-first shell framed by collapsible instrument rails rather than a card dashboard.
- Fine structural rules, sparse glows, circular graph nodes, and tightly squared 44px controls.
- Source-native logos and record treatments preserved inside the shared Temporal frame.
- A deliberate three-column connector catalog that collapses to two and one columns before opening an inline source workbench.

## Colors

The palette is a near-black field activated by a small set of semantic luminous channels; color is evidence, not decoration.

### Primary

- **Sacred Path Gold** (#e8b84b): Marks the shipped spine, pull-request identifiers, the brand mark, current-time ticks, and other authoritative path cues.

### Secondary

- **Evidence Cyan** (#4de3e8): Identifies live divergence, retained evidence, keyboard focus, graph connections, and the primary “Open artifact” action.
- **Agent Violet** (#a87bff): Identifies agent sessions, the active navigation state, and secondary graph energy.
- **GitHub Accent** (#f2f0f7): Keeps GitHub’s near-white mark distinct on the void while tinting its connector card and workbench.
- **Slack Accent** (#36c5f0): Carries Slack’s cyan identity through its connector mark, selection edge, and setup focus state.
- **Jira Accent** (#2684ff): Carries Jira blue through its connector mark, selection edge, and setup focus state.
- **Notion Accent** (#e9e6f7): Preserves Notion’s paper-white identity against the console field.
- **Claude Accent** (#d97757): Preserves Claude Code’s warm terracotta identity in imports and source setup.
- **Codex Accent** (#a87bff): Uses the shipped violet identity for Codex task transcripts and implementation decisions.

### Tertiary

- **Pruned Branch Red** (#ff4d6d): Flags abandoned timelines, unavailable scopes, drift, and attention states without implying that the evidence should be deleted.
- **Ready Green** (#5ee6a8): Reserved for operational availability, connected sources, and completed artifact state.
- **Path Rose** (#ff6b8a): One rotating PR-selection channel; it has no global status meaning outside the dashboard path palette.

### Neutral

- **Operational Void** (#06060f): The uninterrupted application and artifact background.
- **Deep Console Surface** (#0b0918): A quiet violet-black layer for rail chrome and inset regions.
- **Raised Console Surface** (#100d21): Supports source icons and subtly separated controls.
- **Primary Ink** (#e9e6f7): Carries high-confidence labels and readable content.
- **Dim Ink** (#a49dc0): Carries secondary explanations and metadata that remain important.
- **Faint Ink** (#817a98): Carries tertiary timestamps, scopes, and non-primary navigation while retaining sufficient contrast at the dashboard’s 10px legend size.
- **Structural Line** (rgba(155, 145, 210, 0.16)): Defines grids and component boundaries without introducing card chrome.
- **Bright Structural Line** (rgba(155, 145, 210, 0.28)): Marks section starts and interactive emphasis.

### Named Rules

**The Evidence Channel Rule.** Artifact channels keep their semantic jobs; the dashboard may reuse the luminous palette only to assign each indexed PR a stable, unique path color.

**The Source-Native Rule.** GitHub (#f2f0f7), Slack (#36c5f0), Jira (#2684ff), Notion (#e9e6f7), Claude Code (#d97757), and Codex (#a87bff) keep their shipped identity accents inside the Temporal frame; never recolor every source into a single house accent.

**The Quiet Void Rule.** Most pixels remain void or neutral ink. Luminous accents stay scarce enough that readiness, evidence, and drift are immediately recognizable.

## Typography

**Display Font:** Saira Condensed (with IBM Plex Sans and sans-serif fallback)
**Body Font:** IBM Plex Sans (with ui-sans-serif and system-ui fallback)
**Label/Mono Font:** IBM Plex Mono (with monospace fallback)

**Character:** Saira Condensed gives the interface a narrow, instrument-panel authority without sacrificing word shape. IBM Plex Sans handles factual reading, while IBM Plex Mono makes provenance, identifiers, time, scope, and system state feel machine-addressable.

### Hierarchy

- **Display** (700, display token, 1 line-height): Artifact identity and the strongest brand readout; uppercase with deliberate tracking.
- **Headline** (700, headline token, 1.1 line-height): Dashboard masthead and major operational titles; uppercase.
- **Title** (600, title token, 1.2 line-height): Section headings and evidence drawer titles.
- **Body** (400, body token, 1.5 line-height): Pull-request titles, descriptions, and explanatory copy.
- **Label** (500, label token, 0.12em tracking): Status, repository, source, timestamp, count, and provenance metadata; usually uppercase and tabular where numeric.
- **Connector Title** (600, connector-title token, 1.2 line-height): Source names in the repeated connector catalog; condensed but sentence case for fast scanning.
- **Micro Label** (400, micro-label token, 1.45 line-height): Connector modes, field labels, small instructions, and operational setup metadata; uppercase only when it names state or field purpose.

### Named Rules

**The Three-Voice Rule.** Use condensed type for command and hierarchy, sans-serif for comprehension, and mono only for provenance or machine state.

**The Operational Case Rule.** Uppercase belongs to short headings, labels, and controls. Sentences, PR titles, and evidence explanations remain sentence case.

## Layout

The dashboard is a full-height three-part instrument: a 76px connection rail, a fluid graph field, and a 340px open PR rail. The left rail expands to 214px to reveal source names and connection state; the right rail collapses to 64px while retaining quick PR selectors. The company-memory title floats at the graph’s top edge, the legend stays low and quiet, and the contextual artifact dock floats above the field only while a PR is selected. The graph—not navigation, metrics, or a queue—owns the first viewport.

At 900px the PR rail narrows to 290px and the selection dock reflows its artifact action beneath the title. At 680px the dashboard becomes graph-first with a persistent 58px source rail. The PR rail becomes a right-side overlay up to 330px wide; when closed, a visible 54px trigger labeled “PR” remains. The dock avoids that trigger and stacks into a compact two-column block. Every rail control and primary action keeps a minimum 44px target, including the add-connection control and both collapse toggles.

The artifact renderer is an immersive, fixed-viewport field rather than a dashboard grid. A persistent HUD and footer frame a vertically traversable graph; the right-side evidence drawer overlays the field without replacing its spatial context. Its source labels alternate around the spine and compress below 900px.

The Connections surface uses a centered 1180px catalog with three equal logo-card columns and a compact 13px gutter. It collapses to two columns at 900px and one column at 680px. Selecting a connector reveals one full-width workbench 24px below the catalog; its 230px source introduction and fluid fields become one column at 900px, then each field and action stacks at 680px.

Spacing follows a compact 8–34px operational rhythm. Use rails, lines, alignment, and shared baselines to structure the field before adding containers.

**The Graph-Owns-the-Canvas Rule.** On the dashboard, connections live quietly at left, PR history lives at right, and the selected evidence path plus its artifact action own the center.

**The Visible-PR-Trigger Rule.** Mobile may hide the PR list, but never the labeled control that opens it.

**The Three-to-One Connector Rule.** The user-approved connector catalog is explicitly three columns on wide screens, two at 900px, and one at 680px; preserve that sequence and keep the selected workbench inline below it.

## Elevation & Depth

The dashboard is flat by default. Depth comes from translucent rail chrome, nested violet-black tones, one-pixel borders, a restrained radial aura, and evidence-colored selection glows rather than stacked cards. The artifact renderer introduces stronger spatial depth through luminous graph channels, haloed nodes, a vignette, source screenshots, and a blurred evidence drawer. These effects represent provenance layers and interaction state, not decorative elevation.

### Shadow Vocabulary

- **Signal Glow** (`0 2px 8px currentColor` to `0 3px 12px rgba(77, 227, 232, 0.45)`): Small dots and graph nodes indicating live or categorized state.
- **Selected Path Glow** (`drop-shadow(0 2px 5px var(--selection))`): Illuminates only the graph edges belonging to the selected PR.
- **Selection Dock Lift** (`0 16px 52px rgba(0, 0, 0, 0.38), 0 5px 22px color-mix(in srgb, var(--selection) 13%, transparent)`): Keeps the contextual action legible above the constellation.
- **PR Overlay Separation** (`-28px 0 70px rgba(0, 0, 0, 0.45)`): Separates the mobile PR sheet from the graph without obscuring the relationship between them.
- **Dragged Node Lift** (`0 7px 22px color-mix(in srgb, var(--node-color) 58%, transparent), 0 18px 48px rgba(0, 0, 0, 0.42)`): Raises only the dashboard node under direct manipulation; the `.42` black shadow is intentional physical separation from the constellation, paired with the node’s semantic-color glow.
- **Evidence Node Halo** (`0 0 14px var(--c), 0 0 38px color-mix(in srgb, var(--c) 55%, transparent)`): Gives graph records their source-channel energy; expands on hover, focus, drag, and active state.
- **Drawer Separation** (`-40px 0 90px rgba(0, 0, 0, 0.55)`): Separates the evidence record from the graph without making it feel like a separate product.
- **Source Record Lift** (`0 18px 45px rgba(0, 0, 0, 0.32)`): Used only for source-native screenshot reconstructions inside the drawer.
- **Connector Logo Lift** (`0 10px 28px color-mix(in srgb, var(--connector) 9%, transparent)`): Gives each source mark a quiet native-color seat inside its card.
- **Connector Workbench Lift** (`0 22px 70px rgba(0, 0, 0, 0.20)`): Separates the active setup panel from the catalog without turning it into a modal.

### Named Rules

**The Flat Console Rule.** Dashboard surfaces stay flat at rest; glow appears only for live state, a selected evidence path, focus, or the contextual artifact action.

**The Provenance Depth Rule.** Stronger depth belongs to the artifact’s evidence layers, where spatial separation helps the user follow a recovered decision path.

## Shapes

Temporal contrasts circular evidence geometry with squared operational controls. Dashboard graph nodes, source wells, collapsed PR selectors, live indicators, status dots, and artifact filter chips are circular or pill-shaped. Rail toggles, PR records, selection docks, connector cards, workbenches, action buttons, drawers, and text evidence blocks use tight 2–4px corners. Source-native record reconstructions use a broad 12px radius to preserve the originating tool’s grammar; the Connections surface intentionally uses a distinct 15px soft-square radius only for the 58px logo wells. Its cards and workbench stay at 4px, while fields and actions step down to 3px.

Thin violet rules are the default boundary. Dashboard PR nodes use dashed gold edges; selected nodes intensify scale and glow while unrelated nodes desaturate and fade. Artifact pruned records retain dashed circular edges. The gold brand mark uses a clipped six-sided seal, giving the dashboard one recognizable non-circular silhouette.

**The Two-Geometries Rule.** Circles describe evidence in the graph; tight rectangles describe actions and operational structure.

**The Source Badge Rule.** The 15px connector-logo radius belongs to compact source identity, not general containers; do not spread it to cards, fields, or the graph shell.

## Components

### Buttons

- **Shape:** Rail toggles and the artifact action are compact, nearly square controls with 3px corners. Add-connection and collapsed PR selectors use circular silhouettes. All primary rail controls are at least 44px in both interactive dimensions.
- **Primary:** The selected PR’s ready artifact link inherits that PR’s evidence color in its border and translucent field, uses a condensed uppercase label, and keeps a 44px minimum height.
- **Hover / Focus:** Hover strengthens the evidence-colored field. Keyboard focus uses a 1px cyan outline with 3px offset. Reduced-motion mode collapses state transitions and node drift to effectively instant.
- **Secondary / Disabled:** Pending or limited artifacts become text states inside the dock rather than weakened fake buttons. Rail toggles use a translucent raised-console field and structural border.

### Chips

- **Style:** Artifact source filters are 44px pill controls with mono uppercase labels, a source-native icon or luminous channel dot, a translucent console field, and a thin structural border.
- **State:** Selected chips keep their channel identity. Unselected chips soften text and borders and desaturate source marks without removing them.

### Cards / Containers

- **Corner Style:** PR choices remain unboxed records between horizontal rules; source-native reconstructions use the source-record radius.
- **Background:** Dashboard grouping relies on the void, translucent rails, and a single floating selection dock. The Connections page alone uses a logo-card catalog with a faint source-tinted diagonal field. The artifact drawer uses translucent glass; embedded records return to their source’s light or native surface.
- **Shadow Strategy:** Flat in the dashboard; refer to Provenance Depth for graph nodes, the drawer, and source records.
- **Border:** One-pixel structural rules, brighter only at section starts or interactive emphasis.
- **Internal Padding:** Compact 14–28px padding based on information density and hierarchy.

### Connection Rail

The left instrument rail is collapsed by default. Each approved source appears as a 46px circular, source-native mark with a green connection dot; expansion reveals the source name and status without changing the graph. “Add connection” remains visibly available at the rail foot as a dashed circular plus control. On mobile, source names disappear but each control remains at least 44px.

### Connector Logo-Card Grid

GitHub, Slack, Jira, Notion, Claude Code, and Codex each occupy a 188px-minimum card in the explicit three-column catalog. Every card pairs a 58px soft-square native-color logo well with a 19px condensed source name, quiet descriptive text, a top-right 9px mono state, and a 10px mono mode anchored at the foot. Hover and selection lift the card by 2px and strengthen its source-tinted field; selection also resolves a 2px source-color rule along the bottom. The dashed Custom connectors card is informational and never impersonates an enabled action.

### Inline Connector Workbench

Selecting one connector opens its setup workbench directly below the catalog; selecting it again closes the panel. The selected source accent governs the border, logo well, focus state, primary action, and progress copy. Repository and branch are optional 42px fields, while the export field accepts pasted JSON, JSONL, Markdown, or text and can be populated from a local file. Authenticated sources expose API sync as a secondary action. Known formats are parsed deterministically; unknown text is preserved as auditable source evidence instead of being silently interpreted or discarded. Success reports the exact record and relationship counts returned by import.

### Pull Request Rail

The right rail indexes PR history as tall, line-separated buttons. Each record carries an evidence color, PR number, status dot, human title, repository and author, node count, and update time. Selecting a record turns on its graph path; selecting it again clears the path. The collapsed desktop rail keeps up to five circular numeric selectors. Mobile uses a labeled “PR” trigger and opens the full list as an overlay.

### Dashboard Constellation

Source-colored nodes drift gently over a quiet violet aura. Labels reveal on hover or keyboard focus. Every node presents a `grab` cursor at rest and a `grabbing` cursor, stronger scale, semantic-color glow, and Dragged Node Lift while pointer-captured. The node stays within the visible constellation bounds as it follows the pointer, and every attached edge follows its live position so provenance relationships never detach visually. Pointer cancel or lost pointer capture safely ends the grab and hands the node back to its return behavior; no interrupted gesture may strand a node in a dragging state.

Release hands the clamped pointer velocity into bounded local repulsion and a damped spring that returns the node to its deterministic authored home position. Repulsion only resolves nearby overlap and never turns the constellation into a free-running force layout. Focused nodes accept Arrow keys as bounded directional nudges with attached edges following the move; Enter or Home provides keyboard reset parity with double-click and returns immediately to home. Reduced-motion pointer release also snaps immediately to home with no inertial or spring travel. The physics loop runs only while a node is displaced or moving, stops after the graph settles, pauses while the document is hidden, and wakes when direct manipulation, a keyboard nudge, or visibility requires it.

Selecting a PR changes related edges and nodes to that PR’s unique evidence color, increases selected-node scale and halo, and reduces unrelated context to low opacity and saturation. The 10px mono legend distinguishes linked evidence from ambient company context with dim ink that remains readable against the void.

### Selection Dock

The dock is contextual, not persistent chrome. It appears above the graph only with a selected PR and carries number, title, related-node and source counts, artifact state, and the artifact action. Its border, glow, and ready action inherit the selected path color. On mobile it remains clear of the visible PR trigger.

### Artifact Evidence Graph

The artifact renderer keeps its authored vertical chronology, circular source-colored evidence nodes, luminous semantic branches, and pruned dashed records. Hover, focus, drag, or active state scales the orb and strengthens its halo. Nodes may move under direct manipulation but return to the authored temporal structure.

### Evidence Drawer

The right-side drawer is a translucent, blurred console layer with a source-colored badge, precise timestamp, evidence rationale, excerpt, and QA verification prompts. Slack and Claude records render as deterministic, source-native reconstructions within the drawer rather than generic quote cards.

## Do's and Don'ts

### Do:

- **Do** make the ready artifact the clearest action in the selected-PR dock.
- **Do** let the company-memory graph own the dashboard’s first viewport.
- **Do** light one uniquely colored PR path at a time and dim unrelated context.
- **Do** keep the add-connection plus and mobile “PR” trigger visibly discoverable.
- **Do** preserve semantic color across graph edges, nodes, status dots, focus, and supporting labels.
- **Do** keep every surfaced claim attached to readable source, timestamp, and consequence.
- **Do** use thin rules and alignment to organize dense operational information.
- **Do** preserve source-native marks and record styling inside the Temporal evidence drawer.
- **Do** support keyboard focus, 44px rail targets, a readable 10px graph legend, the mobile PR overlay, and reduced motion.
- **Do** keep dashboard node movement reversible: attached edges follow pointer and Arrow-key nudges, release rejoins the authored constellation, double-click/Enter/Home reset, lost capture ends safely, and reduced-motion pointer release snaps home.
- **Do** keep the Connections catalog at three, two, then one column and carry each source’s native accent from card selection into its inline workbench.
- **Do** make import outcomes deterministic and auditable: parse known formats, preserve unknown text, and report returned record and relationship counts.

### Don't:

- **Don't** turn the dashboard into a grid of interchangeable rounded cards.
- **Don't** replace the graph-first shell with a conventional navigation-and-queue dashboard.
- **Don't** leave the artifact action floating when no PR path is selected.
- **Don't** use glow, gradients, or star-field effects without a provenance or state meaning.
- **Don't** flatten gold, cyan, violet, red, and green into interchangeable accents.
- **Don't** style source evidence as if Temporal authored it.
- **Don't** hide pruned work merely because it did not reach the diff.
- **Don't** let connection management or the PR index visually overpower the constellation.
- **Don't** apply the dashboard’s no-card-grid rule to the user-approved Connections catalog, or apply the Connections grid back onto the graph dashboard.
- **Don't** turn the Custom connectors placeholder into active-looking affordance until it has a real workflow.
