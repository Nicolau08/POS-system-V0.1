import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },

  output: 'standalone',
  transpilePackages: ['motion'],

  turbopack: {},

  async rewrites() {
    return [
      {
        source: '/pos-backend/:path*',
        destination: 'http://127.0.0.1:3001/:path*',
      },
      {
        source: '/sync/:path*',
        destination: 'http://127.0.0.1:3001/sync/:path*',
      },
    ];
  },
};

export default nextConfig;
