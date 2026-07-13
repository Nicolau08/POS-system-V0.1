/**
 * Logger do processo Electron (ficheiros em userData/logs + consola).
 * Não depende da BD SQLite da API.
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveLevel() {
  const raw = String(process.env.POS_LOG_LEVEL ?? '').trim().toLowerCase();
  if (raw && LEVEL_RANK[raw] != null) return raw;
  return app.isPackaged ? 'info' : 'debug';
}

const CONSOLE_LEVEL = resolveLevel();

function ensureLogDir() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

function logFilePath() {
  const dir = ensureLogDir();
  if (!dir) return null;
  const day = new Date().toISOString().slice(0, 10);
  return path.join(dir, `posly-electron-${day}.log`);
}

function appendFile(line) {
  const file = logFilePath();
  if (!file) return;
  try {
    fs.appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function emit(level, event, message, meta = {}) {
  if ((LEVEL_RANK[level] ?? 99) < (LEVEL_RANK[CONSOLE_LEVEL] ?? 20)) return;

  const entry = {
    level,
    event,
    message,
    timestamp: new Date().toISOString(),
    where: {
      source: 'electron',
      module: meta.module ?? 'main',
      action: meta.action ?? null,
    },
    why: meta.reason ?? meta.why ?? null,
    context: { ...meta, module: undefined, action: undefined, reason: undefined, why: undefined },
  };

  const human = `[${entry.timestamp}] ${level.toUpperCase()} ${event} — ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(human);
  try {
    appendFile(human);
    appendFile(JSON.stringify(entry));
  } catch {
    // ignore
  }
}

export function electronLogInfo(event, message, meta = {}) {
  emit('info', event, message, meta);
}

export function electronLogWarn(event, message, meta = {}) {
  emit('warn', event, message, meta);
}

export function electronLogError(event, message, meta = {}) {
  emit('error', event, message, meta);
}

export function getElectronLogsDirectory() {
  return ensureLogDir();
}
