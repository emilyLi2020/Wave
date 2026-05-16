#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { createWriteStream, existsSync, mkdirSync, rmSync, statSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ARTIFACT_URL =
  "https://huggingface.co/Maelstrome/lora-wave-session-r32/resolve/main/native/ios/LiteRTLM-ios-frameworks.zip";
const EXPECTED_BYTES = 67_312_757;
const EXPECTED_SHA256 = "bb5a16c8c6f73e7ca7e0e77dfaa59d9cc6c63415f984fc58ae5debd53dd7029f";

const repoRoot = path.resolve(__dirname, "..");
const packageRoot = path.join(repoRoot, "node_modules", "react-native-litert-lm");
const frameworksDir = path.join(packageRoot, "ios", "Frameworks");
const frameworkDir = path.join(frameworksDir, "LiteRTLM.xcframework");
const markerPath = path.join(frameworksDir, ".wave-litert-framework.sha256");
const tmpZip = path.join(packageRoot, ".wave-litert-ios-frameworks.zip");

function log(message) {
  console.log(`[wave-litert-ios-framework] ${message}`);
}

function shouldSkip() {
  if (process.platform !== "darwin" && process.env.EAS_BUILD_PLATFORM !== "ios") {
    log("Skipping iOS framework install outside macOS/iOS build environment.");
    return true;
  }

  if (!existsSync(packageRoot)) {
    log("Skipping because react-native-litert-lm is not installed yet.");
    return true;
  }

  if (existsSync(frameworkDir) && existsSync(markerPath)) {
    try {
      const marker = require("node:fs").readFileSync(markerPath, "utf8").trim();
      if (marker === EXPECTED_SHA256) {
        log("Rebuilt LiteRT-LM XCFramework is already installed.");
        return true;
      }
    } catch {
      // Fall through and reinstall.
    }
  }

  return false;
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "wave-mobile-build" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} while downloading ${url}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function main() {
  if (shouldSkip()) {
    return;
  }

  log("Downloading rebuilt LiteRT-LM iOS XCFramework from Hugging Face...");
  rmSync(tmpZip, { force: true });
  await download(ARTIFACT_URL, tmpZip);

  const bytes = statSync(tmpZip).size;
  if (bytes !== EXPECTED_BYTES) {
    throw new Error(`Downloaded framework zip has ${bytes} bytes, expected ${EXPECTED_BYTES}.`);
  }

  const digest = await sha256(tmpZip);
  if (digest !== EXPECTED_SHA256) {
    throw new Error(`Downloaded framework zip SHA256 ${digest}, expected ${EXPECTED_SHA256}.`);
  }

  rmSync(frameworksDir, { recursive: true, force: true });
  mkdirSync(frameworksDir, { recursive: true });
  execFileSync("unzip", ["-o", "-q", tmpZip, "-d", frameworksDir], { stdio: "inherit" });
  rmSync(tmpZip, { force: true });

  require("node:fs").writeFileSync(markerPath, `${EXPECTED_SHA256}\n`);
  log("Installed rebuilt LiteRT-LM XCFramework.");
}

main().catch((error) => {
  console.error(`[wave-litert-ios-framework] ${error.message}`);
  process.exit(1);
});
