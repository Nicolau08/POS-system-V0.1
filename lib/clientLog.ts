/**
 * Logger do cliente (browser / Next).
 * Em produção: só warn/error na consola; erros importantes podem ir para a API.
 */
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';

type ClientLogLevel = 'debug' | 'info' | 'warn' | 'error';

type ClientLogMeta = {
  module?: string;
  action?: string;
  reason?: string;
  why?: string;
  persist?: boolean;
  [key: string]: unknown;
};

const isProd = process.env.NODE_ENV === 'production';

function shouldConsole(level: ClientLogLevel) {
  if (!isProd) return true;
  return level === 'warn' || level === 'error';
}

function emit(level: ClientLogLevel, event: string, message: string, meta: ClientLogMeta = {}) {
  const entry = {
    level,
    event,
    message,
    timestamp: new Date().toISOString(),
    where: {
      source: 'web',
      module: meta.module ?? 'client',
      action: meta.action ?? null,
    },
    why: meta.reason ?? meta.why ?? null,
    context: meta,
  };

  if (shouldConsole(level)) {
    const human = `[${entry.timestamp}] ${level.toUpperCase()} ${event} — ${message}`;
    const sink =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(human, entry);
  }

  if (level === 'error' && meta.persist !== false && typeof window !== 'undefined') {
    void fetch(`${getPosApiBase()}/system/client-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getPosUserAuthHeaders(),
      },
      body: JSON.stringify({
        event,
        message,
        module: meta.module,
        action: meta.action,
        reason: meta.reason ?? meta.why,
        context: meta,
      }),
    }).catch(() => {
      // nunca bloquear UI
    });
  }
}

export const clientLog = {
  debug: (event: string, message: string, meta?: ClientLogMeta) =>
    emit('debug', event, message, meta),
  info: (event: string, message: string, meta?: ClientLogMeta) =>
    emit('info', event, message, meta),
  warn: (event: string, message: string, meta?: ClientLogMeta) =>
    emit('warn', event, message, meta),
  error: (event: string, message: string, meta?: ClientLogMeta) =>
    emit('error', event, message, meta),
};
