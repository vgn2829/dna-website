import { spawnSync } from "node:child_process";
import fs from "node:fs";
const baseline = JSON.parse(
  fs.readFileSync(
    new URL("./studio-type-baseline.json", import.meta.url),
    "utf8",
  ),
);
const result = spawnSync("pnpm", ["exec", "tsc", "--noEmit"], {
  encoding: "utf8",
});
const output = (result.stdout || "") + (result.stderr || "");
const actual = output.split(/\r?\n/).filter((l) => /: error TS\d+:/.test(l));
const unexpected = actual.filter((l) => !baseline.includes(l));
console.log(output);
if (
  result.error ||
  unexpected.length ||
  (result.status !== 0 && actual.length === 0)
) {
  console.error(
    "Type gate failed: unexpected diagnostics or compiler failure.",
    unexpected,
  );
  process.exit(1);
}
console.log(
  `Type identities checked: ${actual.length} known unrelated diagnostics; ${baseline.length - actual.length} baseline diagnostics resolved; no new or scoped diagnostics.`,
);
