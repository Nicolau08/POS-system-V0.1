import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Consola de licenças — POSly',
  description: 'Emissão de vouchers e gestão de clientes licenciados',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

/** Layout mínimo para deploy Vercel (só consola). Sem LicenseGuard do POS. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className="dark">
      <body className="bg-[#121212] text-white antialiased font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
