/**
 * Mapeamento explícito SQLite 0/1 <-> PostgreSQL BOOLEAN (Etapa 1F.2, item 17).
 * Nunca depender de coerção implícita do driver/PostgREST — um `1`/`0` cru
 * enviado como JSON para uma coluna `boolean` (ex.: products.deleted,
 * users.active) não é garantidamente aceite como true/false.
 */

/** SQLite (0/1, ou já booleano) -> valor a enviar para uma coluna Postgres BOOLEAN. */
export function toPgBoolean(sqliteValue) {
  return sqliteValue === true || Number(sqliteValue) === 1;
}

/** Postgres BOOLEAN (ou já 0/1) -> valor a gravar numa coluna SQLite INTEGER 0/1. */
export function fromPgBoolean(pgValue) {
  return pgValue === true || Number(pgValue) === 1 ? 1 : 0;
}
