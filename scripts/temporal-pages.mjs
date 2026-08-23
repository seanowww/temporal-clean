import { readFile } from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!token || !repository || !eventPath) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_EVENT_PATH are required");

const event = JSON.parse(await readFile(eventPath, "utf8"));
const number = Number(event.pull_request?.number);
if (!number) throw new Error("Temporal Pages publishing requires a pull_request event");

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
  "Content-Type": "application/json",
};

async function github(path, init = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`GitHub ${init.method || "GET"} ${path} failed (${response.status}: ${(await response.text()).slice(0, 300)})`);
  return response.status === 204 ? null : response.json();
}

const pages = await github("pages");
const filePath = `pr-${number}.html`;
const content = (await readFile(`temporal-artifact/${filePath}`)).toString("base64");

let existing;
const existingResponse = await fetch(`https://api.github.com/repos/${repository}/contents/${filePath}?ref=gh-pages`, { headers });
if (existingResponse.ok) existing = await existingResponse.json();
else if (existingResponse.status !== 404) throw new Error(`Could not inspect ${filePath} (${existingResponse.status})`);

const published = await github(`contents/${filePath}`, {
  method: "PUT",
  body: JSON.stringify({
    branch: "gh-pages",
    message: `temporal: ${existing ? "update" : "publish"} PR ${number} timeline`,
    content,
    ...(existing?.sha ? { sha: existing.sha } : {}),
  }),
});

const commitSha = published.commit.sha;
const htmlUrl = `${String(pages.html_url).replace(/\/$/, "")}/${filePath}`;
let live = false;
for (let attempt = 0; attempt < 40; attempt++) {
  const build = await github("pages/builds/latest");
  if (build.commit === commitSha && build.status === "errored") throw new Error(`GitHub Pages failed to publish ${commitSha}`);
  if (build.commit === commitSha && build.status === "built") {
    const publicResponse = await fetch(`${htmlUrl}?commit=${commitSha}`, { redirect: "follow" });
    if (publicResponse.ok) { live = true; break; }
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
}
if (!live) throw new Error(`GitHub Pages did not make ${filePath} available within two minutes`);

const body = `<!-- temporal-actions-artifact -->\n## [Open the Temporal HTML timeline →](${htmlUrl})`;
const comments = await github(`issues/${number}/comments?per_page=100`);
const existingComment = comments.find((comment) => comment.user?.login === "github-actions[bot]" && comment.body?.includes("<!-- temporal-actions-artifact -->"));
await github(existingComment ? `issues/comments/${existingComment.id}` : `issues/${number}/comments`, {
  method: existingComment ? "PATCH" : "POST",
  body: JSON.stringify({ body }),
});

console.log(`Temporal published ${htmlUrl} and ${existingComment ? "updated" : "created"} the PR comment.`);
