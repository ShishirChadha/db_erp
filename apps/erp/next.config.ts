import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // The npm-workspaces root (two levels up: apps/erp -> apps -> repo root),
    // where node_modules/next actually lives once hoisted -- not this app's
    // own directory. See node_modules/next/dist/docs/.../turbopack.md.
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
  },
};

export default nextConfig;
