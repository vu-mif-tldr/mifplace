// Removes build output. With --deps also removes node_modules (run `npm install` afterwards).
import { rmSync } from 'node:fs';

const workspaces = ['db', 'backend', 'frontend', 'mcp', 'tools'];
const targets = [
  'db/dist',
  'backend/dist',
  'frontend/dist',
  ...workspaces.flatMap((w) => [`${w}/coverage`, `${w}/test-results`]),
];
if (process.argv.includes('--deps')) {
  targets.push('node_modules', ...workspaces.map((w) => `${w}/node_modules`));
}

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
}
