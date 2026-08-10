import type {Metadata} from 'next';
import './globals.css';
import { LicenseGuardProvider } from '@/components/LicenseGuardProvider';
import { StationModeGate } from '@/components/StationModeGate';
import { ThemeProvider } from '@/components/ThemeProvider';
import { UpdateNotification } from '@/components/UpdateNotification';

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

const THEME_BOOT_SCRIPT = `
(function(){
  try {
    var raw = localStorage.getItem('pos:settings');
    var theme = 'dark';
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.theme === 'light') theme = 'light';
    }
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    root.style.colorScheme = theme;
  } catch (e) {}
})();
`;

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pt" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-[var(--pos-bg)] text-[var(--pos-fg)] antialiased font-sans" suppressHydrationWarning>
        <ThemeProvider>
          <UpdateNotification />
          <StationModeGate>
            <LicenseGuardProvider>{children}</LicenseGuardProvider>
          </StationModeGate>
        </ThemeProvider>
      </body>
    </html>
  );
}
