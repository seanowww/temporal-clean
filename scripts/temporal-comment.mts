import { readFile } from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!token || !repository || !eventPath) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_EVENT_PATH are required");
const event = JSON.parse(await readFile(eventPath, "utf8"));
const number = Number(event.pull_request?.number);
if (!number) throw new Error("Temporal comment delivery requires a pull_request event");
const body = await readFile("temporal-artifact/comment.md", "utf8");
const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" };
const commentsUrl = `https://api.github.com/repos/${repository}/issues/${number}/comments`;
const listed = await fetch(`${commentsUrl}?per_page=100`, { headers });
if (!listed.ok) throw new Error(`Could not list PR comments (${listed.status})`);
const comments = await listed.json() as Array<{ id: number; body?: string; user?: { login?: string } }>;
const existing = comments.find((comment) => comment.user?.login === "github-actions[bot]" && comment.body?.includes("<!-- temporal-actions-artifact -->"));
const response = await fetch(existing ? `https://api.github.com/repos/${repository}/issues/comments/${existing.id}` : commentsUrl, {
  method: existing ? "PATCH" : "POST", headers, body: JSON.stringify({ body }),
});
if (!response.ok) throw new Error(`Could not ${existing ? "update" : "create"} the Temporal PR comment (${response.status}: ${(await response.text()).slice(0, 200)})`);
console.log(`Temporal PR comment ${existing ? "updated" : "created"}.`);
