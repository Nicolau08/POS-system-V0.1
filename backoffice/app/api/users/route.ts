/**
 * Etapa 1G.4 Fase 9 — gestão de utilizadores do Backoffice. Listar reutiliza a policy
 * "owner vê todo o tenant" (aditiva à Fase 2). Criar é sempre: 1) Auth user (Admin API,
 * fora do SQL) 2) RPC backoffice_create_user (chamada com a sessão do PRÓPRIO owner —
 * nunca service_role — a autorização/âmbito de tenant vivem na RPC via auth.uid()).
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSessionClient, serviceRoleClient } from '@/lib/serverSession';
import { deterministicInternalEmail } from '@/lib/internalAuthEmail';

function isDuplicateEmailError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === 'email_exists') return true;
  return /already\s+(been\s+)?registered|already exists/i.test(err.message ?? '');
}

export async function GET() {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  if (session.user.role !== 'owner') return NextResponse.json({ error: 'Só o owner gere utilizadores.' }, { status: 403 });

  const { data: users, error: usersErr } = await session.client
    .from('backoffice_users')
    .select('user_id,username,role,status,recovery_email,recovery_email_verified,must_change_password,created_at')
    .order('created_at');
  if (usersErr) return NextResponse.json({ error: 'Falha ao listar utilizadores.' }, { status: 500 });

  const { data: assignments, error: assignErr } = await session.client.from('backoffice_user_stores').select('user_id,store_id');
  if (assignErr) return NextResponse.json({ error: 'Falha ao listar atribuições de Store.' }, { status: 500 });

  const storeIds = [...new Set((assignments ?? []).map((a) => a.store_id))];
  let storeNames = new Map<string, string>();
  if (storeIds.length > 0) {
    const { data: stores } = await serviceRoleClient().from('stores').select('id,name').in('id', storeIds).eq('tenant_id', session.user.tenantId);
    storeNames = new Map((stores ?? []).map((s) => [s.id, s.name as string]));
  }
  const storesByUser = new Map<string, Array<{ id: string; name: string }>>();
  for (const a of assignments ?? []) {
    const list = storesByUser.get(a.user_id) ?? [];
    list.push({ id: a.store_id, name: storeNames.get(a.store_id) ?? a.store_id });
    storesByUser.set(a.user_id, list);
  }

  return NextResponse.json({
    users: (users ?? []).map((u) => ({ ...u, stores: u.role === 'store_operator' ? storesByUser.get(u.user_id) ?? [] : [] })),
  });
}

export async function POST(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  if (session.user.role !== 'owner') return NextResponse.json({ error: 'Só o owner cria utilizadores.' }, { status: 403 });

  let body: { username?: string; role?: string; storeIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const username = String(body.username ?? '').trim();
  const role = String(body.role ?? '').trim();
  const storeIds = Array.isArray(body.storeIds) ? body.storeIds.filter((s) => typeof s === 'string' && s) : [];
  if (!username) return NextResponse.json({ error: 'Username é obrigatório.' }, { status: 400 });
  if (role !== 'owner' && role !== 'store_operator') return NextResponse.json({ error: 'Role inválida.' }, { status: 400 });
  if (role === 'store_operator' && storeIds.length === 0) {
    return NextResponse.json({ error: 'store_operator precisa de pelo menos uma Store atribuída.' }, { status: 400 });
  }

  const { data: existing } = await session.client.from('backoffice_users').select('user_id').ilike('username', username).maybeSingle();
  if (existing) return NextResponse.json({ error: 'Já existe um utilizador com esse username neste Tenant.' }, { status: 409 });

  const svc = serviceRoleClient();
  const internalEmail = deterministicInternalEmail(session.user.tenantId, username);
  const tempPassword = crypto.randomBytes(12).toString('base64url');

  let authUserId: string | null = null;
  const created = await svc.auth.admin.createUser({ email: internalEmail, password: tempPassword, email_confirm: true });
  if (created.error || !created.data?.user) {
    if (!isDuplicateEmailError(created.error)) {
      return NextResponse.json({ error: `Falha ao criar utilizador Auth: ${created.error?.message ?? 'erro desconhecido'}` }, { status: 500 });
    }
    // Órfão de uma tentativa anterior (ou corrida concorrente) para o MESMO username —
    // recupera o id existente em vez de criar um duplicado.
    const { data: existingId, error: lookupErr } = await svc.rpc('backoffice_lookup_internal_auth_user', { p_email: internalEmail });
    if (lookupErr || !existingId) return NextResponse.json({ error: 'Falha ao recuperar utilizador existente.' }, { status: 500 });
    authUserId = existingId as string;
  } else {
    authUserId = created.data.user.id;
  }

  const { error: rpcErr } = await session.client.rpc('backoffice_create_user', {
    p_auth_user_id: authUserId,
    p_auth_internal_email: internalEmail,
    p_username: username,
    p_role: role,
    p_store_ids: role === 'store_operator' ? storeIds : [],
  });
  if (rpcErr) {
    const msg = String(rpcErr.message ?? '');
    if (/username_already_exists/.test(msg)) return NextResponse.json({ error: 'Já existe um utilizador com esse username neste Tenant.' }, { status: 409 });
    if (/store_not_in_tenant/.test(msg)) return NextResponse.json({ error: 'Uma das Stores não pertence a este Tenant.' }, { status: 400 });
    return NextResponse.json({ error: `Falha ao criar a membership: ${msg}` }, { status: 500 });
  }

  const url = String(process.env.BACKOFFICE_PUBLIC_URL || 'http://localhost:3003').trim();
  const { data: tenant } = await svc.from('tenants').select('nuit').eq('id', session.user.tenantId).maybeSingle();
  const txt = [`NUIT: ${tenant?.nuit ?? ''}`, `Username: ${username}`, `Password temporária: ${tempPassword}`, `URL: ${url}/login`, ''].join('\n');

  return NextResponse.json({ username, role, tempPassword, url: `${url}/login`, txt }, { status: 201 });
}
