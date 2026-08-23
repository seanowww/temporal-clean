import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the served artifact stays in sync with the standalone prototype", async () => {
  const [prototype, served] = await Promise.all([
    readFile(new URL("../temporal-prototype.html", import.meta.url), "utf8"),
    readFile(new URL("../public/artifact/index.html", import.meta.url), "utf8"),
  ]);
  assert.equal(served, prototype);
});
