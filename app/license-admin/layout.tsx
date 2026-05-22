import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Consola de licenças — POSly',
  description: 'Emissão de vouchers e gestão de clientes licenciados',
};

/** Consola independente do POS: sem LicenseGuardProvider (licença expirada no terminal não bloqueia aqui). */
export default function LicenseAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
