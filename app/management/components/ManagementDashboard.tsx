'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Banknote,
  CreditCard,
  Package,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Undo2,
  Users,
} from 'lucide-react';
import type { DashboardPeriodFilter, DashboardPeriodPreset, PosDashboardSlice } from '@/lib/posSessionCache';
import { getPaymentMethodColor } from '@/lib/paymentMethodLabel';
import PosSelect from '@/components/PosSelect';
import PeriodRangePicker from '@/components/PeriodRangePicker';
import SyncStatusPanel from './SyncStatusPanel';

const ResponsiveContainer = dynamic(() => import('recharts').then((mod) => mod.ResponsiveContainer), {
  ssr: false,
});
const AreaChart = dynamic(() => import('recharts').then((mod) => mod.AreaChart), { ssr: false });
const Area = dynamic(() => import('recharts').then((mod) => mod.Area), { ssr: false });
const PaymentMethodsPie = dynamic(
  () =>
    import('recharts').then(({ ResponsiveContainer, PieChart, Pie, Cell, Tooltip }) => {
      function PaymentMethodsPieChart({
        data,
        formatPrice,
      }: {
        data: { name: string; value: number; percent: number; fill: string }[];
        formatPrice: (value: number) => string;
      }) {
        return (
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={78}
                paddingAngle={3}
                stroke="var(--pos-card)"
                strokeWidth={2}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} stroke={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatPrice(Number(value))}
                contentStyle={{
                  backgroundColor: 'var(--pos-surface)',
                  border: '1px solid var(--pos-border)',
                  borderRadius: '8px',
                  fontSize: '11px',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        );
      }
      return PaymentMethodsPieChart;
    }),
  { ssr: false },
);
const XAxis = dynamic(() => import('recharts').then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((mod) => mod.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then((mod) => mod.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then((mod) => mod.Tooltip), { ssr: false });
const BarChart = dynamic(() => import('recharts').then((mod) => mod.BarChart), { ssr: false });
const Bar = dynamic(() => import('recharts').then((mod) => mod.Bar), { ssr: false });

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const PERIOD_PRESETS: { preset: DashboardPeriodPreset; label: string }[] = [
  { preset: 'today', label: 'Hoje' },
  { preset: 'yesterday', label: 'Ontem' },
  { preset: 'week', label: '7 dias' },
  { preset: 'month', label: 'Mês' },
  { preset: 'year', label: 'Ano' },
  { preset: 'custom', label: 'Personalizado' },
];

function formatMonthYearLabelPt(from: string): string {
  const year = from.slice(0, 4);
  const monthIndex = Number(from.slice(5, 7)) - 1;
  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return from;
  }
  return `${MONTH_NAMES_PT[monthIndex]} ${year}`;
}

function buildYearPeriod(year: number): DashboardPeriodFilter {
  return { preset: 'year', from: `${year}-01-01`, to: `${year}-12-31` };
}

function buildMonthPeriod(yearMonth: string): DashboardPeriodFilter {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const from = `${yearStr}-${monthStr}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
  return { preset: 'month', from, to };
}

function buildPeriodFromPreset(preset: DashboardPeriodPreset, current?: DashboardPeriodFilter): DashboardPeriodFilter {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  if (preset === 'today') {
    return { preset, from: today, to: today };
  }

  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const day = y.toISOString().slice(0, 10);
    return { preset, from: day, to: day };
  }

  if (preset === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { preset, from: start.toISOString().slice(0, 10), to: today };
  }

  if (preset === 'year') {
    const year = now.getFullYear();
    return { preset, from: `${year}-01-01`, to: `${year}-12-31` };
  }

  if (preset === 'month') {
    if (current?.preset === 'month' && current.from) {
      return buildMonthPeriod(current.from.slice(0, 7));
    }
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return buildMonthPeriod(`${year}-${month}`);
  }

  if (preset === 'custom') {
    return {
      preset: 'custom',
      from: current?.from ?? today,
      to: current?.to ?? today,
    };
  }

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return buildMonthPeriod(`${year}-${month}`);
}

const KPI_CARDS = [
  {
    key: 'totalVendas',
    label: 'Total vendas',
    gradient: 'from-[#6c70f6] to-[#4a4ed4]',
    icon: ShoppingCart,
    sparkKey: 'vendas' as const,
  },
  {
    key: 'totalCaixa',
    label: 'Total de caixa',
    gradient: 'from-[#8386f8] to-[#6c70f6]',
    icon: Banknote,
    sparkKey: 'caixa' as const,
  },
  {
    key: 'creditSales',
    label: 'Vendas a crédito',
    gradient: 'from-[#6c70f6] to-[#e88989]',
    icon: CreditCard,
    sparkKey: 'vendas' as const,
  },
  {
    key: 'returns',
    label: 'Devoluções',
    gradient: 'from-[#e88989] to-[#d97a7a]',
    icon: Undo2,
    sparkKey: 'caixa' as const,
  },
] as const;

type ManagementDashboardProps = {
  isMounted: boolean;
  currentYear: number;
  data: PosDashboardSlice;
  periodFilter: DashboardPeriodFilter;
  onPeriodChange: (filter: DashboardPeriodFilter) => void;
  isRefreshing?: boolean;
  onRefresh: () => void;
  formatPrice: (value: number) => string;
};

export default function ManagementDashboard({
  isMounted,
  currentYear,
  data,
  periodFilter,
  onPeriodChange,
  isRefreshing = false,
  onRefresh,
  formatPrice,
}: ManagementDashboardProps) {
  const [chartMode, setChartMode] = useState<'vendas' | 'caixa'>('vendas');

  const period = data.period ?? {
    monthLabel: '---',
    totalVendas: 0,
    totalCaixa: 0,
    creditSales: 0,
    returns: 0,
  };

  const periodLabel = useMemo(() => {
    if (periodFilter.preset === 'month' && periodFilter.from) {
      return formatMonthYearLabelPt(periodFilter.from);
    }
    return period.monthLabel;
  }, [period.monthLabel, periodFilter.from, periodFilter.preset]);

  const chartData = useMemo(
    () =>
      (data.monthlySalesData ?? []).map((row) => ({
        name: row.name,
        vendas: Number(row.vendas ?? row.sales ?? 0),
        caixa: Number(row.sales ?? 0),
      })),
    [data.monthlySalesData],
  );

  const sparkData = useMemo(() => chartData.slice(-6), [chartData]);

  const paymentTypes = data.paymentTypes ?? [];
  const paymentChartData = useMemo(
    () =>
      paymentTypes.map((row, index) => ({
        ...row,
        fill: getPaymentMethodColor(row.name, index),
      })),
    [paymentTypes],
  );
  const topProducts = data.topProducts ?? [];
  const topEmployees = data.topEmployees ?? [];

  const handlePresetClick = (preset: DashboardPeriodPreset) => {
    onPeriodChange(buildPeriodFromPreset(preset, periodFilter));
  };

  const monthPickerValue = periodFilter.from.slice(0, 7);
  const selectedMonthYear = useMemo(() => {
    const [yearStr, monthStr] = monthPickerValue.split('-');
    return {
      year: Number(yearStr),
      month: Number(monthStr),
    };
  }, [monthPickerValue]);

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, index) => current - 5 + index);
  }, []);

  const handleMonthSelect = (month: number) => {
    if (!Number.isFinite(month) || month < 1 || month > 12) return;
    const monthStr = String(month).padStart(2, '0');
    onPeriodChange(buildMonthPeriod(`${selectedMonthYear.year}-${monthStr}`));
  };

  const handleMonthYearSelect = (year: number) => {
    if (!Number.isFinite(year)) return;
    const monthStr = String(selectedMonthYear.month).padStart(2, '0');
    onPeriodChange(buildMonthPeriod(`${year}-${monthStr}`));
  };

  const handleYearOnlySelect = (year: number) => {
    if (!Number.isFinite(year)) return;
    onPeriodChange(buildYearPeriod(year));
  };

  const handleCalendarApply = (from: string, to: string) => {
    onPeriodChange({ preset: 'custom', from, to });
  };

  const showMonthFilter = periodFilter.preset === 'month';
  const showYearFilter = periodFilter.preset === 'year';
  const showCalendarFilter = !showMonthFilter && !showYearFilter;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
      <div className="flex flex-col gap-3 rounded border border-pos-border bg-pos-card px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.15)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {showMonthFilter ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-pos-muted">Mês</span>
                  <PosSelect
                    size="sm"
                    className="w-[7.25rem]"
                    triggerClassName="!h-9 px-2.5"
                    align="center"
                    value={String(selectedMonthYear.month)}
                    onChange={(value) => handleMonthSelect(Number(value))}
                    disabled={isRefreshing}
                    options={MONTH_NAMES_PT.map((label, index) => ({
                      value: String(index + 1),
                      label,
                    }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-pos-muted">Ano</span>
                  <PosSelect
                    size="sm"
                    className="w-[6.25rem]"
                    triggerClassName="!h-9 px-2"
                    align="center"
                    value={String(selectedMonthYear.year)}
                    onChange={(value) => handleMonthYearSelect(Number(value))}
                    disabled={isRefreshing}
                    options={yearOptions.map((year) => ({
                      value: String(year),
                      label: String(year),
                    }))}
                  />
                </div>
              </>
            ) : null}
            {showYearFilter ? (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-pos-muted">Ano</span>
                <PosSelect
                  size="sm"
                  className="w-[6.25rem]"
                  triggerClassName="!h-9 px-2"
                  align="center"
                  value={String(Number(periodFilter.from.slice(0, 4)) || new Date().getFullYear())}
                  onChange={(value) => handleYearOnlySelect(Number(value))}
                  disabled={isRefreshing}
                  options={yearOptions.map((year) => ({
                    value: String(year),
                    label: String(year),
                  }))}
                />
              </div>
            ) : null}
            {showCalendarFilter ? (
              <PeriodRangePicker
                from={periodFilter.from}
                to={periodFilter.to}
                onApply={handleCalendarApply}
                disabled={isRefreshing}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {PERIOD_PRESETS.map(({ preset, label }) => (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetClick(preset)}
                disabled={isRefreshing}
                className={`flex h-9 min-w-9 items-center justify-center rounded px-3 text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                  periodFilter.preset === preset
                    ? 'bg-[#0001fb] text-white'
                    : 'border border-pos-border bg-pos-bg text-pos-muted hover:border-[#0001fb]/40 hover:text-pos-fg-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="xl:col-span-2 rounded border border-pos-border bg-pos-card p-5 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-pos-fg">Painel de vendas</h2>
              <p className="mt-0.5 text-xs text-pos-muted">
                Período: {periodLabel}
                {period.preset === 'year' ? ` · ${currentYear}` : ''}
                {' · '}melhor mês em caixa: {data.bestMonth} ({formatPrice(data.bestMonthValue)})
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded border border-pos-border bg-pos-bg p-0.5">
                {(['vendas', 'caixa'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setChartMode(mode)}
                    className={`rounded px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                      chartMode === mode
                        ? 'bg-[#0001fb] text-white'
                        : 'text-pos-muted hover:text-pos-fg-soft'
                    }`}
                  >
                    {mode === 'vendas' ? 'Vendas' : 'Caixa'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="rounded border border-pos-border p-2 text-pos-muted transition-colors hover:border-[#0001fb]/50 hover:text-[#0001fb] disabled:opacity-60"
                title="Actualizar dados"
              >
                <RotateCcw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricPill label="Vendas (período)" value={formatPrice(period.totalVendas)} accent="#6c70f6" />
            <MetricPill label="Caixa (período)" value={formatPrice(period.totalCaixa)} accent="#4f53e0" />
            <MetricPill label="Crédito (período)" value={formatPrice(period.creditSales)} accent="#5b5fe8" />
            <MetricPill label="Caixa (ano)" value={formatPrice(data.totalSales)} accent="#c45c5c" />
          </div>

          <div className="h-[240px] w-full">
            {isMounted ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} debounce={100}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashVendas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6c70f6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#6c70f6" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="dashCaixa" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e88989" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#e88989" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--pos-border)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="#8b8db0"
                    tick={{ fill: '#4a4868', fontSize: 10 }}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#8b8db0"
                    tick={{ fill: '#4a4868', fontSize: 10 }}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                  />
                  <Tooltip
                    cursor={{ stroke: 'rgba(108, 112, 246, 0.35)', strokeWidth: 1 }}
                    contentStyle={{
                      backgroundColor: 'var(--pos-surface)',
                      border: '1px solid var(--pos-border)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value, key) => [
                      formatPrice(Number(value)),
                      key === 'vendas' ? 'Vendas' : 'Caixa',
                    ]}
                  />
                  {chartMode === 'vendas' ? (
                    <Area
                      type="monotone"
                      dataKey="vendas"
                      stroke="#6c70f6"
                      strokeWidth={2.5}
                      fill="url(#dashVendas)"
                    />
                  ) : (
                    <Area type="monotone" dataKey="caixa" stroke="#e88989" strokeWidth={2.5} fill="url(#dashCaixa)" />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </section>

        <section className="rounded border border-pos-border bg-pos-card p-5 shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
          <h3 className="text-sm font-semibold text-pos-fg">Tipos de pagamento</h3>
          <p className="mt-0.5 text-xs text-pos-muted">Distribuição no período seleccionado</p>
          <div className="mt-4 h-[200px]">
            {isMounted && paymentChartData.length > 0 ? (
              <PaymentMethodsPie data={paymentChartData} formatPrice={formatPrice} />
            ) : (
              <EmptyState message="Sem pagamentos registados neste período" />
            )}
          </div>
          <div className="mt-2 space-y-2">
            {paymentChartData.slice(0, 5).map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-pos-muted">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: row.fill }}
                  />
                  <span className="truncate">{row.name}</span>
                </span>
                <span className="shrink-0 font-semibold text-pos-fg-soft">
                  {row.percent}% · {formatPrice(row.value)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_CARDS.map((card) => {
          const Icon = card.icon;
          const value = period[card.key as keyof typeof period];
          const numericValue = typeof value === 'number' ? value : 0;
          return (
            <article
              key={card.key}
              className={`relative overflow-hidden rounded bg-gradient-to-br ${card.gradient} p-4 text-white shadow-lg`}
            >
              <div className="relative z-10">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-white/85">{card.label}</p>
                  <Icon size={18} className="text-white/80" />
                </div>
                <p className="mt-2 text-2xl font-bold tracking-tight">{formatPrice(numericValue)}</p>
                <p className="mt-1 text-[11px] text-white/75">{periodLabel}</p>
              </div>
              <div className="relative z-10 mt-3 h-10 opacity-90">
                {isMounted ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={sparkData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                      <Bar dataKey={card.sparkKey} fill="rgba(255,255,255,0.45)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
              <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
            </article>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded border border-pos-border bg-pos-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Package size={18} className="text-[#0001fb]" />
            <div>
              <h3 className="text-sm font-semibold text-pos-fg">Produtos mais vendidos</h3>
              <p className="text-xs text-pos-muted">Top 5 do período</p>
            </div>
          </div>
          {topProducts.length > 0 ? (
            <ol className="space-y-0">
              {topProducts.map((product, index) => (
                <li key={`${product.name}-${index}`} className="relative flex gap-4 pb-5 last:pb-0">
                  {index < topProducts.length - 1 ? (
                    <span className="absolute left-[15px] top-8 bottom-0 w-px bg-pos-border" aria-hidden />
                  ) : null}
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#0001fb]/40 bg-[#0001fb]/15 text-xs font-bold text-[#a5b4fc]">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="truncate text-sm font-medium text-pos-fg-soft">{product.name}</p>
                    <p className="mt-0.5 text-xs text-pos-muted">
                      {product.sales} un. · {formatPrice(Number(product.price ?? 0) * Number(product.sales ?? 0))}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState message="Ainda sem vendas de produtos neste período" />
          )}
        </section>

        <section className="rounded border border-pos-border bg-pos-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users size={18} className="text-[#0001fb]" />
            <div>
              <h3 className="text-sm font-semibold text-pos-fg">Vendas por empregado</h3>
              <p className="text-xs text-pos-muted">Top 5 do período</p>
            </div>
          </div>
          {topEmployees.length > 0 ? (
            <div className="overflow-hidden rounded border border-pos-border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-pos-border bg-pos-surface text-[10px] font-bold uppercase tracking-wider text-pos-muted">
                    <th className="px-3 py-2.5">#</th>
                    <th className="px-3 py-2.5">Empregado</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {topEmployees.map((employee, index) => (
                    <tr
                      key={`${employee.name}-${index}`}
                      className="border-b border-pos-border/60 last:border-0 odd:bg-pos-bg/40"
                    >
                      <td className="px-3 py-2.5 text-pos-muted">{index + 1}</td>
                      <td className="px-3 py-2.5 font-medium text-pos-fg-soft">{employee.name}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[#a5b4fc]">
                        {formatPrice(employee.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="Sem vendas associadas a empregados neste período" />
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SyncStatusPanel />
        <section className="rounded border border-pos-border bg-pos-card p-4 flex items-center gap-3 text-xs text-pos-muted">
          <RefreshCw size={16} className="shrink-0 text-[#0001fb]" />
          <p>
            Os totais reflectam o período seleccionado ({periodLabel}). Caixa inclui VD, TK, RC e FT pagas no
            momento. Vendas a crédito incluem documentos em conta corrente. Devoluções incluem notas de crédito e
            vendas anuladas.
          </p>
        </section>
      </div>
    </div>
  );
}

function MetricPill({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded border border-pos-border bg-pos-bg/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-pos-muted">{label}</p>
      <p className="mt-0.5 text-sm font-bold" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center rounded border border-dashed border-pos-border px-4 text-center text-xs italic text-pos-muted">
      {message}
    </div>
  );
}
