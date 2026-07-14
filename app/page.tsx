import { redirect } from 'next/navigation';

/** Deploy da consola: raiz → /license-admin */
export default function Home() {
  redirect('/license-admin');
}
