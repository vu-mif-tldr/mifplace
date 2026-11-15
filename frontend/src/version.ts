// The version of this build, shown next to the logo (docs/development.md, "Versions")

// "0.4.1" -> "v0.4.1", like the git tag; "dev" and anything else as it is
export function versionLabel(version: string): string {
  return /^\d+\.\d+\.\d+$/.test(version) ? `v${version}` : version;
}

export const appVersion = versionLabel(import.meta.env.APP_VERSION);
