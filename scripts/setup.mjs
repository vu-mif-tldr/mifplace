// First-run setup: creates .env from the example (if missing) and the dev database.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists, leaving it as is');
} else {
  copyFileSync('.env.example', '.env');
  console.log('created .env from .env.example');
}

execFileSync('npm', ['run', 'db:setup:dev', '-w', 'db'], { stdio: 'inherit' });
