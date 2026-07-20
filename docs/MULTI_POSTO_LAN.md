# Multi-posto LAN (POSly)

## Modelo

- **Servidor da loja**: PC com API + SQLite. Active *Acesso LAN* em **Configurações → Postos**.
- **Posto remoto**: mesmo instalador; modo *Posto remoto*; URL do servidor ou *Procurar na rede*.
- Licença: só no servidor; postos herdam (não activam serial próprio).

## Portas

| Ambiente | API | Web |
|----------|-----|-----|
| Dev | 3001 | 3000 |
| Instalador | 3731 | 3730 |

## Firewall Windows

Quando activar acesso LAN no servidor:

1. Permitir entrada TCP na porta da API (3001 ou 3731) em redes Privadas.
2. Evitar Wi‑Fi «guest» / isolamento de clientes — a descoberta e o login falham.
3. Reiniciar a app após mudar o acesso LAN (aplica o bind `0.0.0.0`).

## Descoberta

- Endpoint público: `GET /station/discover` (só se LAN + descoberta activos).
- O posto Electron sonda a subnet (HTTP). Se falhar, use URL manual: `http://IP:porta`.

## Troubleshooting

| Sintoma | Causa provável |
|---------|----------------|
| Login remoto 403 | Acesso LAN desligado no servidor |
| Varredura vazia | Firewall, Wi‑Fi guest, descoberta off |
| Posto sem produtos | URL incorrecta; teste *Testar ligação* |
| Dois servidores | Um PC deve ser servidor; o outro posto |

## Papéis de posto

| Papel | Pode |
|-------|------|
| Caixa | Vendas, pagamento, sessão de caixa |
| Garçom | Abrir/trabalhar mesas; não fecha pagamento nem caixa |
| Consulta | Só consulta (sem vendas) |

## Auth LAN

Login devolve token Bearer; o cliente envia `Authorization: Bearer …` e `X-Station-Code`.

## Checklist regressão

- [ ] Servidor com LAN off: só localhost funciona
- [ ] Servidor com LAN on: 2.º PC (posto) faz login e lista produtos
- [ ] Rodapé mostra «Posto: …» à direita
- [ ] Venda fica com `register_code` do posto
- [ ] Restauração: claim de mesa bloqueia 2.º posto
- [ ] Garçom não fecha pagamento; caixa sim
- [ ] Retalho: sem mesas; venda directa OK
