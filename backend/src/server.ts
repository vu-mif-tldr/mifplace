// https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Node_server_without_framework
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const PORT: number = 3000;
const hostname: string = "127.0.0.1";

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