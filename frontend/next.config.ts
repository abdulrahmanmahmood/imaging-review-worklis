import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Cornerstone3D is bundled with webpack: Turbopack stalls on its module graph.
  webpack: (config) => {
    // dicom-parser references Node's fs, which is never used in the browser.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

export default nextConfig;
