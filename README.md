# POSly

**Ponto de venda desktop para retalho em Windows** — rápido no balcão, dados na loja, licenciamento controlado por máquina.

| | |
|---|---|
| **Versão** | 1.0.0 |
| **Plataforma** | Windows (instalador NSIS) |
| **Estado** | Piloto 1.0.0 — checklist de validação em PC limpo |

---

## Visão

Pequenas e médias lojas precisam de um POS **fiável offline**, fácil de instalar e de suportar, sem depender sempre de internet. O **POSly** combina caixa, gestão e cópias de segurança numa única aplicação desktop, com activação por licença e consola central para distribuidor ou equipa interna.

---

## Problema → Solução

| Desafio do retalho | Como o POSly responde |
|--------------------|------------------------|
| Internet instável no balcão | API e base **SQLite locais** por instalação |
| Instalação complexa | Um instalador Windows (`POSly Setup 1.0.0.exe`) |
| Controlo de quem usa o software | Licença por **máquina** (voucher ou assinatura HMAC) |
| Operação do dia-a-dia | Caixa + **gestão** (stock, utilizadores, relatórios, backups) |

---

## O que está incluído

- **Caixa** — produtos, carrinho, pagamentos, impressão / recibo
- **Gestão** — utilizadores e permissões, inventário, relatórios, documentos
- **Resiliência** — backups locais da base de dados
- **Licenciamento** — activação por código (voucher), consola web, renovação e runbooks de suporte

Dados por loja/PC em `%APPDATA%\POSly\` (`license.json`, `data\pos.db`).

---

## Arquitectura (resumo)

```
[Loja — Windows]
   POSly (Electron)
      ├── Interface: Next.js + React (TypeScript)
      ├── API local: Node.js + Express (JavaScript)
      └── Dados: SQLite (pos.db)

[Cloud — licenciamento]
   Consola /license-admin → Supabase (PostgreSQL)
```

- **Offline-first** no balcão; cloud usada sobretudo para **emissão e controlo de licenças**.
- Stack: **TypeScript** (interface), **JavaScript** (API e desktop), **SQLite** local + **Supabase** para registo de licenças.

---

## Modelo comercial

- **Licenciamento por instalação / máquina** — activação via voucher ou licença assinada com `machine_id`.
- **Consola de licenças** (`/license-admin`) — registo de clientes (tenants), emissão de códigos, reactivação e auditoria em Supabase.

*Para detalhes comerciais ou demonstração, contacte o autor do repositório.*

---

## Maturidade e validação

- Versão de pacote **1.0.0** com build de instalador documentado.
- Checklist de **piloto em PC limpo**: [docs/TESTE-PILOTO.md](docs/TESTE-PILOTO.md) (~15 passos: instalação, activação, venda de teste, backup).
- Runbooks: [docs/INSTALACAO.md](docs/INSTALACAO.md) (build e implantação), [docs/SUPORTE.md](docs/SUPORTE.md) (renovar licença, trocar máquina, backups).

---

## Repositório e documentação

| Recurso | Conteúdo |
|---------|----------|
| [GitHub](https://github.com/Nicolau08/POS-system-V0.1) | Código e issues |
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Build, PC limpo, PIN admin, migração legado |
| [docs/SUPORTE.md](docs/SUPORTE.md) | Runbook operacional |
| [docs/TESTE-PILOTO.md](docs/TESTE-PILOTO.md) | Checklist piloto 1.0.0 |

---

## Para desenvolvedores

**Pré-requisitos:** Node.js LTS, npm.

### Arranque local

```bash
npm install
copy .env.example .env
```

Edite `.env` com os segredos de desenvolvimento (**nunca** faça commit de `.env`). Lista completa: [.env.example](.env.example).

```bash
npm run dev:full
```

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3001](http://localhost:3001)

Modo desktop (opcional):

```bash
npm run electron-dev
```

Scripts úteis: `npm run dev:tenant:default`, `npm run license:tool`.

### Build do instalador Windows

```bash
npm run electron-dist
```

Gera **apenas o desktop POSly** (modo caixa; sem consola de licenças Electron) em `dist-electron/` (ex.: `POSly Setup 0.1.0.exe`). O `.exe` instalado abre só a janela da aplicação — API e Next correm em segundo plano sem janela CMD. Antes do build, configure `POS_LICENSE_HMAC_SECRET` no `.env.local` (o mesmo segredo usado na consola web `/license-admin` em dev).

### Licenciamento (técnico)

A consola corre no Next.js:

- URL: `/license-admin`
- API: `/api/license-issuer/*` (protegida por `LICENSE_ISSUER_ADMIN_TOKEN`)

Fluxo: registar tenant na consola → gerar voucher → cliente activa no desktop → `license.json` + registo em Supabase (com `POS_LICENSE_ISSUER_BASE_URL`). Migração: `supabase/migrations/20260521_posly_license_issuer.sql`.

### Deploy da consola na Vercel (branch `license-console`)

A consola **não** precisa de Electron nem da API Express. O branch `license-console` é uma **árvore reduzida** (só `/license-admin` + `/api/license-issuer`) para caber no plano Hobby (máx. 12 Serverless Functions). **Não fazer merge deste strip para o `main`.**

1. Na Vercel, importar o repo e fazer deploy do branch **`license-console`**.
2. Definir Environment Variables:

| Variável | Notas |
|----------|--------|
| `POS_LICENSE_HMAC_SECRET` | **Igual** ao injectado no instalador POSly |
| `LICENSE_ISSUER_ADMIN_TOKEN` | Token Bearer para abrir `/license-admin` |
| `SUPABASE_URL` | Projecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave **service_role** (nunca anon) |

3. Deploy → copiar a URL (ex. `https://….vercel.app`).
4. No `.env.local` **antes** do `npm run electron-dist` do desktop:

```env
POS_LICENSE_ISSUER_BASE_URL=https://<url-vercel>
POS_LICENSE_HMAC_SECRET=<mesmo da Vercel>
```

5. Subir versão do desktop (ex. `0.2.2`), gerar instalador e publicar release no GitHub para auto-update.

Na Vercel a raiz `/` redirecciona para `/license-admin`. As APIs `/api/license-issuer/*` estão num único catch-all. O instalador Windows continua a ser gerado a partir do `main` (sem consola no `.exe`).

### Variáveis de ambiente (resumo)

| Variável | Descrição |
|----------|-----------|
| `POS_LICENSE_HMAC_SECRET` | Segredo HMAC (POSly + consola) |
| `POS_LICENSE_ISSUER_BASE_URL` | URL pública da consola (Vercel), **não** localhost em builds de cliente |
| `LICENSE_ISSUER_ADMIN_TOKEN` | Token da consola `/license-admin` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Backend da consola de licenças |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente Supabase (se aplicável) |
| `POS_APP_USERDATA_SUBDIR` | Subpasta em `%APPDATA%` (omissão: `POSly`) |
| `POS_DB_PATH` / `POS_LICENSE_PATH` / `POS_BACKUP_DIR` | Sobrescritas de caminhos (dev/suporte) |
| `NEXT_OUTPUT_STANDALONE` | `1` só no build Electron (`electron-dist`); omitir na Vercel |
