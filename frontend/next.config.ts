import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["100.124.163.12"],
  devIndicators: false,
  experimental: {
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
