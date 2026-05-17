#!/usr/bin/env node
/**
 * postinstall.js
 *
 * Downloads the prebuilt LiteRT-LM iOS frameworks when consumers run
 * `npm install react-native-litert-lm`.
 *
 * Resilient resolution order (first source that returns the asset wins):
 *   1. $LITERT_LM_FRAMEWORKS_URL          (+ optional $LITERT_LM_FRAMEWORKS_SHA256)
 *   2. package.json  litertLm.iosFrameworks { url, sha256 }   ← fork default
 *   3. GitHub release  v{package.version}   on $LITERT_LM_FRAMEWORKS_REPO
 *   4. Known-good GitHub release fallbacks  (same LiteRT-LM engine, v0.3.6/v0.3.5)
 *
 * Why (4) is safe: every 0.3.x release pins the same engine
 * (litertLm.version 0.10.2 / iosGitTag v0.10.2), and the v0.3.5–v0.3.6 release
 * assets are byte-identical. This is the documented workaround for the upstream
 * regression where the v0.3.7 release shipped without the frameworks asset
 * (hung-yueh/react-native-litert-lm#9).
 *
 * Whenever an expected SHA-256 is known for the chosen source, the download is
 * integrity-verified and a mismatch is a hard failure.
 *
 * Skips download if:
 *   - Not on macOS (iOS builds require macOS)
 *   - Frameworks already exist
 *   - SKIP_IOS_FRAMEWORK_DOWNLOAD=1
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PACKAGE_JSON = require('../package.json');
const PACKAGE_VERSION = PACKAGE_JSON.version;
const ASSET_NAME = 'LiteRTLM-ios-frameworks.zip';
const UPSTREAM_REPO = process.env.LITERT_LM_FRAMEWORKS_REPO || 'hung-yueh/react-native-litert-lm';
// Known-good upstream tags whose framework assets exist and pin the same
// LiteRT-LM engine as every other 0.3.x release. Used only as a fallback.
const FALLBACK_TAGS = ['v0.3.6', 'v0.3.5'];

const SCRIPT_DIR = __dirname;
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..');
const FRAMEWORKS_DIR = path.join(PACKAGE_ROOT, 'ios', 'Frameworks');

function log(msg) {
  console.log(`[react-native-litert-lm] ${msg}`);
}

function shouldSkip() {
  if (process.platform !== 'darwin') {
    log('Skipping iOS framework download (not macOS).');
    return true;
  }
  if (process.env.SKIP_IOS_FRAMEWORK_DOWNLOAD === '1') {
    log('Skipping iOS framework download (SKIP_IOS_FRAMEWORK_DOWNLOAD=1).');
    return true;
  }
  if (fs.existsSync(FRAMEWORKS_DIR) && fs.readdirSync(FRAMEWORKS_DIR).length > 0) {
    log('iOS frameworks already present, skipping download.');
    return true;
  }
  return false;
}

/** Ordered list of { url, sha256?, label } sources to try. */
function resolveCandidates() {
  const candidates = [];

  if (process.env.LITERT_LM_FRAMEWORKS_URL) {
    candidates.push({
      url: process.env.LITERT_LM_FRAMEWORKS_URL,
      sha256: process.env.LITERT_LM_FRAMEWORKS_SHA256 || null,
      label: '$LITERT_LM_FRAMEWORKS_URL',
    });
  }

  const cfg = PACKAGE_JSON.litertLm && PACKAGE_JSON.litertLm.iosFrameworks;
  if (cfg && cfg.url) {
    candidates.push({
      url: cfg.url,
      sha256: cfg.sha256 || null,
      label: `package.json litertLm.iosFrameworks${cfg.source ? ` (${cfg.source})` : ''}`,
    });
  }

  candidates.push({
    url: `https://github.com/${UPSTREAM_REPO}/releases/download/v${PACKAGE_VERSION}/${ASSET_NAME}`,
    sha256: null,
    label: `${UPSTREAM_REPO}@v${PACKAGE_VERSION} release`,
  });

  for (const tag of FALLBACK_TAGS) {
    if (tag === `v${PACKAGE_VERSION}`) continue;
    candidates.push({
      url: `https://github.com/${UPSTREAM_REPO}/releases/download/${tag}/${ASSET_NAME}`,
      sha256: null,
      label: `${UPSTREAM_REPO}@${tag} release (known-good fallback)`,
    });
  }

  return candidates;
}

function downloadFile(url, destPath, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }
    const protocol = url.startsWith('https') ? https : require('http');
    protocol
      .get(url, { headers: { 'User-Agent': 'react-native-litert-lm' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return downloadFile(res.headers.location, destPath, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function tryCandidate(c, tmpZip) {
  log(`Trying iOS frameworks from: ${c.label}`);
  await downloadFile(c.url, tmpZip);

  if (c.sha256) {
    const actual = sha256File(tmpZip);
    if (actual.toLowerCase() !== c.sha256.toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch for ${c.label}\n  expected ${c.sha256}\n  actual   ${actual}`,
      );
    }
    log('SHA-256 verified.');
  } else {
    log('No expected SHA-256 for this source — skipping integrity check.');
  }

  fs.mkdirSync(FRAMEWORKS_DIR, { recursive: true });
  execSync(`unzip -o -q "${tmpZip}" -d "${FRAMEWORKS_DIR}"`, { stdio: 'inherit' });
  log(`iOS frameworks installed successfully (source: ${c.label}).`);
}

async function main() {
  if (shouldSkip()) return;

  const tmpZip = path.join(PACKAGE_ROOT, '.ios-frameworks-tmp.zip');
  const candidates = resolveCandidates();
  const failures = [];

  for (const c of candidates) {
    try {
      await tryCandidate(c, tmpZip);
      try { fs.unlinkSync(tmpZip); } catch {}
      return; // success
    } catch (err) {
      try { fs.unlinkSync(tmpZip); } catch {}
      failures.push(`  - ${c.label}: ${err.message.split('\n')[0]}`);
      log(`Source failed (${c.label}): ${err.message.split('\n')[0]} — trying next.`);
    }
  }

  log('Error: could not obtain iOS frameworks from any source:');
  failures.forEach((f) => log(f));
  log('iOS builds will not work until frameworks are available. Options:');
  log('  - Set LITERT_LM_FRAMEWORKS_URL to a reachable LiteRTLM-ios-frameworks.zip');
  log('  - ./scripts/download-ios-frameworks.sh   (download manually)');
  log('  - ./scripts/build-ios-engine.sh          (build from source, needs Xcode)');
  log('  - Context: upstream hung-yueh/react-native-litert-lm#9');

  // Fail fast on macOS so the problem surfaces now, not at Xcode link time.
  if (process.platform === 'darwin') {
    log('Set SKIP_IOS_FRAMEWORK_DOWNLOAD=1 to suppress this error (e.g. Android-only builds).');
    process.exit(1);
  }
}

main();
