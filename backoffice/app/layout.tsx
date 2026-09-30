import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'POSly Backoffice',
  description: 'Backoffice web do POSly',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
