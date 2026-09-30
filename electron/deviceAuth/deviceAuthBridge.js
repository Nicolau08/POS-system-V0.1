/**
 * Ponte Electron -> API local para o Device Access JWT (Etapa 1F.2, itens 26-31).
 *
 * Decisão de arquitectura (item 28/31, opção B/31 combinadas): o refresh
 * credential NUNCA sai do processo Electron main — só ele tem acesso ao
 * safeStorage (deviceAuthStorage.js) e ao Token Provider (deviceAuthClient.js).
 * O processo `api/server.js` (onde corre syncService.js) não pode receber um
 * access JWT estático via variável de ambiente porque ele expira/rotaciona
 * (opção A do pedido, explicitamente rejeitada) — em vez disso, expõe-se um
 * endpoint HTTP loopback MÍNIMO que o processo da API chama sempre que
 * precisa de um token actual, e o Electron responde sempre com o token válido
 * mais recente (chamando getValidAccessToken() — já faz refresh + single-flight
 * internamente). Isto mantém o Electron como ÚNICO dono do refresh credential
 * (item 27) e dá à API renovação limpa sem lhe confiar o segredo de longa duração.
 *
 * Segurança do loopback (item 30 — nunca um `GET /token` aberto):
 *  - Bind exclusivo a 127.0.0.1 (nunca 0.0.0.0) — inacessível fora da máquina.
 *  - Porta efémera (porta 0 => atribuída pelo SO), nunca uma porta fixa
 *    adivinhável — reduz a superfície para outro processo local descobrir o
 *    endpoint às cegas.
 *  - Segredo aleatório de 32 bytes gerado DE NOVO a cada arranque do Electron
 *    (nunca persistido, nunca logado) — exigido como `Authorization: Bearer
 *    <secret>`; sem ele, pedido rejeitado com 401 antes de tocar em qualquer
 *    lógica de token. Isto é o MESMO padrão de confiança já usado para
 *    POS_DB_ENCRYPTION_KEY (electron/main.js: passado ao processo filho via
 *    variável de ambiente do `spawn()` — nunca escrito em disco) — não introduz
 *    uma classe de risco nova, reutiliza uma já aceite nesta base de código.
 *  - Método POST (nunca GET) — evita que o token fique em logs de acesso HTTP
 *    convencionais que assumem GET idempotente/cacheável.
 *  - Body de resposta nunca inclui o refresh token — só o access JWT actual.
 */
import http from 'http';
import crypto from 'crypto';
import { getValidAccessToken, peekDeviceAuthDiagnostic, peekValidAccessToken } from './deviceAuthClient.js';

let server = null;
let bridgeSecret = null;
let bridgeIssuerBaseUrl = null;

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function readBearerToken(req) {
  const header = String(req.headers['authorization'] ?? '');
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

/**
 * @param {{ userDataPath: string, issuerBaseUrl: string }} params
 * @returns {Promise<{ url: string, secret: string }>}
 */
export function startDeviceAuthBridge({ userDataPath, issuerBaseUrl }) {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve({ url: server.__bridgeUrl, secret: bridgeSecret });
      return;
    }

    bridgeSecret = crypto.randomBytes(32).toString('hex');
    bridgeIssuerBaseUrl = issuerBaseUrl;

    const handler = (req, res) => {
      if (
        req.method !== 'POST' ||
        (req.url !== '/access-token' && req.url !== '/diagnostic' && req.url !== '/access-token-cached')
      ) {
        res.writeHead(404).end();
        return;
      }
      const token = readBearerToken(req);
      if (!token || !timingSafeEqual(token, bridgeSecret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ ok: false, error: 'unauthorized' }),
        );
        return;
      }

      if (req.url === '/access-token-cached') {
        // Pilot Gate — sonda só-leitura: devolve o token em cache SÓ se ainda
        // válido; nunca chama getValidAccessToken()/refresh.
        const cached = peekValidAccessToken({ userDataPath });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify(cached ? { ok: true, accessToken: cached } : { ok: false, error: 'token_not_cached' }),
        );
        return;
      }

      if (req.url === '/diagnostic') {
        // Pilot Gate — diagnóstico só-leitura: NUNCA chama getValidAccessToken()
        // (isso poderia disparar um refresh de rede) — só espreita o estado já
        // existente em disco/memória, via peekDeviceAuthDiagnostic().
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let localTenantId = null;
          try {
            const parsed = JSON.parse(body || '{}');
            localTenantId = parsed?.localTenantId ? String(parsed.localTenantId) : null;
          } catch {
            // corpo inválido — segue sem tenant local, campo fica "unknown".
          }
          const diagnostic = peekDeviceAuthDiagnostic({ userDataPath, localTenantId });
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              ok: true,
              diagnostic: {
                ...diagnostic,
                license_console_base_url_present: Boolean(bridgeIssuerBaseUrl),
              },
            }),
          );
        });
        return;
      }

      getValidAccessToken({ userDataPath, issuerBaseUrl })
        .then((accessToken) => {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(
            JSON.stringify(accessToken ? { ok: true, accessToken } : { ok: false, error: 'device_auth_unavailable' }),
          );
        })
        .catch(() => {
          // Nunca deixar uma excepção aqui derrubar o servidor local — devolve
          // "indisponível", nunca propaga um 500 com detalhe interno.
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({ ok: false, error: 'device_auth_unavailable' }),
          );
        });
    };

    server = http.createServer(handler);
    server.on('error', reject);
    // Porta 0 = o SO escolhe uma porta livre e efémera; nunca fixa/adivinhável.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}/access-token`;
      server.__bridgeUrl = url;
      resolve({ url, secret: bridgeSecret });
    });
  });
}

export function stopDeviceAuthBridge() {
  if (!server) return;
  server.close();
  server = null;
  bridgeSecret = null;
  bridgeIssuerBaseUrl = null;
}
