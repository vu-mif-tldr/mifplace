// Set by vite.config.ts at build time
interface ImportMetaEnv {
  // The first 7 characters of the commit hash in the Docker build, "dev" everywhere else
  readonly APP_COMMIT: string;
}
