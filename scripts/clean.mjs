// Removes build output. With --deps also removes node_modules (run `npm install` afterwards).
import { rmSync } from 'node:fs';

const targets = [
  'backend/dist',
  'frontend/dist',
  'backend/coverage',
  'frontend/coverage',
  'backend/test-results',
  'frontend/test-results',
  'mcp/coverage',
  'mcp/test-results',
];
if (process.argv.includes('--deps')) {
  targets.push('node_modules', 'backend/node_modules', 'frontend/node_modules');
}

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
}
