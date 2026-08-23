import type { ReactNode } from "react";

export default function SourceLogo({ source }: { source: string }) {
  const paths: Record<string, ReactNode> = {
    github: <path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.46.08.63-.2.63-.45v-1.77c-2.56.56-3.1-1.09-3.1-1.09-.42-1.07-1.03-1.35-1.03-1.35-.84-.58.06-.57.06-.57.93.07 1.42.96 1.42.96.83 1.42 2.17 1.01 2.7.77.08-.6.32-1.01.59-1.24-2.05-.23-4.2-1.02-4.2-4.55 0-1 .36-1.83.95-2.47-.1-.23-.41-1.17.09-2.44 0 0 .77-.25 2.53.94A8.8 8.8 0 0 1 12 7.13a8.7 8.7 0 0 1 2.3.31c1.76-1.19 2.53-.94 2.53-.94.5 1.27.19 2.21.1 2.44.59.64.94 1.46.94 2.47 0 3.54-2.16 4.31-4.21 4.54.33.29.62.85.62 1.72v2.58c0 .25.17.54.63.45A9.2 9.2 0 0 0 12 2.8Z" fill="currentColor" />,
    claude: <path d="m12 2.3 1.45 7.03 4.82-5.32-3.37 6.34 6.8-2.33-6.2 3.65 6.2 3.65-6.8-2.33 3.37 6.34-4.82-5.32L12 21.7l-1.45-7.69-4.82 5.32 3.37-6.34-6.8 2.33 6.2-3.65-6.2-3.65 6.8 2.33-3.37-6.34 4.82 5.32z" fill="currentColor" />,
    "claude-mem": <><path d="m12 2.6 1.2 5.8 4-4.4-2.8 5.24 5.63-1.93-5.13 3.02 5.13 3.02-5.63-1.93 2.8 5.25-4-4.4-1.2 5.8-1.2-5.8-4 4.4 2.8-5.25-5.63 1.93 5.13-3.02-5.13-3.02 5.63 1.93-2.8-5.24 4 4.4z" fill="currentColor" opacity=".55"/><rect x="7.4" y="9.4" width="9.2" height="5.2" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M9.7 11.2v1.9M12 11.2v1.9m2.3-1.9v1.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
    slack: <><path d="M9.8 2.2a2.2 2.2 0 0 1 0 4.4H7.6V4.4a2.2 2.2 0 0 1 2.2-2.2Z" fill="#36C5F0"/><path d="M21.8 9.8a2.2 2.2 0 0 1-4.4 0V7.6h2.2a2.2 2.2 0 0 1 2.2 2.2Z" fill="#2EB67D"/><path d="M14.2 21.8a2.2 2.2 0 0 1 0-4.4h2.2v2.2a2.2 2.2 0 0 1-2.2 2.2Z" fill="#ECB22E"/><path d="M2.2 14.2a2.2 2.2 0 0 1 4.4 0v2.2H4.4a2.2 2.2 0 0 1-2.2-2.2Z" fill="#E01E5A"/><path d="M7.6 7.6h8.8v8.8H7.6z" fill="currentColor" opacity=".84"/></>,
    notion: <><rect x="3.2" y="2.8" width="17.6" height="18.4" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M7 7h3.6l5.1 7.7V8.8l-1.7-.3V7h5v1.5l-1.4.3V17h-2.2L9 7.8v7.3l1.8.4V17H6v-1.5l1.4-.4V8.7L7 8.5z" fill="currentColor"/></>,
    codex: <><path d="M12 3.2a4.4 4.4 0 0 1 7.55 3.07A4.4 4.4 0 0 1 20 14.7a4.4 4.4 0 0 1-7.55 3.08A4.4 4.4 0 0 1 4.9 14.7a4.4 4.4 0 0 1-.45-8.43A4.4 4.4 0 0 1 12 3.2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m8.2 9.7 3.8-2.2 3.8 2.2v4.6L12 16.5l-3.8-2.2z" fill="none" stroke="currentColor" strokeWidth="1.6"/></>,
    jira: <><path d="M12 2.5 21 12l-9 9.5L3 12z" fill="#2684ff"/><path d="m12 7.1 4.65 4.9L12 16.9 7.35 12z" fill="#fff" opacity=".95"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[source === "git" ? "github" : source] || <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8"/>}</svg>;
}
