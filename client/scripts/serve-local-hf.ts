/* eslint-disable no-console */
// Tiny static-file server that mirrors HF Hub's URL layout for a single repo,
// so transformers.js (with env.remoteHost overridden) fetches from localhost
// instead of huggingface.co. Use this to test a local v4 export under WebGPU
// without uploading to HF.
//
// Usage (from client/):
//   pnpm exec tsx scripts/serve-local-hf.ts                       # default: serves v4 from port 8765
//   PORT=9000 EXPORT_DIR=onnx-export-v4-fused REPO_ID=Maelstrome/lora-wave-session-r32-onnx-fused pnpm exec tsx scripts/serve-local-hf.ts
//
// In compare-client.tsx, set env.remoteHost = "http://localhost:8765/" before
// loading the fine-tune (added via ?local=1 query param on /models/onnx-test/compare).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stat, open } from "node:fs/promises";
import { resolve, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? "8765");
const EXPORT_DIR = process.env.EXPORT_DIR ?? "onnx-export-v4-fused";
const REPO_ID = process.env.REPO_ID ?? "Maelstrome/lora-wave-session-r32-onnx-fused";

// client/scripts/ → models/runs/<EXPORT_DIR>/
const REPO_ROOT = resolve(__dirname, "..", "..", "models", "runs", EXPORT_DIR);
const URL_PREFIX = `/${REPO_ID}/resolve/main/`;

// Optional: also serve files from models/mediapipe/ under /mediapipe/<filename>.
// Used by the MediaPipe LLM Inference test page to fetch the .task bundle.
const MEDIAPIPE_DIR = resolve(__dirname, "..", "..", "models", "mediapipe");
const MEDIAPIPE_URL_PREFIX = "/mediapipe/";

// And the wllama-test page fetches split GGUF shards from /gguf/<filename>.
const GGUF_DIR = resolve(
  __dirname,
  "..",
  "..",
  "models",
  "runs",
  "merge-peft-gguf",
  "split",
);
const GGUF_URL_PREFIX = "/gguf/";

const MIME: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".onnx": "application/octet-stream",
  ".onnx_data": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".jinja": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

function mimeFor(path: string): string {
  for (const ext of Object.keys(MIME)) {
    if (path.endsWith(ext)) return MIME[ext];
  }
  return "application/octet-stream";
}

function applyCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, ETag");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=3600");
}

async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  fsPath: string,
): Promise<void> {
  let info;
  try {
    info = await stat(fsPath);
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.end(`Not Found: ${fsPath}`);
    return;
  }
  if (!info.isFile()) {
    res.statusCode = 404;
    res.end("Not a file");
    return;
  }

  const contentType = mimeFor(fsPath);
  const total = info.size;
  const range = req.headers["range"];

  // HEAD: just return metadata.
  if (req.method === "HEAD") {
    res.setHeader("Content-Length", String(total));
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("ETag", `"${info.mtimeMs.toFixed(0)}-${total}"`);
    res.statusCode = 200;
    res.end();
    return;
  }

  let start = 0;
  let end = total - 1;
  let status = 200;
  if (typeof range === "string" && range.startsWith("bytes=")) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      if (m[1] !== "") start = Number(m[1]);
      if (m[2] !== "") end = Number(m[2]);
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${total}`);
        res.end();
        return;
      }
      status = 206;
    }
  }

  const length = end - start + 1;
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", String(length));
  res.setHeader("ETag", `"${info.mtimeMs.toFixed(0)}-${total}"`);
  if (status === 206) {
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
  }

  const handle = await open(fsPath, "r");
  try {
    // Stream the requested range to the response.
    const stream = handle.createReadStream({ start, end });
    await new Promise<void>((resolveStream, reject) => {
      stream.on("error", reject);
      res.on("error", reject);
      res.on("close", resolveStream);
      stream.on("end", resolveStream);
      stream.pipe(res);
    });
  } finally {
    await handle.close();
  }
}

const server = createServer(async (req, res) => {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = req.url ?? "/";
  if (url === "/" || url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      repo: REPO_ID,
      root: REPO_ROOT,
      urlPrefix: URL_PREFIX,
    }));
    return;
  }

  let rootDir: string;
  let relRaw: string;
  if (url.startsWith(URL_PREFIX)) {
    rootDir = REPO_ROOT;
    relRaw = decodeURIComponent(url.slice(URL_PREFIX.length).split("?")[0]);
  } else if (url.startsWith(MEDIAPIPE_URL_PREFIX)) {
    rootDir = MEDIAPIPE_DIR;
    relRaw = decodeURIComponent(url.slice(MEDIAPIPE_URL_PREFIX.length).split("?")[0]);
  } else if (url.startsWith(GGUF_URL_PREFIX)) {
    rootDir = GGUF_DIR;
    relRaw = decodeURIComponent(url.slice(GGUF_URL_PREFIX.length).split("?")[0]);
  } else {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.end(
      `URL does not match any mount.\n  ${URL_PREFIX} -> ${REPO_ROOT}\n  ${MEDIAPIPE_URL_PREFIX} -> ${MEDIAPIPE_DIR}\n  ${GGUF_URL_PREFIX} -> ${GGUF_DIR}\nrequested: ${url}`,
    );
    return;
  }

  // Resolve under rootDir, prevent traversal.
  const rel = normalize(relRaw).replace(/^[\\/]+/, "");
  const fsPath = join(rootDir, rel);
  const safe = fsPath === rootDir || fsPath.startsWith(rootDir + (process.platform === "win32" ? "\\" : "/"));
  if (!safe) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  try {
    await serveFile(req, res, fsPath);
  } catch (err) {
    console.error("serve error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain");
      res.end("Internal server error");
    } else {
      res.end();
    }
  }
});

// Add .gguf to MIME map so wllama gets a sensible Content-Type.
MIME[".gguf"] = "application/octet-stream";

server.listen(PORT, () => {
  console.log(`local-hf mirror serving:`);
  console.log(`  HF-style mount:  ${URL_PREFIX} -> ${REPO_ROOT}`);
  console.log(`  MediaPipe mount: ${MEDIAPIPE_URL_PREFIX} -> ${MEDIAPIPE_DIR}`);
  console.log(`  base URL:        http://localhost:${PORT}`);
  console.log(`  health:          http://localhost:${PORT}/health`);
  console.log(`\n/models/onnx-test/compare?local=1 - uses HF mount.`);
  console.log(`/models/mediapipe-test            - uses MediaPipe mount.`);
});
