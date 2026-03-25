'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
  ChevronLast,
  Loader2
} from 'lucide-react';
import { supabase, isConfigured } from '@/lib/supabase';
import ProductsManager from './components/ProductsManager';
import InventoryManager from './components/InventoryManager';
import ReportsManager from './components/ReportsManager';

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

export default function ManagementPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [isAuthRestored, setIsAuthRestored] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
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

  const startResizing = (e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const stopResizing = () => {
    setIsResizing(false);
  };

  const resize = React.useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      if (newWidth > 60 && newWidth < 400) {
        setSidebarWidth(newWidth);
        if (newWidth < 100) {
          setIsSidebarCollapsed(true);
        } else {
          setIsSidebarCollapsed(false);
        }
      }
    }
  }, [isResizing]);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize]);
  
  // Dashboard Data
  const [monthlySalesData, setMonthlySalesData] = useState(initialMonthlySalesData);
  const [totalSales, setTotalSales] = useState(0);
  const [bestMonth, setBestMonth] = useState('---');
  const [bestMonthValue, setBestMonthValue] = useState(0);
  const [topProducts, setTopProducts] = useState<{name: string, sales: number, price: number}[]>([]);
  const [topGroups, setTopGroups] = useState<{name: string, sales: number}[]>([]);
  const [salesByHour, setSalesByHour] = useState<{hour: string, sales: number}[]>([]);
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

  const fetchDashboardData = React.useCallback(async () => {
    if (!isConfigured) {
      console.warn('Supabase não configurado. Painel de gestão desativado.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // 1. Fetch Orders for the current year
      const currentYear = new Date().getFullYear();
      const startOfYear = `${currentYear}-01-01T00:00:00Z`;
      const endOfYear = `${currentYear}-12-31T23:59:59Z`;

      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .gte('created_at', startOfYear)
        .lte('created_at', endOfYear)
        .eq('status', 'completed');

      if (ordersError) throw ordersError;

      if (orders && orders.length > 0) {
        // Calculate Total Sales
        const total = orders.reduce((acc, order) => acc + (order.total || 0), 0);
        setTotalSales(total);

        // Calculate Monthly Sales
        const monthly = initialMonthlySalesData.map(item => ({ ...item }));
        orders.forEach(order => {
          const date = new Date(order.created_at);
          const monthIndex = date.getMonth();
          monthly[monthIndex].sales += (order.total || 0);
        });
        setMonthlySalesData(monthly);

        // Find Best Month
        let best = { name: '---', value: 0 };
        monthly.forEach(m => {
          if (m.sales > best.value) {
            best = { name: m.name, value: m.sales };
          }
        });
        setBestMonth(best.name);
        setBestMonthValue(best.value);

        // Calculate Sales By Hour
        const hourlyMap: {[key: string]: number} = {};
        orders.forEach(order => {
          const date = new Date(order.created_at);
          const hour = date.getHours().toString().padStart(2, '0') + ':00';
          hourlyMap[hour] = (hourlyMap[hour] || 0) + (order.total || 0);
        });
        const hourly = Object.entries(hourlyMap)
          .map(([hour, sales]) => ({ hour, sales }))
          .sort((a, b) => a.hour.localeCompare(b.hour));
        setSalesByHour(hourly);
      }

      // 2. Fetch Top Products and Categories
      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('product_name, quantity, price, product_id');

      if (itemsError) throw itemsError;

      if (items && items.length > 0) {
        // Fetch products to get categories
        const productIds = Array.from(new Set(items.map(item => item.product_id).filter(Boolean)));
        const { data: products, error: productsError } = await supabase
          .from('products')
          .select('id, categories(name)')
          .in('id', productIds);
        
        const categoryMap: {[key: string]: string} = {};
        if (products) {
          products.forEach((p: any) => {
            categoryMap[p.id] = p.categories?.name || 'Sem Categoria';
          });
        }

        const productMap: {[key: string]: {sales: number, price: number}} = {};
        const groupMap: {[key: string]: number} = {};

        items.forEach(item => {
          if (!productMap[item.product_name]) {
            productMap[item.product_name] = { sales: 0, price: item.price };
          }
          productMap[item.product_name].sales += (item.quantity || 0);

          const catName = categoryMap[item.product_id] || 'Sem Categoria';
          groupMap[catName] = (groupMap[catName] || 0) + (item.quantity || 0);
        });

        const top = Object.entries(productMap)
          .map(([name, data]) => ({ name, sales: data.sales, price: data.price }))
          .sort((a, b) => b.sales - a.sales)
          .slice(0, 5);
        setTopProducts(top);

        const groups = Object.entries(groupMap)
          .map(([name, sales]) => ({ name, sales }))
          .sort((a, b) => b.sales - a.sales)
          .slice(0, 5);
        setTopGroups(groups);
      }

      // 3. Fetch Top Customers
      const { data: customersData, error: customersError } = await supabase
        .from('orders')
        .select('total, customers(name)')
        .not('customer_id', 'is', null);

      if (customersError) throw customersError;

      if (customersData && customersData.length > 0) {
        const customerMap: {[key: string]: number} = {};
        customersData.forEach((order: any) => {
          const name = order.customers?.name || 'Cliente Desconhecido';
          customerMap[name] = (customerMap[name] || 0) + (order.total || 0);
        });
        const topCust = Object.entries(customerMap)
          .map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5);
        setTopCustomers(topCust);
      }

    } catch (err: any) {
      const errorMessage = err.message || (typeof err === 'string' ? err : 'Unknown error');
      console.error('Error fetching dashboard data:', {
        message: errorMessage,
        details: err.details || 'No details',
        hint: err.hint || 'No hint',
        code: err.code || 'No code',
        fullError: err
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const isAuthenticated = restoreAuthState();
    setIsAuthRestored(true);

    if (isAuthenticated) {
      fetchDashboardData();
      return;
    }

    router.replace('/');
  }, [fetchDashboardData, restoreAuthState, router]);

  useEffect(() => {
    const syncSession = () => {
      const isAuthenticated = restoreAuthState();

      if (!isAuthenticated) {
        router.replace('/');
        return;
      }

      router.refresh();
      fetchDashboardData();
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
    if (!isLoggedIn) {
      return;
    }

    const intervalId = window.setInterval(() => {
      router.refresh();
      fetchDashboardData();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [fetchDashboardData, isLoggedIn, router]);

  // Memoize components to prevent unnecessary re-renders
  const sidebarItems = useMemo(() => [
    { id: 'dashboard', icon: <LayoutDashboard size={18} />, label: 'Painel de Controle' },
    { id: 'docs', icon: <FileText size={18} />, label: 'Documentos' },
    { id: 'products', icon: <Package size={18} />, label: 'Produtos' },
    { id: 'inventory', icon: <History size={18} />, label: 'Estoque' },
    { id: 'reports', icon: <BarChart3 size={18} />, label: 'Relatórios' },
    { id: 'customers', icon: <Users size={18} />, label: 'Clientes & Fornecedores' },
    { id: 'promos', icon: <Tag size={18} />, label: 'Promoções & Ações' },
    { id: 'security', icon: <ShieldCheck size={18} />, label: 'Usuários & Segurança' },
    { id: 'payments', icon: <CreditCard size={18} />, label: 'Meios de pagamento' },
    { id: 'countries', icon: <Globe size={18} />, label: 'Países' },
    { id: 'taxes', icon: <Percent size={18} />, label: 'Taxas de impostos' },
    { id: 'company', icon: <Building2 size={18} />, label: 'Minha Empresa' },
  ], []);

  const currentModuleLabel = useMemo(() => {
    return sidebarItems.find((item) => item.id === activeTab)?.label ?? 'Painel de Controle';
  }, [activeTab, sidebarItems]);

  const handleBack = () => {
    router.push('/');
  };

  if (!isAuthRestored) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#1a1a1a] text-zinc-400">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 size={18} className="animate-spin text-blue-500" />
          Restaurando sessao...
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
      {!isConfigured && (
        <div className="bg-rose-600 text-white text-[10px] font-bold py-1 px-4 text-center animate-pulse z-[9999]">
          CONFIGURAÇÃO DO SUPABASE AUSENTE OU INVÁLIDA: Adicione NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY nas Definições (Settings).
        </div>
      )}
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
          className={`bg-[#141414] border-r border-zinc-800/50 flex flex-col transition-all duration-300 relative ${isSidebarCollapsed ? 'w-16' : ''}`}
          style={{ width: isSidebarCollapsed ? 64 : sidebarWidth }}
        >
          <div className="flex-1 pt-0 pb-2 overflow-y-auto custom-scrollbar">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 transition-colors relative group ${
                  activeTab === item.id 
                    ? 'bg-zinc-800/50 text-white shadow-lg shadow-black/20' 
                    : 'hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="flex-shrink-0">{item.icon}</div>
                {!isSidebarCollapsed && <span className="text-xs font-medium truncate capitalize leading-none">{item.label}</span>}
                {isSidebarCollapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                    {item.label}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Resize Handle */}
          <div 
            onMouseDown={startResizing}
            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize transition-colors z-20 ${
              isResizing ? 'bg-blue-500' : 'hover:bg-blue-500/50'
            }`}
          />
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
                  <p className="text-zinc-500 font-medium">Carregando dados do Supabase...</p>
                </div>
              ) : (
                <>
                  {/* Monthly Sales Chart Section */}
                  <section className="bg-[#141414] border border-zinc-800/30 rounded shadow-sm">
                    <div className="flex">
                      <div className="flex-1 p-4 border-r border-zinc-800/30">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h2 className="text-lg font-medium text-zinc-200">Vendas mensais - {currentYear}</h2>
                            <p className="text-[11px] text-zinc-500">Dados de vendas agrupados por mês</p>
                          </div>
                          <div className="flex items-center gap-4 text-zinc-500">
                            <button onClick={fetchDashboardData} className="hover:text-zinc-300 transition-colors"><RotateCcw size={16} /></button>
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
                                formatter={(value: any) => [formatPrice(value), 'Vendas']}
                              />
                              <Bar dataKey="sales" fill="#0099ff" radius={[2, 2, 0, 0]}>
                                {monthlySalesData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill="#0099ff" />
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
                          <p className="text-[11px] font-medium text-zinc-500 capitalize tracking-wider">Total de Vendas</p>
                          <h3 className="text-4xl font-bold text-white mt-1">{formatPrice(totalSales)}</h3>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <p className="text-[10px] text-zinc-500">Mês de melhor desempenho:</p>
                            <p className="text-xs font-bold text-zinc-300">{bestMonth}</p>
                          </div>
                          <h4 className="text-xl font-bold text-zinc-400">{formatPrice(bestMonthValue)}</h4>
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
                    <DashboardWidget title="Principais produtos">
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
                    
                    <DashboardWidget title="Vendas por hora">
                      {salesByHour.length > 0 ? (
                        <div className="w-full space-y-2">
                          {salesByHour.map((h, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-zinc-400">{h.hour}</span>
                              <span className="text-zinc-200 font-bold">{formatPrice(h.sales)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </DashboardWidget>

                    <div className="bg-[#141414] border border-zinc-800/30 rounded p-4 flex flex-col items-center justify-center min-h-[250px]">
                      <p className="text-xs font-medium text-zinc-500 capitalize mb-4">Total de Vendas (Total)</p>
                      <span className="text-[100px] font-bold text-white leading-none">{formatPrice(totalSales)}</span>
                    </div>

                    <DashboardWidget title="Principais grupos de produtos" subtitle="Grupos de produtos mais vendidos no período selecionado">
                      {topGroups.length > 0 ? (
                        <div className="w-full space-y-2">
                          {topGroups.map((g, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-zinc-400">{g.name}</span>
                              <span className="text-zinc-200 font-bold">{g.sales} un.</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </DashboardWidget>
                    
                    <DashboardWidget title="Principais clientes" subtitle="Clientes líderes no período selecionado (5 principais)" isLarge={true}>
                      {topCustomers.length > 0 ? (
                        <div className="w-full space-y-3 mt-4">
                          {topCustomers.map((c, i) => (
                            <div key={i} className="flex items-center gap-4">
                              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 text-xs font-bold">
                                {i + 1}
                              </div>
                              <div className="flex-1">
                                <p className="text-xs font-bold text-zinc-200">{c.name}</p>
                                <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-1 overflow-hidden">
                                  <div 
                                    className="bg-blue-500 h-full rounded-full" 
                                    style={{ width: `${(c.total / totalSales) * 100}%` }}
                                  />
                                </div>
                              </div>
                              <span className="text-xs font-bold text-zinc-400">{formatPrice(c.total)}</span>
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
          {activeTab === 'inventory' && <InventoryManager />}
          {activeTab === 'reports' && <ReportsManager />}
          
          {activeTab !== 'dashboard' && activeTab !== 'products' && activeTab !== 'inventory' && activeTab !== 'reports' && (
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
    <div className={`bg-[#141414] border border-zinc-800/50 rounded-lg p-4 flex flex-col min-h-[250px] shadow-lg hover:border-zinc-700 transition-colors ${isLarge ? 'md:col-span-2' : ''}`}>
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

