import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static HTML in out/ for S3 + CloudFront; no Node server (see PLAN.md)
  output: "export",
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
