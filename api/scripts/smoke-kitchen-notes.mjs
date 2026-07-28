/**
 * Smoke test manual: node api/scripts/smoke-kitchen-notes.mjs
 * Requer API a correr e AUTH (ou AUTH_ALLOW_PLAIN_BEARER em dev).
 *
 * Uso:
 *   POS_API=http://127.0.0.1:3001 USER_ID=admin-local node api/scripts/smoke-kitchen-notes.mjs
 */
const base = String(process.env.POS_API ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const userId = String(process.env.USER_ID ?? 'admin-local').trim();

async function main() {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${userId}`,
    'x-user-id': userId,
    'X-Station-Code': 'smoke-kds',
    'X-Station-Role': 'caixa',
  };

  const createRes = await fetch(`${base}/kitchen/tickets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tableKey: '99',
      tableLabel: '99',
      printAlso: false,
      source: 'smoke',
      items: [
        {
          name: 'Smoke Burger',
          quantity: 1,
          category: 'Geral',
          notes: 'sem cebola — smoke test',
        },
      ],
    }),
  });
  const createJson = await createRes.json().catch(() => null);
  console.log('POST /kitchen/tickets', createRes.status, JSON.stringify(createJson, null, 2));
  if (!createRes.ok) process.exit(1);

  const tickets = createJson?.data?.tickets ?? createJson?.tickets ?? [];
  const id = tickets[0]?.id;
  if (!id) {
    console.error('Sem ticket id');
    process.exit(1);
  }

  const patchRes = await fetch(`${base}/kitchen/tickets/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'bump' }),
  });
  const patchJson = await patchRes.json().catch(() => null);
  console.log('PATCH bump', patchRes.status, JSON.stringify(patchJson, null, 2));
  if (!patchRes.ok) process.exit(1);

  console.log('OK — notes + bump');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
