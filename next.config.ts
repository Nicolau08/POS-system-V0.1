import type { NextConfig } from 'next';

/** Só o build do instalador Electron precisa de `standalone` (resources/web). A Vercel não. */
const useStandaloneOutput = String(process.env.NEXT_OUTPUT_STANDALONE ?? '').trim() === '1';

/** Deploy da consola (branch license-console / Vercel): raiz vai para /license-admin. */
const licenseConsoleOnly =
  String(process.env.VERCEL ?? '').trim() !== '' ||
  String(process.env.POS_LICENSE_CONSOLE_ONLY ?? '').trim() === '1';

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

  ...(useStandaloneOutput ? { output: 'standalone' as const } : {}),
  transpilePackages: ['motion'],

  turbopack: {},

  async redirects() {
    if (!licenseConsoleOnly) return [];
    return [
      {
        source: '/',
        destination: '/license-admin',
        permanent: false,
      },
    ];
  },

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
