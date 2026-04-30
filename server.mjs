import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const storedImageRoute = "/stored-images";
const storedImageRoot = path.join(__dirname, "runtime-storage", "images");
const maxJsonBytes = 30 * 1024 * 1024;

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

function safeResolveStoredImage(urlPath) {
  const pathname = decodeURIComponent((urlPath || "/").split("?")[0]);
  const relativePath = pathname.startsWith(storedImageRoute)
    ? pathname.slice(storedImageRoute.length)
    : pathname;
  const absolutePath = path.resolve(storedImageRoot, `.${relativePath}`);

  if (!absolutePath.startsWith(storedImageRoot)) {
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

function mimeTypeToExtension(mimeType) {
  const normalized = (mimeType || "").toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/png") return "png";
  return "png";
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxJsonBytes) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function persistImageBuffer(buffer, mimeType) {
  const id = createHash("sha256").update(buffer).digest("hex");
  const extension = mimeTypeToExtension(mimeType);
  const shardDir = path.join(storedImageRoot, id.slice(0, 2));
  const filename = `${id}.${extension}`;
  const absolutePath = path.join(shardDir, filename);
  const publicUrl = `${storedImageRoute}/${id.slice(0, 2)}/${filename}`;

  await mkdir(shardDir, { recursive: true });

  try {
    await access(absolutePath);
  } catch {
    await writeFile(absolutePath, buffer);
  }

  const fileStat = await stat(absolutePath);
  return {
    createdAt: fileStat.mtimeMs || Date.now(),
    id,
    mimeType: mimeType || "image/png",
    url: publicUrl,
  };
}

async function persistImageFromDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error("invalid data url");
  }

  const mimeType = match[1];
  const payload = match[2].replace(/\s/g, "");
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length) {
    throw new Error("empty image payload");
  }

  return persistImageBuffer(buffer, mimeType);
}

async function persistImageFromUrl(url) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`image fetch failed: HTTP ${response.status}`);
  }

  const mimeType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error("empty image response");
  }

  return persistImageBuffer(buffer, mimeType);
}

async function handleStorageSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const result =
      body?.kind === "dataUrl" && typeof body.dataUrl === "string"
        ? await persistImageFromDataUrl(body.dataUrl)
        : body?.kind === "url" && typeof body.url === "string"
          ? await persistImageFromUrl(body.url)
          : null;

    if (!result) {
      writeJson(response, 400, { error: "invalid storage payload" });
      return;
    }

    writeJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, 500, { error: message || "storage save failed" });
  }
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
    await handleStorageSave(request, response);
    return;
  }

  if (requestUrl.startsWith(storedImageRoute)) {
    const filePath = safeResolveStoredImage(requestUrl);
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
