/**
 * Etapa 1G.3.6 - LAN so por TLS, sem HTTP paralelo para a rede:
 *   - HTTP  apenas em 127.0.0.1:PORT (o POS do proprio Server, inalterado);
 *   - HTTPS em cada IPv4 nao-loopback da maquina, mesma PORT (enderecos diferentes => sem conflito).
 * Nenhum listener HTTP existe nos enderecos LAN: uma ligacao HTTP a partir da rede e recusada pelo sistema operativo.
 * (Multiplexar as duas coisas na mesma porta farejando o 1.o byte foi descartado: o TLSSocket toma o handle e perde o byte lido.)
 * Interfaces novas so passam a ter HTTPS apos reiniciar (o mesmo que ja acontecia com o bind da LAN).
 */
import http from 'http';
import https from 'https';
import os from 'os';

export function lanIpv4Addresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const n of entries ?? []) {
      if ((n.family === 'IPv4' || n.family === 4) && !n.internal) out.push(n.address);
    }
  }
  return [...new Set(out)];
}

export function createLanTlsServers(app, { cert, key }) {
  const httpServer = http.createServer(app);
  const httpsServers = [];
  const errorHandlers = [];
  const facade = {
    on(event, fn) {
      if (event === 'error') {
        errorHandlers.push(fn);
        httpServer.on('error', fn);
      }
      return facade;
    },
    listen(port, _host, cb) {
      const addrs = lanIpv4Addresses();
      httpServer.listen(port, '127.0.0.1', () => {
        let pending = addrs.length;
        if (pending === 0) return cb?.();
        for (const addr of addrs) {
          const s = https.createServer({ cert, key, minVersion: 'TLSv1.2' }, app);
          httpsServers.push(s);
          for (const fn of errorHandlers) s.on('error', fn);
          s.listen(port, addr, () => {
            pending -= 1;
            if (pending === 0) cb?.();
          });
        }
        return undefined;
      });
      return facade;
    },
    close(cb) {
      httpServer.close();
      for (const s of httpsServers) s.close();
      cb?.();
    },
  };
  return facade;
}
