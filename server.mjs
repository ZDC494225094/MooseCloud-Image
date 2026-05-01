import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleStorageSaveRequest,
  storedImageRoute,
  tryServeStoredImageRequest,
} from "./storageProxy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function getRootDir() {
  const distDir = path.join(__dirname, "dist");

  try {
    await access(distDir);
    return distDir;
  } catch {
    return __dirname;
  }
}

function safeResolve(rootDir, urlPath) {
  const pathname = decodeURIComponent((urlPath || "/").split("?")[0]);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const absolutePath = path.resolve(rootDir, `.${requestedPath}`);

  if (!absolutePath.startsWith(rootDir)) {
    return null;
  }

  return absolutePath;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Content-Type": "application/json; charset=utf-8",
    Expires: "0",
    Pragma: "no-cache",
  });
  response.end(JSON.stringify(payload));
}

async function serveStaticFile(response, filePath) {
  const file = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";
  const isImmutableAsset = /\.(png|jpg|jpeg|webp|svg|ico)$/i.test(extension);
  const headers = {
    "Content-Type": contentType,
  };

  if (isImmutableAsset) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else {
    headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
    headers.Expires = "0";
    headers.Pragma = "no-cache";
  }

  response.writeHead(200, headers);
  response.end(file);
}

createServer(async (request, response) => {
  const requestUrl = request.url || "/";

  if (request.method === "POST" && requestUrl.split("?")[0] === "/api/storage/save") {
    await handleStorageSaveRequest(request, response);
    return;
  }

  if (await tryServeStoredImageRequest(requestUrl, response)) {
    return;
  }

  const rootDir = await getRootDir();
  const filePath = safeResolve(rootDir, requestUrl);

  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    await serveStaticFile(response, filePath);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`Site server running at http://127.0.0.1:${port}`);
});
