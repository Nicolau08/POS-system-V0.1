'use client';

import React, { useState, useMemo, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { 
  X, 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  BarChart3, 
  Settings, 
  FileText, 
  History, 
  TrendingUp, 
  Calendar,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Maximize2,
  Tag,
  ShieldCheck,
  CreditCard,
  Globe,
  Percent,
  Building2,
  Loader2,
  KeyRound,
  ScrollText,
} from 'lucide-react';
import ProductsManager from './components/ProductsManager';
import InventoryManager from './components/InventoryManager';
import ReportsManager from './components/ReportsManager';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import SyncStatusPanel from './components/SyncStatusPanel';
import CustomersSuppliersManager from './components/CustomersSuppliersManager';
import PaymentMethodsManager from './components/PaymentMethodsManager';
import UsersSecurityManager from './components/UsersSecurityManager';
import MyCompanyManager from './components/MyCompanyManager';
import SystemLogsManager from './components/SystemLogsManager';
import DocumentsManager from './components/DocumentsManager';
import GerenciamentoManager from './components/GerenciamentoManager';
import LicenseSerialManager from './components/LicenseSerialManager';
import { useIsPackagedDesktop } from '@/hooks/useIsPackagedDesktop';

// Dynamically import Recharts to avoid SSR issues
const ResponsiveContainer = dynamic(() => import('recharts').then(mod => mod.ResponsiveContainer), { ssr: false });
const BarChart = dynamic(() => import('recharts').then(mod => mod.BarChart), { ssr: false });
const Bar = dynamic(() => import('recharts').then(mod => mod.Bar), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(mod => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(mod => mod.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(mod => mod.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(mod => mod.Tooltip), { ssr: false });
const Cell = dynamic(() => import('recharts').then(mod => mod.Cell), { ssr: false });

// Optimized static data
const initialMonthlySalesData = Array.from({ length: 12 }, (_, i) => ({
  name: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i],
  sales: 0
}));
const monthlyBarColors = [
  '#3B82F6', // Jan
  '#06B6D4', // Fev
  '#14B8A6', // Mar
  '#22C55E', // Abr
  '#84CC16', // Mai
  '#EAB308', // Jun
  '#F59E0B', // Jul
  '#F97316', // Ago
  '#EF4444', // Set
  '#EC4899', // Out
  '#A855F7', // Nov
  '#6366F1', // Dez
];
const DOCS_VIEW_STATE_STORAGE_KEY = 'management:documents-view-state';

type RouteProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ManagementPage({ params, searchParams }: RouteProps) {
  const SIDEBAR_EXPANDED_WIDTH = 212;
  const SIDEBAR_COLLAPSED_WIDTH = 56;
  use(params);
  use(searchParams);
  const router = useRouter();
  const isPackagedDesktop = useIsPackagedDesktop();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarSelectedTab, setSidebarSelectedTab] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAuthRestored, setIsAuthRestored] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [permissionRules, setPermissionRules] = useState<Record<string, number> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
  const [monthlySalesData, setMonthlySalesData] = useState(initialMonthlySalesData);
  const [totalSales, setTotalSales] = useState(0);
  const [bestMonth, setBestMonth] = useState('---');
  const [bestMonthValue, setBestMonthValue] = useState(0);
  const [topProducts, setTopProducts] = useState<{name: string, sales: number, price: number}[]>([]);
  const [topGroups, setTopGroups] = useState<{name: string, sales: number}[]>([]);
  const [topCustomers, setTopCustomers] = useState<{name: string, total: number}[]>([]);

  const restoreAuthState = React.useCallback(() => {
    const savedLogin = localStorage.getItem('isLoggedIn');
    const savedUser = localStorage.getItem('currentUser');
    if (savedLogin === 'true' && savedUser) {
      try {
        setIsLoggedIn(true);
        setCurrentUser(JSON.parse(savedUser));
        return true;
      } catch (error) {
        console.error('Error restoring management session:', error);
        localStorage.removeItem('currentUser');
        localStorage.setItem('isLoggedIn', 'false');
      }
    }

    setIsLoggedIn(false);
    setCurrentUser(null);
    return false;
  }, []);

  const fetchDashboardData = React.useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) setIsLoading(true);
    try {
      const apiBase = getPosApiBase();
      const yearNow = new Date().getFullYear();
      const summaryRes = await fetch(`${apiBase}/dashboard-summary?year=${yearNow}&refresh=true`, {
        headers: { ...getPosUserAuthHeaders() },
      });
      const summaryText = await summaryRes.text();
      if (!summaryRes.ok) {
        throw new Error(
          `dashboard-summary HTTP ${summaryRes.status}: ${summaryText.slice(0, 280) || summaryRes.statusText || 'sem corpo'}`
        );
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
      const topCustomersData = Array.isArray(summary?.topCustomers) ? summary.topCustomers : [];
      const topGroupsData = Array.isArray(summary?.topGroups) ? summary.topGroups : [];

      setTotalSales(Number(summary?.totalSales ?? 0));
      setMonthlySalesData(monthly);
      setBestMonth(String(summary?.bestMonth ?? '---'));
      setBestMonthValue(Number(summary?.bestMonthValue ?? 0));
      setTopProducts(topProductsData);
      setTopCustomers(topCustomersData);
      setTopGroups(topGroupsData);

    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Erro desconhecido';
      console.error('Error fetching dashboard data:', errorMessage, err);
      if (!silent) {
        setTotalSales(0);
        setMonthlySalesData(initialMonthlySalesData);
        setBestMonth('---');
        setBestMonthValue(0);
        setTopProducts([]);
        setTopGroups([]);
        setTopCustomers([]);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

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
      setPermissionRules(null);
      return;
    }

    let cancelled = false;
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
        if (!cancelled) setPermissionRules(normalized);
      } catch (e) {
        if (!cancelled) setPermissionRules(null);
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
      { id: 'gerenciamento', icon: <Settings size={18} />, label: 'Gerenciamento' },
      { id: 'dashboard', icon: <LayoutDashboard size={18} />, label: 'Painel de Controle' },
      { id: 'docs', icon: <FileText size={18} />, label: 'Documentos' },
      { id: 'products', icon: <Package size={18} />, label: 'Produtos' },
      { id: 'inventory', icon: <History size={18} />, label: 'Estoque' },
      { id: 'reports', icon: <BarChart3 size={18} />, label: 'Relatórios' },
      { id: 'customers', icon: <Users size={18} />, label: 'Clientes & Fornecedores' },
      { id: 'promos', icon: <Tag size={18} />, label: 'Promoções & Ações' },
      { id: 'security', icon: <ShieldCheck size={18} />, label: 'Usuários & Acesso' },
      { id: 'logs', icon: <ScrollText size={18} />, label: 'Logs do sistema' },
      // Emitir série: só em dev/browser — nunca no executável de produção.
      ...(!isPackagedDesktop
        ? [{ id: 'license-serials', icon: <KeyRound size={18} />, label: 'Emitir série' }]
        : []),
      { id: 'payments', icon: <CreditCard size={18} />, label: 'Meios de pagamento' },
      { id: 'countries', icon: <Globe size={18} />, label: 'Países' },
      { id: 'taxes', icon: <Percent size={18} />, label: 'Taxas de impostos' },
      { id: 'company', icon: <Building2 size={18} />, label: 'Minha Empresa' },
    ];
    return items;
  }, [isPackagedDesktop]);

  const accessLevel = Number(currentUser?.accessLevel ?? currentUser?.access_level ?? 0);

  const sidebarPermissionKeyById = useMemo(
    () => ({
      gerenciamento: 'gerenciamento.acesso',
      dashboard: 'painel.painel_controle',
      docs: 'painel.documentos',
      products: 'painel.produtos',
      inventory: 'painel.estoque',
      reports: 'painel.relatorios',
      customers: 'painel.clientes_fornecedores',
      promos: 'painel.promocoes_acoes',
      security: 'painel.usuarios_seguranca',
      logs: 'painel.logs_sistema',
      'license-serials': 'painel.emitir_serie',
      payments: 'painel.meios_pagamento',
      countries: 'painel.paises',
      taxes: 'painel.taxas_impostos',
      company: 'painel.minha_empresa',
    }),
    []
  );

  const sidebarItemsToRender = useMemo(() => {
    if (!permissionRules) return sidebarItems;
    return sidebarItems.filter((item) => {
      const permissionKey = sidebarPermissionKeyById[item.id as keyof typeof sidebarPermissionKeyById];
      if (!permissionKey) return true;
      const requiredLevel = Number(permissionRules[permissionKey] ?? 0);
      return accessLevel >= requiredLevel;
    });
  }, [accessLevel, permissionRules, sidebarPermissionKeyById, sidebarItems]);

  useEffect(() => {
    if (!isPackagedDesktop) return;
    if (activeTab === 'license-serials') setActiveTab('dashboard');
    if (sidebarSelectedTab === 'license-serials') setSidebarSelectedTab('dashboard');
  }, [activeTab, isPackagedDesktop, sidebarSelectedTab]);

  useEffect(() => {
    if (!permissionRules) return;
    if (!sidebarItemsToRender.some((item) => item.id === activeTab)) {
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
    return sidebarItemsToRender.find((item) => item.id === activeTab)?.label ?? 'Painel de Controle';
  }, [activeTab, sidebarItemsToRender]);

  const currentMonthSummary = useMemo(() => {
    const monthIndex = new Date().getMonth();
    const monthData = monthlySalesData[monthIndex];
    return {
      name: monthData?.name ?? '---',
      sales: Number(monthData?.sales ?? 0),
    };
  }, [monthlySalesData]);

  const handleBack = () => {
    try {
      window.localStorage.removeItem(DOCS_VIEW_STATE_STORAGE_KEY);
    } catch {
      // ignore storage cleanup issues
    }
    router.push('/');
  };

  if (!isAuthRestored) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#1a1a1a] text-zinc-400">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 size={18} className="animate-spin text-blue-500" />
          Restaurando sessão...
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#1a1a1a] text-zinc-400">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 size={18} className="animate-spin text-blue-500" />
          Redirecionando...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#1a1a1a] text-zinc-300 font-sans overflow-hidden select-none">
      <header className="h-10 shrink-0 bg-[#141414] border-b border-zinc-800/30 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-zinc-300">{`Gerenciamento - ${currentModuleLabel}`}</span>
        </div>
        <button 
          onClick={handleBack}
          className="p-1 text-zinc-500 transition-colors hover:text-red-500"
          aria-label="Fechar gerenciamento"
        >
          <X size={16} />
        </button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside 
          className="bg-[#141414] border-r border-zinc-800/50 flex flex-col transition-[width] duration-300 relative shrink-0 overflow-hidden"
          style={{ width: isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH }}
        >
          <div className="flex-1 min-h-0 pt-0 pb-2 overflow-y-auto overflow-x-hidden custom-scrollbar">
            {sidebarItemsToRender.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={isSidebarCollapsed ? item.label : undefined}
                  onClick={() => {
                    setActiveTab(item.id);
                    setSidebarSelectedTab(item.id);
                  }}
                  className={`w-full max-w-full flex items-center py-2 transition-colors relative group overflow-hidden ${
                    isSidebarCollapsed ? 'justify-center px-0' : 'gap-2.5 px-4'
                  } ${
                    sidebarSelectedTab === item.id
                      ? 'bg-zinc-800/50 text-white'
                      : 'hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex-shrink-0">{item.icon}</div>
                  {!isSidebarCollapsed && (
                    <span className="min-w-0 text-xs font-medium truncate capitalize leading-none">{item.label}</span>
                  )}
                </button>
            ))}
          </div>

          <div className="border-t border-zinc-800/60 p-2 shrink-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className={`flex h-9 w-full max-w-full items-center rounded border border-zinc-800 bg-[#1a1a1a] text-zinc-400 transition-colors hover:text-zinc-200 hover:border-zinc-700 overflow-hidden ${
                isSidebarCollapsed ? 'justify-center px-0' : 'justify-between px-3'
              }`}
              aria-label={isSidebarCollapsed ? 'Abrir menu lateral' : 'Fechar menu lateral'}
              title={isSidebarCollapsed ? 'Abrir menu' : 'Fechar menu'}
            >
              {!isSidebarCollapsed && <span className="text-xs font-medium truncate">Fechar menu</span>}
              {isSidebarCollapsed ? <ChevronRight size={16} className="shrink-0" /> : <ChevronLeft size={16} className="shrink-0" />}
            </button>
          </div>
        </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="hidden">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-300">{`Gerenciamento - ${currentModuleLabel}`}</span>
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
        <main className={`flex-1 overflow-hidden bg-[#1a1a1a] flex flex-col custom-scrollbar`}>
          {activeTab === 'dashboard' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {isLoading ? (
                <div className="h-full flex flex-col items-center justify-center gap-4">
                  <Loader2 size={48} className="text-blue-500 animate-spin" />
                  <p className="text-zinc-500 font-medium">Carregando dados locais...</p>
                </div>
              ) : (
                <>
                  {/* Monthly Sales Chart Section */}
                  <section className="bg-[#141414] border border-zinc-800/30 rounded">
                    <div className="flex">
                      <div className="flex-1 p-4 border-r border-zinc-800/30">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h2 className="text-lg font-medium text-zinc-200">Caixa mensal - {currentYear}</h2>
                            <p className="text-[11px] text-zinc-500">Só entradas de dinheiro (VD, RC e FT pagas no momento)</p>
                          </div>
                          <div className="flex items-center gap-4 text-zinc-500">
                            <button onClick={() => void fetchDashboardData()} className="hover:text-zinc-300 transition-colors"><RotateCcw size={16} /></button>
                            <button className="hover:text-zinc-300 transition-colors"><ChevronLeft size={16} /></button>
                            <button className="hover:text-zinc-300 transition-colors"><ChevronRight size={16} /></button>
                          </div>
                        </div>
                        
                        <div className="h-[200px] w-full relative">
                          {isMounted && (
                            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} debounce={100}>
                            <BarChart data={monthlySalesData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                              <XAxis 
                                dataKey="name" 
                                stroke="#444" 
                                fontSize={10} 
                                tickLine={false} 
                                axisLine={false} 
                              />
                              <YAxis 
                                stroke="#444" 
                                fontSize={10} 
                                tickLine={false} 
                                axisLine={false} 
                                tickFormatter={(value) => formatPrice(value)}
                              />
                              <Tooltip 
                                cursor={{ fill: '#222' }}
                                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', fontSize: '10px' }}
                                formatter={(value: any) => [formatPrice(value), 'Caixa']}
                              />
                              <Bar dataKey="sales" fill={monthlyBarColors[0]} radius={[2, 2, 0, 0]}>
                                {monthlySalesData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={monthlyBarColors[index % monthlyBarColors.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                          )}
                        </div>
                        <div className="flex justify-between mt-2 px-10">
                          {monthlySalesData.map((d, i) => (
                            <span key={i} className="text-[10px] text-zinc-600 font-bold">{formatPrice(d.sales)}</span>
                          ))}
                        </div>
                      </div>
                      
                      <div className="w-48 p-4 flex flex-col justify-between bg-[#111]">
                        <div>
                          <p className="text-[11px] font-medium text-zinc-500 capitalize tracking-wider">Caixa do mês</p>
                          <p className="text-xs font-bold text-zinc-300 mt-1">{currentMonthSummary.name}</p>
                          <h3 className="text-4xl font-bold text-white mt-1">{formatPrice(currentMonthSummary.sales)}</h3>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <p className="text-[10px] text-zinc-500">Soma dos meses:</p>
                            <p className="text-xs font-bold text-zinc-300">Total em caixa (ano)</p>
                          </div>
                          <h4 className="text-xl font-bold text-zinc-400">{formatPrice(totalSales)}</h4>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Periodic Reports Header */}
                  <div className="flex items-center gap-2 py-1">
                    <h3 className="text-sm font-medium text-zinc-400">Relatórios Periódicos ( {currentDate} - {currentDate} )</h3>
                    <Calendar size={14} className="text-zinc-500 cursor-pointer hover:text-zinc-300" />
                  </div>

                  {/* Widgets Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <SyncStatusPanel />

                    <DashboardWidget title="Principais produtos (mês)">
                      {topProducts.length > 0 ? (
                        <div className="w-full space-y-2">
                          {topProducts.map((p, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-zinc-400">{p.name}</span>
                              <span className="text-zinc-200 font-bold">{p.sales} un.</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </DashboardWidget>
                    
                    <DashboardWidget title="Principais clientes (mês)">
                      {topCustomers.length > 0 ? (
                        <div className="w-full space-y-2">
                          {topCustomers.map((customer, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-zinc-400">{customer.name}</span>
                              <span className="text-zinc-200 font-bold">{formatPrice(customer.total)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </DashboardWidget>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'products' && <ProductsManager />}
          {activeTab === 'docs' && <DocumentsManager />}
          {activeTab === 'inventory' && <InventoryManager />}
          {activeTab === 'reports' && <ReportsManager />}
          {activeTab === 'customers' && <CustomersSuppliersManager />}
          {activeTab === 'payments' && <PaymentMethodsManager />}
          {activeTab === 'security' && <UsersSecurityManager />}
          {activeTab === 'logs' && <SystemLogsManager />}
          {activeTab === 'license-serials' && !isPackagedDesktop && <LicenseSerialManager />}
          {activeTab === 'company' && <MyCompanyManager />}
          {activeTab === 'gerenciamento' && <GerenciamentoManager />}
          
          {activeTab !== 'dashboard' &&
            activeTab !== 'products' &&
            activeTab !== 'docs' &&
            activeTab !== 'inventory' &&
            activeTab !== 'reports' &&
            activeTab !== 'customers' &&
            activeTab !== 'payments' &&
            activeTab !== 'security' &&
            activeTab !== 'logs' &&
            activeTab !== 'license-serials' &&
            activeTab !== 'company' &&
            activeTab !== 'gerenciamento' && (
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

function DashboardWidget({ title, subtitle, isLarge, children }: { title: string, subtitle?: string, isLarge?: boolean, children?: React.ReactNode }) {
  return (
    <div className={`bg-[#141414] border border-zinc-800/50 rounded-lg p-4 flex flex-col min-h-[250px] hover:border-zinc-700 transition-colors ${isLarge ? 'md:col-span-2' : ''}`}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold text-zinc-300 capitalize tracking-wider">{title}</h4>
          {subtitle && <p className="text-[10px] text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="w-2 h-2 rounded-full bg-blue-500/50" />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center">
        {children || <span className="text-xs text-zinc-600 italic">Sem dados para exibir</span>}
      </div>
    </div>
  );
}

