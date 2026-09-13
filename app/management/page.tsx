'use client';

import React, { useState, useMemo, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { 
  X, 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  BarChart3, 
  FileText, 
  History, 
  TrendingUp, 
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Maximize2,
  Tag,
  ShieldCheck,
  CreditCard,
  Percent,
  Building2,
  KeyRound,
  Truck,
  User,
} from 'lucide-react';
import ProductsManager from './components/ProductsManager';
import InventoryManager from './components/InventoryManager';
import ReportsManager from './components/ReportsManager';
import { getPosApiBase, getPosUserAuthHeaders, clearPosAuthSession, isPosSessionActive } from '@/lib/apiBase';
import {
  getCachedDashboard,
  getCachedPermissionRules,
  setCachedDashboard,
  setCachedPermissionRules,
  type DashboardPeriodFilter,
  type DashboardPeriodPreset,
} from '@/lib/posSessionCache';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import ManagementDashboard from './components/ManagementDashboard';
import CustomersSuppliersManager from './components/CustomersSuppliersManager';
import PaymentMethodsManager from './components/PaymentMethodsManager';
import UsersSecurityManager from './components/UsersSecurityManager';
import MyCompanyManager from './components/MyCompanyManager';
import DocumentsManager from './components/DocumentsManager';
import LicenseSerialManager from './components/LicenseSerialManager';
import TaxRatesManager from './components/TaxRatesManager';
import { useIsPackagedDesktop } from '@/hooks/useIsPackagedDesktop';
import {
  DOCUMENT_FILTER_BY_KIND,
  DOCUMENTS_MENU_SECTIONS,
  type DocumentsPartyKind,
} from '@/app/management/documentsMenu';
import { PosSidebarNavItem } from '@/components/PosMenuButton';

const DOCUMENTS_SECTION_ICONS: Record<DocumentsPartyKind, React.ReactNode> = {
  clientes: <Users size={14} />,
  fornecedores: <Truck size={14} />,
  inventario: <Package size={14} />,
  interno: <Building2 size={14} />,
};

// Optimized static data
const initialMonthlySalesData = Array.from({ length: 12 }, (_, i) => ({
  name: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i],
  sales: 0,
  vendas: 0,
}));
const DOCS_VIEW_STATE_STORAGE_KEY = 'management:documents-view-state';

function buildDefaultPeriodFilter(): DashboardPeriodFilter {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { preset: 'month', from, to };
}

function buildDashboardSummaryUrl(apiBase: string, period: DashboardPeriodFilter, year: number) {
  const periodYear = Number(period.from?.slice(0, 4));
  const targetYear = Number.isFinite(periodYear) ? periodYear : year;
  const params = new URLSearchParams({
    year: String(targetYear),
    refresh: 'true',
    period: period.preset,
    _: String(Date.now()),
  });
  if (period.preset === 'custom' || period.preset === 'month') {
    if (period.from) params.set('from', period.from);
    if (period.to) params.set('to', period.to);
  }
  return `${apiBase.replace(/\/$/, '')}/dashboard-summary?${params.toString()}`;
}

function periodFiltersEqual(a: DashboardPeriodFilter, b: DashboardPeriodFilter) {
  return a.preset === b.preset && a.from === b.from && a.to === b.to;
}

type RouteProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ManagementPage({ params, searchParams }: RouteProps) {
  const SIDEBAR_EXPANDED_WIDTH = 260;
  const SIDEBAR_COLLAPSED_WIDTH = 56;
  use(params);
  use(searchParams);
  const router = useRouter();
  const isPackagedDesktop = useIsPackagedDesktop();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarSelectedTab, setSidebarSelectedTab] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [docsSidebarExpanded, setDocsSidebarExpanded] = useState(false);
  const [docsExpandedSection, setDocsExpandedSection] = useState<DocumentsPartyKind | null>(null);
  const [docsSelectedKind, setDocsSelectedKind] = useState<DocumentsPartyKind | null>(null);
  const [docsSelectedType, setDocsSelectedType] = useState<string | null>(null);
  const [isAuthRestored, setIsAuthRestored] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [permissionRules, setPermissionRules] = useState<Record<string, number> | null>(
    () => getCachedPermissionRules()
  );
  const [permissionsReady, setPermissionsReady] = useState(() => Boolean(getCachedPermissionRules()));
  const [isLoading, setIsLoading] = useState(() => !getCachedDashboard());
  const [bootComplete, setBootComplete] = useState(
    () => Boolean(getCachedPermissionRules()) && Boolean(getCachedDashboard()),
  );
  const [isMounted, setIsMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState('');
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  useEffect(() => {
    setIsMounted(true);
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    setCurrentDate(`${day}/${month}/${year}`);
    setCurrentYear(year);
  }, []);

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' MT';
  };

  // Dashboard Data
  const [monthlySalesData, setMonthlySalesData] = useState(
    () => getCachedDashboard()?.monthlySalesData ?? initialMonthlySalesData
  );
  const [totalSales, setTotalSales] = useState(() => getCachedDashboard()?.totalSales ?? 0);
  const [bestMonth, setBestMonth] = useState(() => getCachedDashboard()?.bestMonth ?? '---');
  const [bestMonthValue, setBestMonthValue] = useState(
    () => getCachedDashboard()?.bestMonthValue ?? 0
  );
  const [topProducts, setTopProducts] = useState<{name: string, sales: number, price: number}[]>(
    () => getCachedDashboard()?.topProducts ?? []
  );
  const [topGroups, setTopGroups] = useState<{name: string, sales: number}[]>(
    () => getCachedDashboard()?.topGroups ?? []
  );
  const [topEmployees, setTopEmployees] = useState<{ name: string; total: number }[]>(
    () => getCachedDashboard()?.topEmployees ?? [],
  );
  const [paymentTypes, setPaymentTypes] = useState<{ name: string; value: number; percent: number }[]>(
    () => getCachedDashboard()?.paymentTypes ?? [],
  );
  const [periodFilter, setPeriodFilter] = useState<DashboardPeriodFilter>(() => {
    const cachedFilter = getCachedDashboard()?.periodFilter;
    if (cachedFilter?.preset && cachedFilter.from && cachedFilter.to) {
      return cachedFilter;
    }
    const cached = getCachedDashboard()?.period;
    if (cached?.preset && cached.from && cached.to) {
      return { preset: cached.preset, from: cached.from, to: cached.to };
    }
    return buildDefaultPeriodFilter();
  });
  const periodFilterRef = React.useRef(periodFilter);
  periodFilterRef.current = periodFilter;
  const periodFetchReadyRef = React.useRef(false);
  const skipNextPeriodFetchRef = React.useRef(false);
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);
  const [period, setPeriod] = useState(
    () =>
      getCachedDashboard()?.period ?? {
        monthLabel: '---',
        totalVendas: 0,
        totalCaixa: 0,
        creditSales: 0,
        returns: 0,
      },
  );

  const restoreAuthState = React.useCallback(() => {
    if (!isPosSessionActive()) {
      clearPosAuthSession();
      setIsLoggedIn(false);
      setCurrentUser(null);
      return false;
    }

    const savedLogin = localStorage.getItem('isLoggedIn');
    const savedUser = localStorage.getItem('currentUser');
    if (savedLogin === 'true' && savedUser) {
      try {
        setIsLoggedIn(true);
        setCurrentUser(JSON.parse(savedUser));
        return true;
      } catch (error) {
        console.error('Error restoring management session:', error);
        clearPosAuthSession();
      }
    }

    setIsLoggedIn(false);
    setCurrentUser(null);
    return false;
  }, []);

  const fetchDashboardData = React.useCallback(
    async (options?: { silent?: boolean }, periodOverride?: DashboardPeriodFilter) => {
    const silent = Boolean(options?.silent) || Boolean(getCachedDashboard());
    const activePeriod = periodOverride ?? periodFilterRef.current;
    if (!silent) setIsLoading(true);
    setDashboardRefreshing(true);
    try {
      const apiBase = getPosApiBase();
      const yearNow = new Date().getFullYear();
      const summaryRes = await fetch(buildDashboardSummaryUrl(apiBase, activePeriod, yearNow), {
        cache: 'no-store',
        headers: {
          ...getPosUserAuthHeaders(),
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      });
      const summaryText = await summaryRes.text();
      if (!summaryRes.ok) {
        throw new Error(
          `dashboard-summary HTTP ${summaryRes.status}: ${summaryText.slice(0, 280) || summaryRes.statusText || 'sem corpo'}`
        );
      }
      if (!summaryText.trim()) {
        throw new Error('dashboard-summary: resposta vazia');
      }
      let summaryParsed: unknown = null;
      try {
        summaryParsed = summaryText ? JSON.parse(summaryText) : null;
      } catch {
        throw new Error('dashboard-summary: resposta não é JSON');
      }
      const summary = unwrapApiSuccessPayload<any>(summaryParsed);

      const monthly = Array.isArray(summary?.monthlySalesData)
        ? summary.monthlySalesData
        : initialMonthlySalesData;
      const topProductsData = Array.isArray(summary?.topProducts) ? summary.topProducts : [];
      const topGroupsData = Array.isArray(summary?.topGroups) ? summary.topGroups : [];
      const topEmployeesData = Array.isArray(summary?.topEmployees) ? summary.topEmployees : [];
      const paymentTypesData = Array.isArray(summary?.paymentTypes) ? summary.paymentTypes : [];
      const periodData = summary?.period ?? {
        preset: activePeriod.preset,
        from: activePeriod.from,
        to: activePeriod.to,
        monthLabel: '---',
        totalVendas: 0,
        totalCaixa: 0,
        creditSales: 0,
        returns: 0,
      };

      setTotalSales(Number(summary?.totalSales ?? 0));
      setMonthlySalesData(monthly);
      setBestMonth(String(summary?.bestMonth ?? '---'));
      setBestMonthValue(Number(summary?.bestMonthValue ?? 0));
      setTopProducts(topProductsData);
      setTopGroups(topGroupsData);
      setTopEmployees(topEmployeesData);
      setPaymentTypes(paymentTypesData);
      setPeriod(periodData);
      if (periodData.from && periodData.to && periodData.preset) {
        const syncedFilter: DashboardPeriodFilter = {
          preset: periodData.preset as DashboardPeriodPreset,
          from: periodData.from,
          to: periodData.to,
        };
        if (!periodFiltersEqual(activePeriod, syncedFilter)) {
          skipNextPeriodFetchRef.current = true;
          periodFilterRef.current = syncedFilter;
          setPeriodFilter(syncedFilter);
        }
      }
      setCachedDashboard({
        year: yearNow,
        monthlySalesData: monthly,
        totalSales: Number(summary?.totalSales ?? 0),
        bestMonth: String(summary?.bestMonth ?? '---'),
        bestMonthValue: Number(summary?.bestMonthValue ?? 0),
        period: periodData,
        periodFilter: activePeriod,
        topProducts: topProductsData,
        topGroups: topGroupsData,
        topEmployees: topEmployeesData,
        paymentTypes: paymentTypesData,
        topCustomers: [],
      });

    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Erro desconhecido';
      if (errorMessage.includes('HTTP 500') || errorMessage.includes('ECONNREFUSED')) {
        console.error(
          'Error fetching dashboard data: API indisponível. Reinicie o servidor (npm run dev:tenant:qa02:desktop).',
          errorMessage,
        );
      } else {
        console.error('Error fetching dashboard data:', errorMessage, err);
      }
      if (!silent) {
        setTotalSales(0);
        setMonthlySalesData(initialMonthlySalesData);
        setBestMonth('---');
        setBestMonthValue(0);
        setTopProducts([]);
        setTopGroups([]);
        setTopEmployees([]);
        setPaymentTypes([]);
        setPeriod({
          monthLabel: '---',
          totalVendas: 0,
          totalCaixa: 0,
          creditSales: 0,
          returns: 0,
        });
      }
    } finally {
      setDashboardRefreshing(false);
      if (!silent) setIsLoading(false);
      else setIsLoading(false);
    }
  }, []);

  const handlePeriodChange = React.useCallback((next: DashboardPeriodFilter) => {
    periodFilterRef.current = next;
    setPeriodFilter(next);
    setDashboardRefreshing(true);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || activeTab !== 'dashboard') return;

    if (!periodFetchReadyRef.current) {
      periodFetchReadyRef.current = true;
      return;
    }

    if (skipNextPeriodFetchRef.current) {
      skipNextPeriodFetchRef.current = false;
      return;
    }

    void fetchDashboardData({ silent: true }, periodFilter);
  }, [periodFilter, isLoggedIn, activeTab, fetchDashboardData]);

  useEffect(() => {
    if (permissionRules && permissionsReady && !isLoading) {
      setBootComplete(true);
    }
  }, [permissionRules, permissionsReady, isLoading]);

  useEffect(() => {
    const isAuthenticated = restoreAuthState();
    setIsAuthRestored(true);

    if (isAuthenticated) {
      void fetchDashboardData();
      return;
    }

    router.replace('/');
  }, [fetchDashboardData, restoreAuthState, router]);

  // Loads permission rules so we can hide modules based on access level.
  useEffect(() => {
    if (!isLoggedIn) {
      // Não limpar regras em cache no 1.º paint (isLoggedIn ainda false) —
      // isso fazia o menu fallback (com Stock) aparecer e depois sumir.
      setPermissionsReady(false);
      return;
    }

    let cancelled = false;
    const cached = getCachedPermissionRules();
    if (cached) {
      setPermissionRules(cached);
      setPermissionsReady(true);
    }

    void (async () => {
      try {
        const res = await fetch(`${getPosApiBase()}/permission-rules`, {
          headers: { ...getPosUserAuthHeaders() },
        });
        if (!res.ok) throw new Error('Falha ao carregar permission-rules');
        const data = unwrapApiSuccessPayload<any[]>(await res.json()) ?? [];
        const normalized: Record<string, number> = {};
        for (const row of data) {
          if (!row?.key) continue;
          normalized[String(row.key)] = Number(row.required_level ?? row.requiredLevel ?? 0);
        }
        if (!cancelled) {
          setPermissionRules(normalized);
          setCachedPermissionRules(normalized);
          setPermissionsReady(true);
        }
      } catch (e) {
        // Fail-closed: sem regras válidas, só o essencial (sem Stock).
        if (!cancelled && !getCachedPermissionRules()) {
          setPermissionRules({
            'painel.painel_controle': 0,
            'painel.documentos': 0,
          });
          setPermissionsReady(true);
        } else if (!cancelled && getCachedPermissionRules()) {
          setPermissionsReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  useEffect(() => {
    const syncSession = () => {
      const isAuthenticated = restoreAuthState();

      if (!isAuthenticated) {
        router.replace('/');
        return;
      }

      // Atualiza números em background — sem spinner / sem router.refresh.
      void fetchDashboardData({ silent: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncSession();
      }
    };

    window.addEventListener('focus', syncSession);
    window.addEventListener('storage', syncSession);
    window.addEventListener('pos-auth-changed', syncSession as EventListener);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', syncSession);
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('pos-auth-changed', syncSession as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchDashboardData, restoreAuthState, router]);

  useEffect(() => {
    if (!isLoggedIn || activeTab !== 'dashboard') {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchDashboardData({ silent: true });
    }, 60000);

    return () => window.clearInterval(intervalId);
  }, [activeTab, fetchDashboardData, isLoggedIn]);

  // Memoize components to prevent unnecessary re-renders
  const sidebarItems = useMemo(() => {
    const items = [
      { id: 'dashboard', icon: <LayoutDashboard size={16} strokeWidth={2} />, label: 'Painel' },
      { id: 'docs', icon: <FileText size={16} strokeWidth={2} />, label: 'Documentos' },
      { id: 'products', icon: <Package size={16} strokeWidth={2} />, label: 'Produtos' },
      { id: 'inventory', icon: <History size={16} strokeWidth={2} />, label: 'Inventário' },
      { id: 'reports', icon: <BarChart3 size={16} strokeWidth={2} />, label: 'Relatórios' },
      { id: 'customers', icon: <Users size={16} strokeWidth={2} />, label: 'Clientes e fornecedores' },
      { id: 'promos', icon: <Tag size={16} strokeWidth={2} />, label: 'Promoções' },
      { id: 'security', icon: <ShieldCheck size={16} strokeWidth={2} />, label: 'Utilizadores e acesso' },
      // Emitir série: só em dev/browser — nunca no executável de produção.
      ...(!isPackagedDesktop
        ? [{ id: 'license-serials', icon: <KeyRound size={16} strokeWidth={2} />, label: 'Emitir série' }]
        : []),
      { id: 'payments', icon: <CreditCard size={16} strokeWidth={2} />, label: 'Meios de pagamento' },
      { id: 'taxes', icon: <Percent size={16} strokeWidth={2} />, label: 'Impostos' },
      { id: 'company', icon: <Building2 size={16} strokeWidth={2} />, label: 'A minha empresa' },
    ];
    return items;
  }, [isPackagedDesktop]);

  const accessLevel = Number(currentUser?.accessLevel ?? currentUser?.access_level ?? 0);
  const loggedInUserName = String(currentUser?.name || currentUser?.userName || '').trim();

  const sidebarPermissionKeyById = useMemo(
    () => ({
      dashboard: 'painel.painel_controle',
      docs: 'painel.documentos',
      products: 'painel.produtos',
      inventory: 'painel.estoque',
      reports: 'painel.relatorios',
      customers: 'painel.clientes_fornecedores',
      promos: 'painel.promocoes_acoes',
      security: 'painel.usuarios_seguranca',
      'license-serials': 'painel.emitir_serie',
      payments: 'painel.meios_pagamento',
      taxes: 'painel.taxas_impostos',
      company: 'painel.minha_empresa',
    }),
    []
  );

  const sidebarItemsToRender = useMemo(() => {
    // Sem regras prontas: não listar módulos (evita flash do Stock e outros).
    if (!permissionRules || !permissionsReady) {
      return [];
    }
    return sidebarItems.filter((item) => {
      const permissionKey = sidebarPermissionKeyById[item.id as keyof typeof sidebarPermissionKeyById];
      if (!permissionKey) return true;
      const requiredLevel = Number(permissionRules[permissionKey] ?? 0);
      return accessLevel >= requiredLevel;
    });
  }, [accessLevel, permissionRules, permissionsReady, sidebarPermissionKeyById, sidebarItems]);

  const isTabAllowed = React.useCallback(
    (tabId: string) => {
      if (!permissionRules || !permissionsReady) {
        return false;
      }
      if (tabId === 'promos') return true;
      return sidebarItemsToRender.some((item) => item.id === tabId);
    },
    [permissionRules, permissionsReady, sidebarItemsToRender]
  );

  useEffect(() => {
    if (!isPackagedDesktop) return;
    if (activeTab === 'license-serials') setActiveTab('dashboard');
    if (sidebarSelectedTab === 'license-serials') setSidebarSelectedTab('dashboard');
  }, [activeTab, isPackagedDesktop, sidebarSelectedTab]);

  useEffect(() => {
    if (!permissionRules) return;
    const allowedHiddenTabs = new Set(['promos']);
    if (
      !allowedHiddenTabs.has(activeTab) &&
      !sidebarItemsToRender.some((item) => item.id === activeTab)
    ) {
      setActiveTab(sidebarItemsToRender[0]?.id ?? 'dashboard');
    }
    if (!sidebarItemsToRender.some((item) => item.id === sidebarSelectedTab)) {
      setSidebarSelectedTab(sidebarItemsToRender[0]?.id ?? 'dashboard');
    }
  }, [activeTab, permissionRules, sidebarItemsToRender, sidebarSelectedTab]);

  useEffect(() => {
    const onNavigateTab = (event: Event) => {
      const customEvent = event as CustomEvent<{ tabId?: string; preserveSidebarSelection?: boolean }>;
      const tabId = String(customEvent?.detail?.tabId ?? '').trim();
      if (!tabId) return;
      setActiveTab(tabId);
      if (!customEvent?.detail?.preserveSidebarSelection) {
        setSidebarSelectedTab(tabId);
      }
    };
    window.addEventListener('management:navigate-tab', onNavigateTab as EventListener);
    return () => {
      window.removeEventListener('management:navigate-tab', onNavigateTab as EventListener);
    };
  }, []);

  const currentModuleLabel = useMemo(() => {
    return sidebarItemsToRender.find((item) => item.id === activeTab)?.label ?? 'Painel';
  }, [activeTab, sidebarItemsToRender]);

  const dashboardSlice = useMemo(
    () => ({
      year: currentYear,
      monthlySalesData,
      totalSales,
      bestMonth,
      bestMonthValue,
      period,
      topProducts,
      topGroups,
      topCustomers: [],
      topEmployees,
      paymentTypes,
    }),
    [
      currentYear,
      monthlySalesData,
      totalSales,
      bestMonth,
      bestMonthValue,
      period,
      topProducts,
      topGroups,
      topEmployees,
      paymentTypes,
    ],
  );

  const handleBack = () => {
    try {
      window.localStorage.removeItem(DOCS_VIEW_STATE_STORAGE_KEY);
    } catch {
      // ignore storage cleanup issues
    }
    router.push('/');
  };

  if (!isAuthRestored) {
    return <ManagementLoadingDots />;
  }

  if (!isLoggedIn) {
    return null;
  }

  if (!bootComplete && (!permissionRules || !permissionsReady || isLoading)) {
    return <ManagementLoadingDots />;
  }

  // Segurança: nunca montar o menu sem regras filtradas.
  if (!permissionsReady || !permissionRules) {
    return <ManagementLoadingDots />;
  }

  return (
    <div className="flex flex-col h-screen bg-pos-surface text-zinc-300 font-sans overflow-hidden select-none">
      <header className="pos-chrome h-10 shrink-0 bg-pos-surface border-b border-pos-border flex items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-sm font-medium text-white">{`Gerenciamento - ${currentModuleLabel}`}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className="flex max-w-[220px] items-center gap-1.5 truncate text-sm font-medium text-white"
            title={loggedInUserName || 'Operador'}
          >
            <User size={14} strokeWidth={2.25} className="shrink-0" />
            <span className="truncate">{loggedInUserName || 'Operador'}</span>
          </span>
          <button
            onClick={handleBack}
            className="p-1 text-white transition-colors hover:text-red-400"
            aria-label="Fechar gerenciamento"
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside 
          className="pos-chrome bg-pos-surface border-r border-pos-border flex flex-col transition-[width] duration-300 relative shrink-0 overflow-hidden"
          style={{ width: isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-2 custom-scrollbar">
            {sidebarItemsToRender.map((item) => {
              if (item.id === 'docs') {
                return (
                  <div key={item.id} className="w-full">
                    <PosSidebarNavItem
                      icon={item.icon}
                      label={item.label}
                      collapsed={isSidebarCollapsed}
                      active={docsSidebarExpanded || sidebarSelectedTab === 'docs'}
                      onClick={() => {
                        const comingFromOther = sidebarSelectedTab !== 'docs';
                        setActiveTab('docs');
                        setSidebarSelectedTab('docs');
                        if (isSidebarCollapsed) {
                          setIsSidebarCollapsed(false);
                          setDocsSidebarExpanded(true);
                          setDocsExpandedSection(null);
                          if (comingFromOther) {
                            setDocsSelectedType(null);
                            setDocsSelectedKind(null);
                          }
                          return;
                        }
                        if (comingFromOther) {
                          setDocsSidebarExpanded(true);
                          setDocsExpandedSection(null);
                          setDocsSelectedType(null);
                          setDocsSelectedKind(null);
                        } else {
                          setDocsSidebarExpanded((prev) => {
                            if (prev) setDocsExpandedSection(null);
                            return !prev;
                          });
                        }
                      }}
                      trailing={
                        !isSidebarCollapsed ? (
                          <ChevronDown
                            size={14}
                            className={`transition-transform ${docsSidebarExpanded ? 'rotate-180' : ''}`}
                          />
                        ) : undefined
                      }
                    />

                    {!isSidebarCollapsed && docsSidebarExpanded && (
                      <div>
                        {DOCUMENTS_MENU_SECTIONS.map((section) => {
                          const sectionOpen = docsExpandedSection === section.kind;
                          return (
                            <div key={section.kind} className="leading-none">
                              <button
                                type="button"
                                onClick={() => {
                                  setDocsExpandedSection((current) => {
                                    if (current === section.kind) return null;
                                    return section.kind;
                                  });
                                  // Ao mudar de categoria, limpa o item selecionado da anterior
                                  if (docsSelectedKind != null && docsSelectedKind !== section.kind) {
                                    setDocsSelectedKind(null);
                                    setDocsSelectedType(null);
                                  }
                                }}
                                className={`pos-nav-subitem ${sectionOpen ? 'is-active' : ''}`}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="shrink-0">{DOCUMENTS_SECTION_ICONS[section.kind]}</span>
                                  <span className="truncate leading-none">{section.label}</span>
                                </span>
                                <ChevronDown
                                  size={13}
                                  className={`shrink-0 transition-transform ${sectionOpen ? 'rotate-180' : ''}`}
                                />
                              </button>
                              {sectionOpen &&
                                section.items.map((docItem) => {
                                  const filterCode = DOCUMENT_FILTER_BY_KIND[section.kind][docItem];
                                  const isActiveItem =
                                    docsSelectedKind === section.kind &&
                                    docsSelectedType === filterCode;
                                  return (
                                    <button
                                      key={docItem}
                                      type="button"
                                      title={docItem}
                                        onClick={() => {
                                          setDocsSelectedKind(section.kind);
                                          setDocsSelectedType(filterCode);
                                          setDocsExpandedSection(section.kind);
                                          setDocsSidebarExpanded(true);
                                          setActiveTab('docs');
                                          setSidebarSelectedTab('docs');
                                        }}
                                      className={`block w-full truncate px-5 py-2.5 pl-10 text-left text-[12px] leading-none transition-colors ${
                                        isActiveItem
                                          ? 'pos-on-accent bg-[#0000b8] text-white'
                                          : 'text-zinc-500 hover:bg-[var(--pos-brand-hover-bg)] hover:text-zinc-200'
                                      }`}
                                    >
                                      {docItem}
                                    </button>
                                  );
                                })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <PosSidebarNavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  collapsed={isSidebarCollapsed}
                  active={sidebarSelectedTab === item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setSidebarSelectedTab(item.id);
                    setDocsSidebarExpanded(false);
                  }}
                />
              );
            })}
          </div>

          <div className="border-t border-pos-border shrink-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className={`flex w-full max-w-full items-center text-sm text-zinc-400 transition-colors hover:bg-[var(--pos-brand-hover-bg)] hover:text-white overflow-hidden ${
                isSidebarCollapsed ? 'justify-center px-0 py-2.5' : 'justify-between px-5 py-2.5'
              }`}
              aria-label={isSidebarCollapsed ? 'Abrir menu lateral' : 'Fechar menu lateral'}
              title={isSidebarCollapsed ? 'Abrir menu' : 'Fechar menu'}
            >
              {!isSidebarCollapsed && <span className="truncate">Fechar menu</span>}
              {isSidebarCollapsed ? <ChevronRight size={16} className="shrink-0" /> : <ChevronLeft size={16} className="shrink-0" />}
            </button>
          </div>
        </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="hidden">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white">{`Gerenciamento - ${currentModuleLabel}`}</span>
          </div>
          <button 
            onClick={handleBack}
            className="p-1 text-zinc-500 transition-colors hover:text-red-500"
            aria-label="Fechar gerenciamento"
          >
            <X size={16} />
          </button>
        </header>

        {/* Main Content Area */}
        <main className={`flex-1 overflow-hidden bg-pos-bg flex flex-col custom-scrollbar`}>
          {activeTab === 'dashboard' && isTabAllowed('dashboard') && (
            <ManagementDashboard
              isMounted={isMounted}
              currentYear={currentYear}
              data={dashboardSlice}
              periodFilter={periodFilter}
              onPeriodChange={handlePeriodChange}
              isRefreshing={dashboardRefreshing}
              onRefresh={() => void fetchDashboardData({ silent: true })}
              formatPrice={formatPrice}
            />
          )}

          {activeTab === 'products' && isTabAllowed('products') && <ProductsManager />}
          {activeTab === 'docs' && isTabAllowed('docs') && (
            <DocumentsManager
              externalDocType={docsSelectedType}
              externalPartyKind={docsSelectedKind}
            />
          )}
          {activeTab === 'inventory' && isTabAllowed('inventory') && <InventoryManager />}
          {activeTab === 'reports' && isTabAllowed('reports') && <ReportsManager />}
          {activeTab === 'customers' && isTabAllowed('customers') && <CustomersSuppliersManager />}
          {activeTab === 'payments' && isTabAllowed('payments') && <PaymentMethodsManager />}
          {activeTab === 'security' && isTabAllowed('security') && <UsersSecurityManager />}
          {activeTab === 'license-serials' &&
            isTabAllowed('license-serials') &&
            !isPackagedDesktop && <LicenseSerialManager />}
          {activeTab === 'company' && isTabAllowed('company') && <MyCompanyManager />}
          {activeTab === 'taxes' && isTabAllowed('taxes') && <TaxRatesManager />}
          
          {isTabAllowed(activeTab) &&
            activeTab !== 'dashboard' &&
            activeTab !== 'products' &&
            activeTab !== 'docs' &&
            activeTab !== 'inventory' &&
            activeTab !== 'reports' &&
            activeTab !== 'customers' &&
            activeTab !== 'payments' &&
            activeTab !== 'security' &&
            activeTab !== 'license-serials' &&
            activeTab !== 'company' &&
            activeTab !== 'taxes' && (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 italic">
              <Package size={48} className="mb-4 opacity-20" />
              <p>Módulo {activeTab} em desenvolvimento</p>
            </div>
          )}
        </main>
      </div>
    </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #444;
        }
      `}</style>
    </div>
  );
}

function ManagementLoadingDots() {
  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-pos-bg"
      aria-label="A carregar"
      role="status"
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#0001fb] [animation-delay:-0.3s]" />
        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#0001fb] [animation-delay:-0.15s]" />
        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#0001fb]" />
      </div>
    </div>
  );
}

