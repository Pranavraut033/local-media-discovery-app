import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  reactCompiler: true,
  images: {
    unoptimized: true, // Required for static export
  },
  // Allow cross-origin requests from local network devices during development
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '192.168.178.104',
  ],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
