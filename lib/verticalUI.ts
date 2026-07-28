import type { VerticalId } from '@/lib/capabilities';

export type VerticalUILabels = {
  tableSingular: string;
  tablePlural: string;
  orderSingular: string;
  orderPlural: string;
  itemSingular: string;
  itemPlural: string;
  managementTitle: string;
};

const DEFAULT_LABELS: VerticalUILabels = {
  tableSingular: 'Mesa',
  tablePlural: 'Mesas',
  orderSingular: 'Pedido',
  orderPlural: 'Pedidos',
  itemSingular: 'Produto',
  itemPlural: 'Produtos',
  managementTitle: 'Gestão',
};

const VERTICAL_LABELS: Record<VerticalId, VerticalUILabels> = {
  restauracao: {
    tableSingular: 'Mesa',
    tablePlural: 'Mesas',
    orderSingular: 'Pedido',
    orderPlural: 'Pedidos',
    itemSingular: 'Produto',
    itemPlural: 'Produtos',
    managementTitle: 'Gestão Restauração',
  },
  retalho: {
    tableSingular: 'Posto',
    tablePlural: 'Postos',
    orderSingular: 'Venda',
    orderPlural: 'Vendas',
    itemSingular: 'Produto',
    itemPlural: 'Produtos',
    managementTitle: 'Gestão Retalho',
  },
  farmacia: {
    tableSingular: 'Posto',
    tablePlural: 'Postos',
    orderSingular: 'Venda',
    orderPlural: 'Vendas',
    itemSingular: 'Produto',
    itemPlural: 'Produtos',
    managementTitle: 'Gestão Farmácia',
  },
  barbearia: {
    tableSingular: 'Cadeira',
    tablePlural: 'Cadeiras',
    orderSingular: 'Marcação',
    orderPlural: 'Marcações',
    itemSingular: 'Serviço',
    itemPlural: 'Serviços',
    managementTitle: 'Gestão Barbearia',
  },
  salao_beleza: {
    tableSingular: 'Cadeira',
    tablePlural: 'Cadeiras',
    orderSingular: 'Marcação',
    orderPlural: 'Marcações',
    itemSingular: 'Serviço',
    itemPlural: 'Serviços',
    managementTitle: 'Gestão Salão de Beleza',
  },
  ginasio: {
    tableSingular: 'Lugar',
    tablePlural: 'Lugares',
    orderSingular: 'Sessão',
    orderPlural: 'Sessões',
    itemSingular: 'Serviço',
    itemPlural: 'Serviços',
    managementTitle: 'Gestão Ginásio',
  },
  talho: {
    tableSingular: 'Posto',
    tablePlural: 'Postos',
    orderSingular: 'Venda',
    orderPlural: 'Vendas',
    itemSingular: 'Produto',
    itemPlural: 'Produtos',
    managementTitle: 'Gestão Talho',
  },
  supermercado: {
    tableSingular: 'Posto',
    tablePlural: 'Postos',
    orderSingular: 'Venda',
    orderPlural: 'Vendas',
    itemSingular: 'Produto',
    itemPlural: 'Produtos',
    managementTitle: 'Gestão Supermercado',
  },
  graficas: {
    tableSingular: 'Trabalho',
    tablePlural: 'Trabalhos',
    orderSingular: 'Ordem',
    orderPlural: 'Ordens',
    itemSingular: 'Serviço',
    itemPlural: 'Serviços',
    managementTitle: 'Gestão Gráficas',
  },
  hotelaria: {
    tableSingular: 'Quarto',
    tablePlural: 'Quartos',
    orderSingular: 'Reserva',
    orderPlural: 'Reservas',
    itemSingular: 'Serviço',
    itemPlural: 'Serviços',
    managementTitle: 'Gestão Hotelaria',
  },
};

export function getVerticalUILabels(vertical: VerticalId): VerticalUILabels {
  return VERTICAL_LABELS[vertical] || DEFAULT_LABELS;
}
