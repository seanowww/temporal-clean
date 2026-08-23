"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Connection, PullRequestRecord } from "@/lib/types";
import { stepGraphPhysics, type PhysicsBody } from "@/lib/graph-physics";

type GraphNode = { id: string; source: string; type: string; title: string; relatedPullRequestIds: string[] };
type GraphEdge = { from: string; to: string; type: string };
type DashboardClientProps = {
  workspace: { id: string; name: string };
  connections: Connection[];
  pullRequests: PullRequestRecord[];
  graphHealth: { records: number; linkedSessions: number; unlinkedSessions: number; sourceCoverage: number };
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  synthetic: boolean;
};

const prColors = ["#4de3e8", "#e8b84b", "#a87bff", "#ff6b8a", "#5ee6a8"];
const sourceNames: Record<string, string> = { github: "GitHub", git: "GitHub", claude: "Claude Code", slack: "Slack", notion: "Notion", codex: "Codex" };

function SourceLogo({ source }: { source: string }) {
  const id = source === "git" ? "github" : source;
  const paths: Record<string, ReactNode> = {
    github: <path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.46.08.63-.2.63-.45v-1.77c-2.56.56-3.1-1.09-3.1-1.09-.42-1.07-1.03-1.35-1.03-1.35-.84-.58.06-.57.06-.57.93.07 1.42.96 1.42.96.83 1.42 2.17 1.01 2.7.77.08-.6.32-1.01.59-1.24-2.05-.23-4.2-1.02-4.2-4.55 0-1 .36-1.83.95-2.47-.1-.23-.41-1.17.09-2.44 0 0 .77-.25 2.53.94A8.8 8.8 0 0 1 12 7.13a8.7 8.7 0 0 1 2.3.31c1.76-1.19 2.53-.94 2.53-.94.5 1.27.19 2.21.1 2.44.59.64.94 1.46.94 2.47 0 3.54-2.16 4.31-4.21 4.54.33.29.62.85.62 1.72v2.58c0 .25.17.54.63.45A9.2 9.2 0 0 0 12 2.8Z" fill="currentColor" />,
    claude: <path d="m12 2.3 1.45 7.03 4.82-5.32-3.37 6.34 6.8-2.33-6.2 3.65 6.2 3.65-6.8-2.33 3.37 6.34-4.82-5.32L12 21.7l-1.45-7.69-4.82 5.32 3.37-6.34-6.8 2.33 6.2-3.65-6.2-3.65 6.8 2.33-3.37-6.34 4.82 5.32z" fill="currentColor" />,
    slack: <><path d="M9.8 2.2a2.2 2.2 0 0 1 0 4.4H7.6V4.4a2.2 2.2 0 0 1 2.2-2.2Z" fill="#36C5F0"/><path d="M21.8 9.8a2.2 2.2 0 0 1-4.4 0V7.6h2.2a2.2 2.2 0 0 1 2.2 2.2Z" fill="#2EB67D"/><path d="M14.2 21.8a2.2 2.2 0 0 1 0-4.4h2.2v2.2a2.2 2.2 0 0 1-2.2 2.2Z" fill="#ECB22E"/><path d="M2.2 14.2a2.2 2.2 0 0 1 4.4 0v2.2H4.4a2.2 2.2 0 0 1-2.2-2.2Z" fill="#E01E5A"/><path d="M7.6 7.6h8.8v8.8H7.6z" fill="currentColor" opacity=".84"/></>,
    notion: <><rect x="3.2" y="2.8" width="17.6" height="18.4" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M7 7h3.6l5.1 7.7V8.8l-1.7-.3V7h5v1.5l-1.4.3V17h-2.2L9 7.8v7.3l1.8.4V17H6v-1.5l1.4-.4V8.7L7 8.5z" fill="currentColor"/></>,
    codex: <><path d="M12 3.2a4.4 4.4 0 0 1 7.55 3.07A4.4 4.4 0 0 1 20 14.7a4.4 4.4 0 0 1-7.55 3.08A4.4 4.4 0 0 1 4.9 14.7a4.4 4.4 0 0 1-.45-8.43A4.4 4.4 0 0 1 12 3.2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m8.2 9.7 3.8-2.2 3.8 2.2v4.6L12 16.5l-3.8-2.2z" fill="none" stroke="currentColor" strokeWidth="1.6"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[id] || <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8"/>}</svg>;
}

function hash(value: string) {
  let total = 0;
  for (let index = 0; index < value.length; index++) total = ((total << 5) - total + value.charCodeAt(index)) | 0;
  return Math.abs(total);
}

function graphPosition(node: GraphNode, index: number, total: number) {
  const h = hash(node.id);
  const ring = index % 3;
  const angle = ((index / Math.max(total, 1)) * Math.PI * 2 * 2.37) + (h % 31) / 17;
  return {
    x: Number(Math.max(8, Math.min(92, 50 + Math.cos(angle) * (18 + ring * 12 + h % 7))).toFixed(3)),
    y: Number(Math.max(10, Math.min(90, 50 + Math.sin(angle) * (15 + ring * 9 + h % 5))).toFixed(3)),
  };
}

export default function DashboardClient({ workspace, connections, pullRequests, graphHealth, graph, synthetic }: DashboardClientProps) {
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [selectedPrId, setSelectedPrId] = useState<string | null>(pullRequests[0]?.id || null);
  const selectedPr = pullRequests.find((pr) => pr.id === selectedPrId) || null;
  const selectedIndex = selectedPr ? pullRequests.findIndex((pr) => pr.id === selectedPr.id) : -1;
  const selectedColor = selectedIndex >= 0 ? prColors[selectedIndex % prColors.length] : "#4de3e8";
  const homeNodes = useMemo(() => graph.nodes.map((node, index) => ({ ...node, ...graphPosition(node, index, graph.nodes.length) })), [graph.nodes]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const constellationRef = useRef<HTMLDivElement>(null);
  const bodiesRef = useRef<Map<string, PhysicsBody>>(new Map());
  const wakePhysicsRef = useRef<() => void>(() => {});
  const pointerRef = useRef<{ id: number; nodeId: string; x: number; y: number; time: number } | null>(null);
  const positionedNodes = useMemo(() => homeNodes.map((node) => ({ ...node, ...(positions[node.id] || { x: node.x, y: node.y }) })), [homeNodes, positions]);
  const nodeMap = useMemo(() => new Map(positionedNodes.map((node) => [node.id, node])), [positionedNodes]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 680px)").matches) setRightOpen(false);
  }, []);

  useEffect(() => {
    const bodies = new Map<string, PhysicsBody>();
    for (const node of homeNodes) {
      const existing = bodiesRef.current.get(node.id);
      bodies.set(node.id, existing ? { ...existing, homeX: node.x, homeY: node.y } : { id: node.id, x: node.x, y: node.y, homeX: node.x, homeY: node.y, vx: 0, vy: 0, dragging: false, energy: 0 });
    }
    bodiesRef.current = bodies;
    setPositions(Object.fromEntries([...bodies].map(([id, body]) => [id, { x: body.x, y: body.y }])));
  }, [homeNodes]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0; let previous = performance.now(); let active = true;
    const tick = (time: number) => {
      if (!active) return;
      const delta = Math.min(2.5, (time - previous) / 16.667); previous = time;
      const moving = stepGraphPhysics([...bodiesRef.current.values()], delta);
      if (moving) {
        setPositions(Object.fromEntries([...bodiesRef.current].map(([id, body]) => [id, { x: body.x, y: body.y }])));
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
      }
    };
    const start = () => {
      if (frame || document.hidden) return;
      previous = performance.now(); frame = requestAnimationFrame(tick);
    };
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else start(); };
    wakePhysicsRef.current = start; start(); document.addEventListener("visibilitychange", visibility);
    return () => { active = false; wakePhysicsRef.current = () => {}; cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", visibility); };
  }, [homeNodes]);

  function selectPullRequest(pr: PullRequestRecord) {
    setSelectedPrId((current) => current === pr.id ? null : pr.id);
    setRightOpen(true);
  }

  function startNodeDrag(event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) {
    if (event.button !== 0 || pointerRef.current) return;
    const body = bodiesRef.current.get(nodeId); if (!body) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    body.dragging = true; body.vx = 0; body.vy = 0; body.energy = 1;
    pointerRef.current = { id: event.pointerId, nodeId, x: event.clientX, y: event.clientY, time: performance.now() };
    setDraggedNodeId(nodeId);
    wakePhysicsRef.current();
  }

  function moveNode(event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) {
    const pointer = pointerRef.current; const body = bodiesRef.current.get(nodeId); const field = constellationRef.current;
    if (!pointer || pointer.id !== event.pointerId || pointer.nodeId !== nodeId || !body || !field) return;
    const rect = field.getBoundingClientRect(); const time = performance.now(); const elapsed = Math.max(8, time - pointer.time);
    const dx = event.clientX - pointer.x; const dy = event.clientY - pointer.y;
    body.x = Math.max(5, Math.min(95, body.x + dx / rect.width * 100));
    body.y = Math.max(7, Math.min(93, body.y + dy / rect.height * 100));
    body.vx = Math.max(-1.4, Math.min(1.4, dx / rect.width * 100 * (16.667 / elapsed)));
    body.vy = Math.max(-1.4, Math.min(1.4, dy / rect.height * 100 * (16.667 / elapsed)));
    body.energy = 1;
    pointerRef.current = { ...pointer, x: event.clientX, y: event.clientY, time };
    setPositions((current) => ({ ...current, [nodeId]: { x: body.x, y: body.y } }));
  }

  function releaseNode(event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) {
    const pointer = pointerRef.current; const body = bodiesRef.current.get(nodeId);
    if (!pointer || pointer.id !== event.pointerId || pointer.nodeId !== nodeId || !body) return;
    body.dragging = false; pointerRef.current = null; setDraggedNodeId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      body.x = body.homeX; body.y = body.homeY; body.vx = 0; body.vy = 0; body.energy = 0;
      setPositions((current) => ({ ...current, [nodeId]: { x: body.homeX, y: body.homeY } }));
    } else wakePhysicsRef.current();
  }

  function resetNode(nodeId: string) {
    const body = bodiesRef.current.get(nodeId); if (!body) return;
    body.dragging = false; body.x = body.homeX; body.y = body.homeY; body.vx = 0; body.vy = 0; body.energy = 0;
    setPositions((current) => ({ ...current, [nodeId]: { x: body.homeX, y: body.homeY } }));
  }

  function nudgeNode(event: ReactKeyboardEvent<HTMLButtonElement>, nodeId: string) {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] };
    if (event.key === "Home" || event.key === "Enter") { event.preventDefault(); resetNode(nodeId); return; }
    const direction = directions[event.key]; if (!direction) return;
    const body = bodiesRef.current.get(nodeId); if (!body) return;
    event.preventDefault(); body.x = Math.max(5, Math.min(95, body.x + direction[0])); body.y = Math.max(7, Math.min(93, body.y + direction[1]));
    body.vx = direction[0] * .12; body.vy = direction[1] * .12; body.energy = 1;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      body.x = body.homeX; body.y = body.homeY; body.vx = 0; body.vy = 0; body.energy = 0;
    }
    setPositions((current) => ({ ...current, [nodeId]: { x: body.x, y: body.y } })); wakePhysicsRef.current();
  }

  return (
    <main className={`graph-shell ${leftOpen ? "left-open" : ""} ${rightOpen ? "right-open" : ""}`} style={{ "--selection": selectedColor } as CSSProperties}>
      <aside className="source-rail" aria-label="Connections">
        <div className="rail-brand"><span className="brand-seal">T</span>{leftOpen && <strong>Temporal</strong>}</div>
        <button className="rail-toggle" type="button" aria-label={leftOpen ? "Collapse connections" : "Expand connections"} aria-expanded={leftOpen} onClick={() => setLeftOpen((value) => !value)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={leftOpen ? "m12.5 5-5 5 5 5" : "m7.5 5 5 5-5 5"}/></svg></button>
        <div className="source-stack">
          {connections.filter((connection) => connection.status !== "planned").map((connection) => <Link href="/connections" className={`source-control source-${connection.id}`} key={connection.id} aria-label={`${connection.name}, ${connection.status}`} title={connection.name}><span><SourceLogo source={connection.id}/><i/></span>{leftOpen && <span className="source-copy"><strong>{connection.name}</strong><small>{connection.status.replace("_", " ")}</small></span>}</Link>)}
        </div>
        <Link href="/connections" className="add-source" aria-label="Add a connection" title="Add a connection"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>{leftOpen && <span>Add connection</span>}</Link>
      </aside>

      <section className="graph-workspace" aria-label="Company knowledge graph">
        <header className="graph-header"><div><h1>Company memory</h1><p className="graph-thesis">Why a pull request looks the way it does — recovered from the work that came before the diff.</p><p>{workspace.name} · {graphHealth.records.toLocaleString()} indexed records · select a pull request to light its evidence path</p></div><div className="graph-state"><i/>Graph online {synthetic && <span>· demo data</span>}</div></header>
        <div className="constellation" ref={constellationRef} role="group" aria-label="Knowledge graph nodes" aria-describedby="graph-drag-hint">
          <div className="graph-aura" aria-hidden="true"/>
          <svg className="graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {graph.edges.map((edge, index) => {
              const from = nodeMap.get(edge.from); const to = nodeMap.get(edge.to); if (!from || !to) return null;
              const active = selectedPrId && from.relatedPullRequestIds.includes(selectedPrId) && to.relatedPullRequestIds.includes(selectedPrId);
              return <line key={`${edge.from}:${edge.to}:${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={active ? "active" : selectedPrId ? "muted" : ""}/>;
            })}
          </svg>
          {positionedNodes.map((node, index) => {
            const active = selectedPrId ? node.relatedPullRequestIds.includes(selectedPrId) : false;
            const muted = Boolean(selectedPrId && !active);
            const size = node.type === "pull_request" ? 62 : 42 + hash(node.id) % 13;
            const dragging = draggedNodeId === node.id;
            return <button type="button" className={`graph-node source-${node.source === "git" ? "github" : node.source} ${active ? "active" : ""} ${muted ? "muted" : ""} ${dragging ? "dragging" : ""} ${node.type === "pull_request" ? "pr-node" : ""}`} key={node.id} style={{ left: `${node.x}%`, top: `${node.y}%`, width: size, height: size, "--delay": `${-(index % 8) * .7}s` } as CSSProperties} aria-label={`${sourceNames[node.source] || node.source}: ${node.title}. Drag or use arrow keys to move; double-click, Home, or Enter to reset.`} aria-grabbed={dragging} title={`${node.title} · drag to explore`} onPointerDown={(event) => startNodeDrag(event, node.id)} onPointerMove={(event) => moveNode(event, node.id)} onPointerUp={(event) => releaseNode(event, node.id)} onPointerCancel={(event) => releaseNode(event, node.id)} onLostPointerCapture={(event) => releaseNode(event, node.id)} onDoubleClick={() => resetNode(node.id)} onKeyDown={(event) => nudgeNode(event, node.id)}><SourceLogo source={node.source}/><span className="node-title">{node.title}</span></button>;
          })}
          {graph.nodes.length === 0 && <div className="graph-empty"><strong>Your graph is waiting.</strong><p>Connect GitHub or upload a Claude session to add the first provenance nodes.</p><Link href="/connections">Add a connection</Link></div>}
        </div>
        <div className="graph-legend" aria-label="Graph legend"><span><i className="linked"/>linked evidence</span><span><i className="ambient"/>other company context</span><span id="graph-drag-hint" className="drag-hint"><i/>drag · release to rejoin</span></div>
        {selectedPr && <div className="selection-dock" aria-live="polite"><div className="dock-mark">#{selectedPr.number}</div><div className="dock-copy"><strong>{selectedPr.title}</strong><span>{selectedPr.eventCount} {selectedPr.countLabel || "related nodes"} · {selectedPr.sourceCount} sources{selectedPr.synthetic ? " · demo data" : ""}</span></div>{selectedPr.status === "ready" ? <Link href={`/artifact/index.html?artifact=${selectedPr.id}`} className="open-artifact">Open artifact <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m6 12 6-6M7 6h5v5"/></svg></Link> : <span className={`artifact-state state-${selectedPr.status}`}>{selectedPr.status === "building" ? "Assembling artifact…" : "Partial context"}</span>}<button type="button" className="dock-close" onClick={() => setSelectedPrId(null)} aria-label="Clear pull request selection"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="m5 5 8 8m0-8-8 8"/></svg></button></div>}
      </section>

      <aside className="pr-rail" aria-label="Pull requests">
        <button className="pr-toggle" type="button" aria-label={rightOpen ? "Collapse pull requests" : "Expand pull requests"} aria-expanded={rightOpen} onClick={() => setRightOpen((value) => !value)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={rightOpen ? "m12.5 5-5 5 5 5" : "m7.5 5 5 5-5 5"}/></svg><span className="pr-toggle-label">PR</span></button>
        {rightOpen ? <><header><h2>Pull requests</h2><span>{pullRequests.length} indexed</span></header><div className="pr-stack">{pullRequests.map((pr, index) => { const selected = pr.id === selectedPrId; return <button type="button" className={`pr-choice ${selected ? "selected" : ""}`} key={pr.id} onClick={() => selectPullRequest(pr)} style={{ "--pr-color": prColors[index % prColors.length] } as CSSProperties} aria-pressed={selected}><span className="pr-choice-top"><b>#{pr.number}</b><i className={`pr-status status-${pr.status}`}/></span><strong>{pr.title}</strong><span>{pr.repository} · {pr.author}{pr.synthetic ? " · demo data" : ""}</span><small>{pr.eventCount} {pr.countLabel || "nodes"} · {pr.updatedAt}</small></button>; })}{pullRequests.length === 0 && <div className="pr-empty"><strong>No PRs yet</strong><p>Open one in an approved GitHub repository to begin traversal.</p></div>}</div></> : <div className="collapsed-prs"><span>PR</span>{pullRequests.slice(0, 5).map((pr, index) => <button type="button" key={pr.id} onClick={() => selectPullRequest(pr)} aria-label={`Select PR ${pr.number}`} style={{ "--pr-color": prColors[index % prColors.length] } as CSSProperties}>#{String(pr.number).slice(-2)}</button>)}</div>}
      </aside>
    </main>
  );
}
