// gen-app-icon.mjs — one-off: rasterize the design bundle's
// app-icon.jsx artwork into the Expo launcher icon so the brand icon
// matches the Claude design. Full-bleed (no rounded corner / shadow —
// iOS masks corners itself; Expo wants an opaque square). Re-run with
// `node scripts/gen-app-icon.mjs` if the design icon changes.
//
// Geometry is verbatim from wave/project/app-icon.jsx (viewBox 240).

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const images = join(here, "..", "assets", "images");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbfeff"/>
      <stop offset="0.25" stop-color="#bce9fc"/>
      <stop offset="0.55" stop-color="#46c3f2"/>
      <stop offset="0.78" stop-color="#0fa3dd"/>
      <stop offset="1" stop-color="#0e89c4"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#06436c" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#06436c" stop-opacity="0.12"/>
    </linearGradient>
  </defs>
  <rect width="240" height="240" fill="url(#bg)"/>
  <path d="M -20 104 C 70 49, 170 159, 260 104 L 260 252 L -20 252 Z" fill="url(#shade)"/>
  <path d="M -20 176 C 70 121, 170 231, 260 176 L 260 252 L -20 252 Z" fill="url(#shade)"/>
  <path d="M 0 105 C 72 51, 168 158, 240 105" fill="none" stroke="#ffffff" stroke-width="1.7" opacity="0.8"/>
  <path d="M 0 177 C 72 123, 168 230, 240 177" fill="none" stroke="#e0f4ff" stroke-width="1.5" opacity="0.65"/>
</svg>`;

const buf = Buffer.from(svg);

async function out(name, size) {
  const file = join(images, name);
  await sharp(buf, { density: 384 })
    .resize(size, size)
    // App Store icons must be opaque (no alpha); artwork is full-bleed
    // so the flatten colour is never visible.
    .flatten({ background: "#0e89c4" })
    .png()
    .toFile(file);
  console.log(`wrote ${name} (${size}x${size})`);
}

await out("icon.png", 1024);
await out("favicon.png", 48);
console.log("done");
