// https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Node_server_without_framework
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { MifDb, getDbVersion, openDb, resolveDbPath } from "./db.js";
import { loadDotEnv } from "./env.js";

// Settings come from the environment, then from .env (see .env.example).
loadDotEnv(".env");

const PORT: number = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const hostname: string = process.env.HOST ?? "127.0.0.1";

// Fails loudly if DB_PATH is not set or the file does not exist (run db:setup first).
const dbPath = resolveDbPath();
const db = openDb(dbPath);
let mifDb: MifDb;
try {
    // Version 0 means a file without any applied migration, MifDb cannot work with it.
    if (getDbVersion(db) === 0) {
        throw new Error(`Database ${dbPath} has no schema, run "npm run db:setup:dev" first`);
    }
    mifDb = new MifDb(db);
    console.log(`DB: ${dbPath}, schema version ${getDbVersion(db)}, last event id: ${mifDb.getLastEventId()}`);
} catch (e) {
    db.close();
    throw e;
}

//Record<string, string> object with any string keys and string values
// need so file.ext would work becasue it expects a string
const MIME_TYPES: Record<string, string> = {
    default : "application/octet-stream",
    html: "text/html; charset=UTF-8",
    js: "text/javascript",
    css: "text/css",
    png: "image/png",
};

const STATIC_PATH = path.join(process.cwd(), "../frontend/public");

const toBool = [() => true, () => false]; 

const prepareFile = async (url: string) => {
    const urlAsPath = decodeURI(url);
    const paths = [STATIC_PATH, urlAsPath];
    if (url.endsWith("/")) paths.push("index.html");
    const filePath = path.join(...paths);

    const pathTraversal = !filePath.startsWith(STATIC_PATH);
    const exists = await fs.promises.access(filePath).then(...toBool);
    //http://127.0.0.1:3000
    const found = !pathTraversal && exists;
    // the fix was if you dont have a 404.html file which it says
    // about here then it will give you an error because cant open
    // a file that is not finding.
    const streamPath = found ? filePath : `${STATIC_PATH}/404.html`;
    const ext = path.extname(streamPath).substring(1).toLowerCase();
    const stream = fs.createReadStream(streamPath);
    return { found, ext, stream };
};

const server= http.createServer(async (req, res) => {
        // everyime a request is made it reads the file again
        // fs.createReadStream from disk takes the file and makes it readable
        // ?? checks if the left side is not null of undefined
        // then return the left side.
        const file = await prepareFile(req.url ?? "/");
        
        const mimeType = MIME_TYPES[file.ext] || MIME_TYPES.default;
        res.statusCode = file.found ? 200 : 404;
        res.setHeader("Content-Type", mimeType);
        // gives file content to res, by chunks 64KB, read one chunk
        // then write to res then frees up then reads next chunk until
        // file end res.end automatically called when file end
        file.stream.pipe(res);
    })

    server.listen(PORT, hostname, () =>
    {
        console.log(`Server running at http://${hostname}:${PORT}/`);
    });

// Stop accepting connections, then close the database so the WAL is checkpointed.
// The database is closed in the callback: it is not needed until open connections are done.
const shutdown = () => {
    server.close(() => mifDb.close());
    // Idle keep-alive connections would keep server.close waiting.
    server.closeIdleConnections();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
