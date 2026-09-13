import type { NextConfig } from 'next';

/** Destino do proxy /pos-backend — em electron-dist usa 3731; em dev fica 3001. */
const apiPort = String(process.env.POS_API_PORT || '3001').trim() || '3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  /** Sem source maps no instalador — evita vazar código-fonte no pack. */
  productionBrowserSourceMaps: false,

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
        destination: `http://127.0.0.1:${apiPort}/:path*`,
      },
      {
        source: '/sync/:path*',
        destination: `http://127.0.0.1:${apiPort}/sync/:path*`,
      },
    ];
  },
};

export default nextConfig;
