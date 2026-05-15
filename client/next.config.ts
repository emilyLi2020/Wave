import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/mlc-export/resolve/main/:path*",
        destination: "/mlc-export/:path*",
      },
      {
        source: "/mlc-base-export/resolve/main/:path*",
        destination: "/mlc-base-export/:path*",
      },
      {
        source: "/mlc-google-it-export/resolve/main/:path*",
        destination: "/mlc-google-it-export/:path*",
      },
    ];
  },
  // Cross-origin isolation for the /models surface. Required for the
  // multi-thread wllama WASM build to use SharedArrayBuffer (decode is ~2-4x
  // faster than single-thread on a phone CPU). Scoped to /models/* only —
  // we don't want to lock down the patient app's third-party embeds.
  //
  // COEP=credentialless (vs require-corp) so cross-origin fetches to
  // huggingface.co for the GGUF don't need HF to add `Cross-Origin-
  // Resource-Policy` headers: the browser strips credentials on
  // cross-origin requests instead, which HF's anonymous CDN doesn't care
  // about. Supported on Chrome 96+, Firefox 119+, Safari 17+ (iOS 17+).
  //
  // Production-only because `next dev` serves Turbopack HMR chunks and the
  // Next.js dev runtime over channels that don't all satisfy COEP, and on
  // mobile (especially iOS Safari over an ngrok tunnel) this presents as a
  // page that renders but stays non-interactive — Load/Run buttons and the
  // collapsible nav stop receiving taps. SharedArrayBuffer isn't available
  // in dev as a result, but that only costs single-vs-multi-thread WASM
  // speed during local testing; we get the headers back on the deployed
  // build where the perf actually matters.
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/models/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
