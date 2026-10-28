// Creates .mcp.json from .mcp.json.example, replacing {{REPO_ROOT}} with this checkout's path.
// .mcp.json is not committed because the paths differ per machine. --force overwrites it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, '.mcp.json');

if (existsSync(target) && !process.argv.includes('--force')) {
  console.log('.mcp.json already exists, leaving it as is (use --force to overwrite)');
} else {
  // Replace inside parsed strings, not raw text, so Windows backslashes get JSON-escaped.
  const config = JSON.parse(readFileSync(path.join(root, '.mcp.json.example'), 'utf8'), (_, v) =>
    typeof v === 'string' ? v.replaceAll('{{REPO_ROOT}}', root) : v
  );
  writeFileSync(target, JSON.stringify(config, null, 2) + '\n');
  console.log(`created .mcp.json for ${root}`);
}
