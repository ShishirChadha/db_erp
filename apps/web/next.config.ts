import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // The npm-workspaces root (two levels up: apps/web -> apps -> repo root).
    root: path.join(__dirname, "..", ".."),
  },
  transpilePackages: ["@db/shared", "@db/ui", "@db/db"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // Narrowed from Next's defaults (8 deviceSizes x 8 imageSizes x 2 formats)
    // to the breakpoints this app actually renders at -- the default matrix
    // was driving the account's Vercel Image Optimization Transformations
    // quota (5,000/mo free) to ~75% usage from a ~165-image catalog.
    deviceSizes: [640, 828, 1080, 1920],
    imageSizes: [40, 64, 96, 128, 256],
    formats: ["image/webp"],
  },
};

export default nextConfig;
