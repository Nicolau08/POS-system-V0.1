-- Etapa 1G.2B-FINAL - auditoria: as vistas device_stock_transfers e stock_in_transit (20260924000100) herdaram os
-- privilegios por omissao do schema public (ALL para anon/authenticated). Nao havia fuga (security_invoker: as tabelas
-- base nao concedem nada a anon e so SELECT a authenticated), mas fica fechado por defesa em profundidade.
REVOKE ALL ON public.device_stock_transfers, public.stock_in_transit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.device_stock_transfers, public.stock_in_transit TO authenticated, service_role;
