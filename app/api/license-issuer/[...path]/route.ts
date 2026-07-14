import { NextResponse } from 'next/server';
import * as clients from '../_handlers/clients';
import * as deviceActivation from '../_handlers/device-activation';
import * as deviceStatus from '../_handlers/device-status';
import * as issue from '../_handlers/issue';
import * as reactivate from '../_handlers/reactivate';
import * as registry from '../_handlers/registry';
import * as serialActivate from '../_handlers/serial-activate';
import * as serialLookup from '../_handlers/serial-lookup';
import * as store from '../_handlers/store';
import * as voucher from '../_handlers/voucher';
import * as voucherConfirm from '../_handlers/voucher-confirm';
import * as voucherReactivationToken from '../_handlers/voucher-reactivation-token';

/**
 * Consolida todas as rotas /api/license-issuer/* numa única Serverless Function
 * (limite Hobby da Vercel: 12 funções por deploy).
 *
 * URLs públicas permanecem iguais (ex.: /api/license-issuer/serial/lookup).
 */

type RouteHandler = (request: Request) => Promise<Response> | Response;

type MethodMap = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', RouteHandler>>;

const ROUTES: Record<string, MethodMap> = {
  store: { GET: store.GET },
  clients: {
    POST: clients.POST,
    PATCH: clients.PATCH,
    DELETE: clients.DELETE,
  },
  issue: { POST: issue.POST },
  registry: { PATCH: registry.PATCH },
  reactivate: { POST: reactivate.POST },
  'device-activation': { POST: deviceActivation.POST },
  'device-status': { POST: deviceStatus.POST },
  'serial/lookup': { POST: serialLookup.POST },
  'serial/activate': { POST: serialActivate.POST },
  voucher: {
    POST: voucher.POST,
    PATCH: voucher.PATCH,
  },
  'voucher/confirm': { POST: voucherConfirm.POST },
  'voucher/reactivation-token': { POST: voucherReactivationToken.POST },
};

async function dispatch(
  method: keyof MethodMap,
  request: Request,
  pathSegments: string[] | undefined,
) {
  const key = (pathSegments ?? []).map((s) => String(s).trim()).filter(Boolean).join('/');
  if (!key) {
    return NextResponse.json({ error: 'Rota license-issuer em falta.' }, { status: 404 });
  }

  const handlers = ROUTES[key];
  if (!handlers) {
    return NextResponse.json({ error: `Rota desconhecida: ${key}` }, { status: 404 });
  }

  const handler = handlers[method];
  if (!handler) {
    return NextResponse.json(
      { error: `Método ${method} não suportado em /api/license-issuer/${key}` },
      { status: 405 },
    );
  }

  return handler(request);
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return dispatch('GET', request, path);
}

export async function POST(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return dispatch('POST', request, path);
}

export async function PUT(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return dispatch('PUT', request, path);
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return dispatch('PATCH', request, path);
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return dispatch('DELETE', request, path);
}
