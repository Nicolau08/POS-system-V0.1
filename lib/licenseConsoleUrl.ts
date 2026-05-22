/**
 * URL da consola de licenças (/license-admin).
 * Em dev com portas separadas: NEXT_PUBLIC_LICENSE_CONSOLE_URL=http://localhost:3002
 */
export function getLicenseConsoleHref(): string {
  const base = String(
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_LICENSE_CONSOLE_URL || ''
      : '',
  ).trim().replace(/\/$/, '');
  if (base) return `${base}/license-admin`;
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/license-admin`;
  }
  return '/license-admin';
}
