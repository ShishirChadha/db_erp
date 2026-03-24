import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: '/official',
  assetPrefix: '/official',
  turbopack: {
    root: process.cwd(), // this tells Turbopack to use the current directory
  },
};

export default nextConfig;