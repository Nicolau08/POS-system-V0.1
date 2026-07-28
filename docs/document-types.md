# Tipos de documento — regras oficiais

Fonte de verdade dos códigos e comportamentos do módulo Documentos.
Códigos legacy continuam a ser lidos (alias); novos documentos usam os códigos desta tabela.

## Clientes

| Tipo | Código | Stock | Pagamento / caixa | Contas | Notas |
|------|--------|-------|-------------------|--------|-------|
| Cotação | **FP** | Não | Não | Não | Proposta; conversível em FT ou VD (conversão para venda real movimenta stock). |
| Fatura | **FT** | ↓ na confirmação/emissão | Separado (RC) | Conta a receber (`pending`) | Estados: rascunho, confirmada, parcialmente paga, paga, anulada. |
| Venda a dinheiro | **VD** | ↓ | Entrada imediata | Pago (`completed`) | Receita + impostos no momento. |
| Ticket | **TK** | ↓ | Entrada imediata | Pago (`completed`) | Mesmo comportamento operacional que VD. |
| Recibo | **RC** | Não | Entrada (liquida FT) | Reduz saldo da FT / cliente | Não é nova venda. |
| Recibo de adiantamento | **RCA** | Não | Entrada como crédito | Crédito do **cliente** (não receita) | Legacy: `AD`. Aplicável depois em FT/VD. |
| Nota de crédito | **NC** | ↑ se devolução física | — | Reduz AR / saldo cliente | Referencia FT origem; quantidades/valores ≤ origem. |

## Fornecedores

| Tipo | Código | Stock | Pagamento / caixa | Contas | Notas |
|------|--------|-------|-------------------|--------|-------|
| Fatura de fornecedor | **FTF** | ↑ | Opcional na emissão | Conta a pagar se não pago | Legacy: `EN/ST`, `PUR`. |
| Nota de débito | **ND** | ↓ se devolução física | — | Reduz AP / crédito fornecedor | Equivalente à NC, do lado fornecedor; referencia FTF. |
| Pagamento | **PAG** | Não | Saída (liquida FTF) | Reduz saldo fornecedor | Espelho do RC. |
| Pagamento adiantado | **PAAD** | Não | Saída como crédito | Crédito junto do **fornecedor** | Não é adiantamento de cliente. |

## Inventário / interno

| Tipo | Código | Stock | Notas |
|------|--------|-------|-------|
| Inventário físico | **INV** | Ajuste à contagem | Corrige divergências sistema vs físico. |
| Desperdício | **DP** | ↓ | Sem venda/receita. Legacy: `WH/LOSS`. |
| Consumo próprio | **CP** | ↓ | Uso interno da empresa; sem venda. |

## Fora de âmbito (nesta implementação)

- Diário contabilístico / plano de contas.
- Stock da FT “só na entrega” (stock na confirmação/emissão).
- Multi-armazém: usa `resolveWarehouseId` / `applyWarehouseDelta` existentes.
