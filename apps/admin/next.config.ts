import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@society-marketplace/shared-types',
    '@society-marketplace/constants',
    '@society-marketplace/validation',
    '@society-marketplace/business-logic',
  ],
};

export default nextConfig;
