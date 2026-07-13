import {
  countAppLogs,
  countSyncLogs,
  listAppLogs,
  listAuditLogs,
  listSyncLogs,
} from '../repositories/app-logs.repository.js';

function parsePayload(raw) {
  if (raw == null || raw === '') return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { raw: String(raw) };
  }
}

function inferSyncLevel(type, message) {
  const t = String(type ?? '').toLowerCase();
  const m = String(message ?? '').toLowerCase();
  if (
    t.includes('error') ||
    t.includes('fail') ||
    t.includes('blocked') ||
    m.includes('error') ||
    m.includes('fail') ||
    m.includes('crashed')
  ) {
    return 'error';
  }
  if (t.includes('warn') || t.includes('skip') || t.includes('offline') || m.includes('skip') || m.includes('offline')) {
    return 'warn';
  }
  return 'info';
}

function humanSyncMessage(type, message) {
  const msg = String(message ?? '').trim();
  if (msg) return msg;
  const t = String(type ?? 'sync');
  return `Evento de sincronismo: ${t}`;
}

export async function getSystemLogs(query = {}) {
  const limit = query.limit;
  const offset = query.offset;
  const level = query.level ? String(query.level).trim().toLowerCase() : null;
  const event = query.event ? String(query.event).trim() : null;
  const q = query.q ? String(query.q).trim() : null;
  const from = query.from ? String(query.from).trim() : null;
  const to = query.to ? String(query.to).trim() : null;
  const userId = query.userId ? String(query.userId).trim() : null;
  const tenantId = query.tenantId ? String(query.tenantId).trim() : null;
  const sourceRaw = String(query.source ?? 'app').trim().toLowerCase();
  const source = sourceRaw === 'audit' || sourceRaw === 'sync' ? sourceRaw : 'app';

  if (source === 'audit') {
    const rows = await listAuditLogs({ limit, offset, action: event, q });
    return {
      source: 'audit',
      items: rows.map((row) => ({
        id: row.id,
        level: 'info',
        event: row.action,
        message: (() => {
          const details = parsePayload(row.details);
          return details?.description || row.action;
        })(),
        when: row.created_at,
        where: { source: 'audit', module: row.entity || 'audit', action: row.action },
        why: 'Registo de auditoria de negócio',
        who: { id: row.user_id, name: null, role: null },
        context: {
          entity: row.entity,
          entity_id: row.entity_id,
          details: parsePayload(row.details),
        },
        error: null,
      })),
      total: rows.length,
    };
  }

  if (source === 'sync') {
    const [rows, countRow] = await Promise.all([
      listSyncLogs({ limit, offset, q, type: event, tenantId }),
      countSyncLogs({ q, type: event, tenantId }),
    ]);
    return {
      source: 'sync',
      items: rows.map((row) => {
        const payload = parsePayload(row.payload);
        const levelInferred = inferSyncLevel(row.type, row.error_message);
        return {
          id: String(row.id),
          level: levelInferred,
          event: `sync.${row.type || 'event'}`,
          message: humanSyncMessage(row.type, row.error_message),
          when: row.created_at,
          where: {
            source: 'sync',
            module: 'syncService',
            action: row.type || null,
          },
          why:
            levelInferred === 'error'
              ? 'Falha durante sincronização com a cloud'
              : levelInferred === 'warn'
                ? 'Sincronização com aviso ou item ignorado'
                : 'Operação de sincronização registada',
          who: null,
          context: {
            tenant_id: row.tenant_id,
            queue_id: row.queue_id,
            type: row.type,
            payload,
          },
          error: levelInferred === 'error' ? { message: row.error_message } : null,
        };
      }),
      total: Number(countRow?.total ?? rows.length),
    };
  }

  const [rows, countRow] = await Promise.all([
    listAppLogs({ limit, offset, level, event, q, from, to, userId }),
    countAppLogs({ level, event, q, from, to, userId }),
  ]);

  return {
    source: 'app',
    items: rows.map((row) => {
      const payload = parsePayload(row.payload_json) || {};
      return {
        id: row.id,
        level: row.level,
        event: row.event,
        message: row.message,
        when: row.created_at,
        where: {
          source: row.source,
          module: row.module,
          action: row.action,
          ...(payload.where || {}),
        },
        why: row.reason || payload.why || null,
        who: {
          id: row.user_id,
          name: row.user_name,
          role: payload.who?.role ?? null,
        },
        context: {
          tenant_id: row.tenant_id,
          request_id: row.request_id,
          entity: row.entity,
          entity_id: row.entity_id,
          ...(payload.context || {}),
        },
        error: payload.error || null,
      };
    }),
    total: Number(countRow?.total ?? rows.length),
  };
}
