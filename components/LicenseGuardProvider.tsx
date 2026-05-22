'use client';



import {

  createContext,

  ReactNode,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useRef,

  useState,

} from 'react';

import { usePathname } from 'next/navigation';

import {

  fetchSetupStatus,

  syncLicenseFromConsole,

  LICENSE_EXPIRED_EVENT,

  LICENSE_REFRESHED_EVENT,

} from '@/lib/services/posService';



export type RefreshLicenseOptions = {

  /** Não mostrar ecrã «A validar licença…» (navegação, poll, foco). */

  silent?: boolean;

  /** Sincronizar data/NUIT/plano com a consola Supabase (arranque, logout). */

  syncRegistry?: boolean;

};



type LicenseGuardContextValue = {

  licenseExpired: boolean;

  tenantName: string | null;

  expiresAt: string | null;

  isCheckingLicense: boolean;

  refreshLicenseStatus: (options?: RefreshLicenseOptions) => Promise<void>;

  clearLicenseExpired: () => void;

};



/** Poll em background (sem sync Supabase). */

const LICENSE_POLL_MS = 60 * 1000;



const LicenseGuardContext = createContext<LicenseGuardContextValue | undefined>(undefined);



function applySetupStatus(

  status: Awaited<ReturnType<typeof fetchSetupStatus>>,

  setLicenseExpired: (v: boolean) => void,

  setTenantName: (v: string | null) => void,

  setExpiresAt: (v: string | null) => void,

) {

  if (status.licenseExpired) {

    setLicenseExpired(true);

    setTenantName(status.tenantName);

    setExpiresAt(status.licenseExpiresAt);

    return;

  }

  setLicenseExpired(false);

  setTenantName(status.tenantName);

  setExpiresAt(status.licenseExpiresAt);

}



export function LicenseGuardProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLicenseConsoleRoute =
    typeof pathname === 'string' && pathname.startsWith('/license-admin');

  const [licenseExpired, setLicenseExpired] = useState(false);

  const [tenantName, setTenantName] = useState<string | null>(null);

  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [isCheckingLicense, setIsCheckingLicense] = useState(true);

  const initialCheckDoneRef = useRef(false);



  const refreshLicenseStatus = useCallback(async (options?: RefreshLicenseOptions) => {

    const silent = Boolean(options?.silent);

    const syncRegistry = Boolean(options?.syncRegistry);



    if (!silent && !initialCheckDoneRef.current) {

      setIsCheckingLicense(true);

    }



    try {

      let status: Awaited<ReturnType<typeof fetchSetupStatus>>;

      if (syncRegistry) {

        try {

          const payload = await syncLicenseFromConsole();

          status =

            payload?.status && typeof payload.status === 'object'

              ? (payload.status as Awaited<ReturnType<typeof fetchSetupStatus>>)

              : await fetchSetupStatus();

        } catch {

          status = await fetchSetupStatus();

        }

      } else {

        status = await fetchSetupStatus({ skipRegistrySync: true });

      }

      applySetupStatus(status, setLicenseExpired, setTenantName, setExpiresAt);

      if (typeof window !== 'undefined') {

        window.dispatchEvent(new CustomEvent(LICENSE_REFRESHED_EVENT, { detail: status }));

      }

    } catch {

      // Mantém estado anterior se a API estiver indisponível.

    } finally {

      initialCheckDoneRef.current = true;

      setIsCheckingLicense(false);

    }

  }, []);



  const clearLicenseExpired = useCallback(() => {

    setLicenseExpired(false);

  }, []);



  useEffect(() => {
    if (isLicenseConsoleRoute) return;

    void refreshLicenseStatus({ syncRegistry: true });



    const onLicenseExpiredEvent = () => {

      void refreshLicenseStatus({ silent: true, syncRegistry: true });

    };



    const onAuthChanged = () => {

      try {

        if (localStorage.getItem('isLoggedIn') !== 'true') {

          void refreshLicenseStatus({ silent: true, syncRegistry: true });

        }

      } catch {

        // ignore

      }

    };



    window.addEventListener(LICENSE_EXPIRED_EVENT, onLicenseExpiredEvent);

    window.addEventListener('pos-auth-changed', onAuthChanged);



    const intervalId = window.setInterval(() => {

      void refreshLicenseStatus({ silent: true });

    }, LICENSE_POLL_MS);



    return () => {

      window.removeEventListener(LICENSE_EXPIRED_EVENT, onLicenseExpiredEvent);

      window.removeEventListener('pos-auth-changed', onAuthChanged);

      window.clearInterval(intervalId);

    };

  }, [isLicenseConsoleRoute, refreshLicenseStatus]);



  if (isLicenseConsoleRoute) {
    return <>{children}</>;
  }

  const value = useMemo<LicenseGuardContextValue>(

    () => ({

      licenseExpired,

      tenantName,

      expiresAt,

      isCheckingLicense,

      refreshLicenseStatus,

      clearLicenseExpired,

    }),

    [

      clearLicenseExpired,

      expiresAt,

      isCheckingLicense,

      licenseExpired,

      refreshLicenseStatus,

      tenantName,

    ],

  );



  return <LicenseGuardContext.Provider value={value}>{children}</LicenseGuardContext.Provider>;

}



export function useLicenseGuard() {

  const context = useContext(LicenseGuardContext);

  if (!context) {

    throw new Error('useLicenseGuard must be used within LicenseGuardProvider');

  }

  return context;

}


