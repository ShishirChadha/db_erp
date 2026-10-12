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
      {
        // Self-hosted Supabase. Kept alongside the hosted pattern above rather
        // than replacing it, so rolling back is a single env-var change
        // (NEXT_PUBLIC_SUPABASE_URL) with no code revert and no rebuild race.
        // Drop the *.supabase.co entry once the hosted project is retired.
        protocol: "https",
        hostname: "db.digitalbluez.com",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // Resizing happens through lib/image-loader.ts (self-hosted storage render
    // endpoint behind Cloudflare), NOT Vercel's metered optimizer -- do not
    // switch back to the default loader without re-solving the Image
    // Optimization quota problem (docs/decisions.md, 2026-09-28).
    loader: "custom",
    loaderFile: "./lib/image-loader.ts",
    deviceSizes: [640, 828, 1080, 1920],
    imageSizes: [40, 64, 96, 128, 256],
  },
};

export default nextConfig;
