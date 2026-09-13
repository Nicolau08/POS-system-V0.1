import test from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from '../../api/middlewares/security.middleware.js';

function fakeReq({ ip = '127.0.0.1', method = 'GET', path = '/foo' } = {}) {
  return {
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    method,
    path,
  };
}

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      res.headers[name] = value;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

test('createRateLimiter: deixa passar pedidos abaixo do limite e bloqueia acima', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  try {
    const req = fakeReq();
    let nextCalled = 0;
    const next = () => {
      nextCalled += 1;
    };

    limiter(req, fakeRes(), next);
    limiter(req, fakeRes(), next);
    assert.equal(nextCalled, 2);

    const blockedRes = fakeRes();
    limiter(req, blockedRes, next);
    assert.equal(nextCalled, 2); // next não foi chamado outra vez
    assert.equal(blockedRes.statusCode, 429);
    assert.equal(blockedRes.body.success, false);
  } finally {
    limiter.stop();
  }
});

test('createRateLimiter: sweep() remove buckets expirados mas mantém os válidos', () => {
  const limiter = createRateLimiter({ windowMs: 50, max: 300 });
  try {
    limiter(fakeReq({ path: '/expira' }), fakeRes(), () => {});
    assert.equal(limiter.buckets.size, 1);

    // Espera o bucket expirar e regista um pedido novo com chave diferente.
    const expiredEntry = limiter.buckets.get('127.0.0.1:GET:/expira');
    expiredEntry.resetAt = Date.now() - 1; // força expiração sem esperar tempo real

    limiter(fakeReq({ path: '/ainda-valido' }), fakeRes(), () => {});
    assert.equal(limiter.buckets.size, 2);

    limiter.sweep();

    assert.equal(limiter.buckets.has('127.0.0.1:GET:/expira'), false);
    assert.equal(limiter.buckets.has('127.0.0.1:GET:/ainda-valido'), true);
    assert.equal(limiter.buckets.size, 1);
  } finally {
    limiter.stop();
  }
});

test('createRateLimiter: chaves distintas (rotas/IPs diferentes) não crescem sem limite após sweep', () => {
  const limiter = createRateLimiter({ windowMs: 10, max: 300 });
  try {
    for (let i = 0; i < 50; i += 1) {
      limiter(fakeReq({ ip: `10.0.0.${i}`, path: `/produtos/${i}` }), fakeRes(), () => {});
    }
    assert.equal(limiter.buckets.size, 50);

    for (const bucket of limiter.buckets.values()) {
      bucket.resetAt = Date.now() - 1;
    }
    limiter.sweep();

    assert.equal(limiter.buckets.size, 0);
  } finally {
    limiter.stop();
  }
});
