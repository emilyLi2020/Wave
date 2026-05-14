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
};

export default nextConfig;
