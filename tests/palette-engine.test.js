#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'src/app/lib/palette-baseline.test.ts'], { stdio: 'inherit', shell: false });
process.exit(result.status ?? 1);
