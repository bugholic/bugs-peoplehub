import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    agentUpgrade: "security",
  },
  /* config options here */
  // Cache Components / PPR assumes a static shell; this app is entirely
  // behind auth (cookies() everywhere), so there's nothing to prerender.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
