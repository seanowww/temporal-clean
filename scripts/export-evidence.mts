import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { prepareCommittedEvidence } from "../lib/committed-evidence.ts";
import { listGraphEdges, listGraphNodes } from "../lib/store.ts";

function argument(name: string) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const repository = argument("--repo")?.trim();
if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error("Pass the target repository as --repo owner/name");
const outputDirectory = path.resolve(argument("--output") || ".temporal/evidence");
const prepared = prepareCommittedEvidence(listGraphNodes(), listGraphEdges(), repository);

console.log(`Temporal evidence export for ${repository}`);
console.log(`  ${prepared.manifest.records} records · ${prepared.manifest.edges} relationships`);
console.log(`  excluded: ${prepared.manifest.excluded.restricted} restricted · ${prepared.manifest.excluded.synthetic} synthetic · ${prepared.manifest.excluded.otherRepository} other repository`);
console.log(`  destination: ${outputDirectory}`);

if (!process.argv.includes("--yes")) {
  console.log("\nDry run only. Review the counts, then add --yes to write the sanitized snapshot.");
  process.exit(0);
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "records.jsonl"), prepared.recordsJsonl, { encoding: "utf8", mode: 0o600 });
await writeFile(path.join(outputDirectory, "edges.jsonl"), prepared.edgesJsonl, { encoding: "utf8", mode: 0o600 });
await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify(prepared.manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log("\nSanitized evidence written. Inspect the diff before committing it.");
