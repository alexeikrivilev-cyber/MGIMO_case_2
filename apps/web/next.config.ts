import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@horizon/ui', '@horizon/core', '@horizon/db'],
  output: 'standalone',
  reactStrictMode: true,
};

export default nextConfig;
