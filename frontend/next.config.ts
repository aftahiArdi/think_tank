import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["100.124.163.12"],
  devIndicators: false,
  experimental: {
    middlewareClientMaxBodySize: 500 * 1024 * 1024, // 500MB — allows large video uploads
  },
};

export default nextConfig;
