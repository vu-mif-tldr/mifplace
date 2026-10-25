// First-run setup: creates backend/.env from the example (if missing) and the dev database.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

if (existsSync('backend/.env')) {
  console.log('backend/.env already exists, leaving it as is');
} else {
  copyFileSync('backend/.env.example', 'backend/.env');
  console.log('created backend/.env from .env.example');
}

execFileSync('npm', ['run', 'db:setup:dev', '-w', 'backend'], { stdio: 'inherit' });
