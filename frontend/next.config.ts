import type { NextConfig } from "next";

const isDev = process.env.ELECTRON_DEV === '1';

const nextConfig: NextConfig = {
  ...(isDev ? {} : { output: 'export' }),
  reactCompiler: true,
  images: {
    unoptimized: true,
  },
  // Allow cross-origin requests from local network devices during development
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '192.168.178.104',
    '192.168.0.74',
  ],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
