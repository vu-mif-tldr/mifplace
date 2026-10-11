import * as fs from "node:fs";

// Loads KEY=value pairs from an env file into process.env. Variables that are
// already set win, so Docker ENV, CI variables and the shell override the file.
// A missing file is not an error. A relative path is resolved against the cwd.
export function loadDotEnv(file: string): void {
    if (fs.existsSync(file)) 
    {
        console.log(`Loading env file: ${file}`);
        process.loadEnvFile(file);
    }
    else
    {
        console.warn(`Env file not found: ${file}`);
    }
}
