import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const build = spawnSync("npm", ["run", "site:build"], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const output = resolve("apps/site/.site-test-export");
const basePath = process.env.FORMA_SITE_BASE_PATH ?? "";
const contentTypes = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
};

createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (!pathname.startsWith(`${basePath}/`)) throw new Error("Outside site base path");
    const path = resolve(output, `.${decodeURIComponent(pathname.slice(basePath.length))}`);
    const file = pathname.endsWith("/") ? resolve(path, "index.html") : path;
    if (!file.startsWith(`${output}${sep}`) || !(await stat(file)).isFile()) throw new Error("Missing file");
    response.writeHead(200, { "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(3005, "127.0.0.1");
