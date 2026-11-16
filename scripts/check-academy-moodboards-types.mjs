import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

// Compare diagnostic identities, including source position, code and full message.
// Baseline is recorded from main at 79cf2ca; unrelated failures stay visible.
const baseline = fs.readFileSync('docs/academy-moodboards/baseline-typecheck.txt', 'utf8');
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false'], { encoding: 'utf8' });
if (result.error) throw result.error;
const output = result.stdout + result.stderr;
const identities = text => text.split(/(?=^\S.*\(\d+,\d+\): error TS)/m).filter(s => /^\S.*\(\d+,\d+\): error TS/.test(s)).map(s => s.trim());
const before = identities(baseline), after = identities(output);
const added = after.filter(d => !before.includes(d));
const removed = before.filter(d => !after.includes(d));
console.log(`TypeScript: ${after.length} existing diagnostic identities; ${added.length} new, ${removed.length} resolved.`);
const affected = /src\/app\/(pages\/(AcademyPage|MoodboardsPage|BoardPage)|components\/BoardCard|lib\/(academyProgress|boardShortcuts))/;
const scoped = after.filter(d => affected.test(d));
if (added.length || scoped.length || (result.status !== 0 && after.length === 0)) {
  console.error(added.join('\n') || scoped.join('\n') || output);
  process.exit(1);
}
console.log('Affected source files: no diagnostics. Full typecheck retains the documented baseline failures.');
