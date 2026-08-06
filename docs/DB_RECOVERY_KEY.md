# Chave de recuperação da BD (por instalação)

**Não existe senha master global.** Cada loja/PC tem a sua chave SQLCipher.

## Onde está na app

Gestão / Definições → **Cópias de segurança**:

1. **Exportar chave de recuperação** — gera um JSON cifrado (AES-256-GCM) com uma senha que escolhes.
2. **Abrir ficheiro de recuperação** — revela a chave hex (só neste PC, admin nível 9 + PIN).

## Requisitos de segurança

- Pedido só em **loopback** (PC servidor)
- Utilizador **admin** com **nível ≥ 9**
- Reconfirmação do **PIN** do utilizador actual
- A chave **nunca** é escrita nos logs de auditoria (só o evento)

## Uso típico

| Situação | Acção |
|----------|--------|
| Piloto / entrega | Exportar uma vez; guardar ficheiro + senha offline (cofre) |
| Trocar PC | Desbloquear chave no PC antigo ou a partir do ficheiro; aplicar no novo fluxo de migração |
| Abrir `.db` noutro programa | SQLCipher + chave hex revelada |

## Dev vs instalador

Em `npm run dev` sem Electron, a API pode **não** ter `POS_DB_ENCRYPTION_KEY` — a exportação responde 409. No instalador Electron a chave está activa.
