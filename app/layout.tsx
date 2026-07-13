import type {Metadata} from 'next';
import './globals.css';
import { LicenseGuardProvider } from '@/components/LicenseGuardProvider';

export const metadata: Metadata = {
  title: 'POSly',
  description: 'Sistema POS profissional — POSly',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#121212] text-white antialiased font-sans" suppressHydrationWarning>
        <LicenseGuardProvider>{children}</LicenseGuardProvider>
      </body>
    </html>
  );
}
