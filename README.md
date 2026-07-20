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
- **Resiliência** — backups locais da base de dados (pasta `backups\`, retenção configurável)
- **Licenciamento** — activação por código (voucher), consola web, renovação e runbooks de suporte

Dados por loja/PC em `%APPDATA%\POSly\` (`license.json`, `data\database.db`, `backups\`, chave SQLCipher em `db-encryption.key` via Windows DPAPI).

Na app Electron a BD é **encriptada com SQLCipher**; a chave fica na máquina (Electron `safeStorage`) e **não é pedida ao operador**. Noutro PC o ficheiro sozinho não abre. **BitLocker** continua recomendado no disco do PC.

---

## Arquitectura (resumo)

```
[Loja — Windows]
   POSly (Electron)
      ├── Interface: Next.js + React (TypeScript)
      ├── API local: Node.js + Express (JavaScript)
      └── Dados: SQLite/SQLCipher (database.db) + backups/

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

Portas (para não haver conflito entre consola/dev e o instalador):

| Ambiente | Web POS | API | Consola licenças |
|----------|---------|-----|------------------|
| Dev (`npm run dev`) | 3000 | 3001 | 3002 (`license-console/`) |
| POSly instalado | 3730 | 3731 | Vercel / cloud |

Modo desktop (opcional):

```bash
npm run electron-dev
```

Consola de licenças (projecto separado em `license-console/`):

```bash
npm run licensing:ensure-env
npm run dev:licensing
```

- POS: [http://localhost:3000](http://localhost:3000)
- Consola: [http://localhost:3002/license-admin](http://localhost:3002/license-admin)

Deploy na Vercel: importar o repositório com **Root Directory** = `license-console` (ver `license-console/README.md`).

Scripts úteis: `npm run dev:tenant:default`, `npm run dev:console`, `npm run build:console`.

### Build do instalador Windows

```bash
npm run electron-dist
```

Gera **apenas o desktop POSly** (modo caixa; sem consola de licenças no bundle) em `dist-electron/`. O build exclui `app/license-admin` e `app/api/license-issuer` — a consola vive em `license-console/` (Vercel). Antes do build, configure `POS_LICENSE_HMAC_SECRET` e `POS_LICENSE_ISSUER_BASE_URL` (URL do deploy da consola).

### Licenciamento (técnico)

A consola é um **projecto Next.js separado** em `license-console/`:

- UI: `/license-admin`
- API: `/api/license-issuer/*` (admin protegida por `LICENSE_ISSUER_ADMIN_TOKEN`; endpoints de activação são públicos com HMAC)
- Deploy Vercel: Root Directory = `license-console` (12 funções — cabe no plano Hobby)

Fluxo: registar tenant na consola → gerar serial → cliente activa no desktop → `license.json` + registo em Supabase. O POS chama `POS_LICENSE_ISSUER_BASE_URL` (ex.: `https://licencas.seudominio.com`). Migrações: `license-console/supabase/migrations/` (ou `supabase/migrations/` na raiz).

### Variáveis de ambiente (resumo)

| Variável | Descrição |
|----------|-----------|
| `POS_LICENSE_HMAC_SECRET` | Segredo HMAC (POSly + consola) |
| `POS_LICENSE_ISSUER_BASE_URL` | URL base da consola (ex.: `https://licencas.seudominio.com`) |
| `NEXT_PUBLIC_LICENSE_CONSOLE_URL` | Link para abrir a consola no browser (dev: `http://localhost:3002`) |
| `LICENSE_ISSUER_ADMIN_TOKEN` | Token da consola `/license-admin` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Backend da consola de licenças |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente Supabase (se aplicável) |
| `POS_APP_USERDATA_SUBDIR` | Subpasta em `%APPDATA%` (omissão: `POSly`) |
| `POS_DB_PATH` / `POS_LICENSE_PATH` / `POS_BACKUP_DIR` | Sobrescritas de caminhos (dev/suporte) |
| `POS_DB_ENCRYPTION_KEY` | Chave SQLCipher 256-bit hex (Electron injeta via safeStorage; não definir à mão em produção) |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_RETENTION_COUNT` | Intervalo (omissão 6h) e retenção de backups (omissão 14) |
