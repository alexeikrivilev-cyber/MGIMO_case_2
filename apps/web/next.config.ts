import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@udgu/ui', '@udgu/core', '@udgu/db'],
  output: 'standalone',
  reactStrictMode: true,
};

export default nextConfig;
