// The version of a build of main, for .github/workflows/docker.yml (see docs/development.md).
//
// Versions are git tags vX.Y.Z, nothing in the code holds them. Every merge to main is a new
// version: Z goes up by default; a pull request labelled "minor" raises Y (Z back to 0), one
// labelled "major" raises X (Y and Z back to 0). The labels of every pull request merged since
// the last tag count, so a merge whose own build never ran is not lost. Without any tag yet the
// version is FIRST_VERSION.
//
// Usage in CI: node tools/src/release-version.ts
//   Needs the full history with tags (checkout with fetch-depth: 0), gh with GH_TOKEN and
//   GITHUB_REPOSITORY. Prints the version and writes `version` (X.Y.Z, without "v") and `new`
//   (false when HEAD already has a version tag, e.g. the image of main built again) to
//   GITHUB_OUTPUT. Runs on plain Node: no imports beyond node:, types are stripped.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export const FIRST_VERSION = '0.4.0';

export type Bump = 'patch' | 'minor' | 'major';
type Version = [number, number, number];

// "v1.2.3" -> [1, 2, 3]; anything else (other tags, "v1.2", "1.2.3") -> null
export function parseTag(tag: string): Version | null {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// The highest version tag, e.g. "v1.10.0" over "v1.9.3"; null when there is none
export function latestTag(tags: readonly string[]): string | null {
  let best: { tag: string; version: Version } | null = null;
  for (const tag of tags) {
    const version = parseTag(tag);
    if (version && (!best || compare(version, best.version) > 0))
      best = { tag: tag.trim(), version };
  }
  return best?.tag ?? null;
}

// The biggest step asked for by the labels of the merged pull requests
export function bumpFor(labels: readonly string[]): Bump {
  if (labels.includes('major')) return 'major';
  if (labels.includes('minor')) return 'minor';
  return 'patch';
}

// The version after `latest` (a tag), without "v"; FIRST_VERSION when there is no tag yet
export function nextVersion(latest: string | null, bump: Bump): string {
  const version = latest ? parseTag(latest) : null;
  if (!version) return FIRST_VERSION;
  const [x, y, z] = version;
  if (bump === 'major') return `${x + 1}.0.0`;
  if (bump === 'minor') return `${x}.${y + 1}.0`;
  return `${x}.${y}.${z + 1}`;
}

function run(command: string, args: string[]): string[] {
  return execFileSync(command, args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error('GITHUB_REPOSITORY is not set');

  // HEAD already released (the workflow run again on the same commit): the same version
  const own = latestTag(run('git', ['tag', '--points-at', 'HEAD']));
  let version: string;
  if (own) {
    version = own.slice(1);
  } else {
    const latest = latestTag(run('git', ['tag', '--list', 'v*']));
    // main takes merges only: every first-parent commit since the last tag is a merged pull request
    const merges = latest
      ? run('git', ['log', '--first-parent', '--format=%H', `${latest}..HEAD`])
      : [];
    const labels = merges.flatMap((sha) =>
      run('gh', ['api', `repos/${repository}/commits/${sha}/pulls`, '--jq', '.[].labels[].name'])
    );
    version = nextVersion(latest, bumpFor(labels));
  }

  console.log(own ? `v${version} (already tagged)` : `v${version}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nnew=${!own}\n`);
  }
}

if (import.meta.main) main();
