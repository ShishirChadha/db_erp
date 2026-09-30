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
    // unoptimized: narrowing deviceSizes/imageSizes (below) only got Vercel's
    // Image Optimization Transformations quota (5,000/mo free) down to ~75%
    // usage before it hit 100% again and broke every product image on the
    // site. productImageUrl() already resolves to a plain, publicly-served
    // Supabase Storage URL -- it costs nothing to serve as-is, so there's no
    // reason to route it through Vercel's metered optimizer at all. Actual
    // image weight is now handled at upload time in the ERP (sharp resize +
    // webp re-encode, see apps/erp/lib/image-process.ts) instead of at view
    // time here. Do not remove this without re-solving the quota problem
    // first -- see docs/decisions.md.
    unoptimized: true,
    deviceSizes: [640, 828, 1080, 1920],
    imageSizes: [40, 64, 96, 128, 256],
    formats: ["image/webp"],
  },
};

export default nextConfig;
