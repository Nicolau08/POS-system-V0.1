import type {Metadata} from 'next';
import './globals.css';
import { LicenseGuardProvider } from '@/components/LicenseGuardProvider';

export const metadata: Metadata = {
  title: 'Modern POS System',
  description: 'A professional and functional Point of Sale system',
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
