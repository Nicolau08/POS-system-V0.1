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
    var KEY = 'pos:settings';
    var FLAG = 'pos:theme-principal';
    var raw = localStorage.getItem(KEY);
    var theme = 'violet';
    var parsed = null;
    if (raw) {
      parsed = JSON.parse(raw);
      if (parsed && (parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'violet')) {
        theme = parsed.theme;
      }
    }
    if (!localStorage.getItem(FLAG)) {
      theme = 'violet';
      localStorage.setItem(FLAG, 'violet');
      if (parsed && typeof parsed === 'object') {
        parsed.theme = 'violet';
        localStorage.setItem(KEY, JSON.stringify(parsed));
      }
    }
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('violet', theme === 'violet');
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  } catch (e) {}
})();
`;

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pt" className="violet" data-theme="violet" suppressHydrationWarning>
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
