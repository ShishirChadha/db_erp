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
    ],
  },
};

export default nextConfig;
