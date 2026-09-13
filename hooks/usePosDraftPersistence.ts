'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearPosDraftEverywhere,
  fetchPosDraftFromServer,
  isMeaningfulPosDraft,
  makeEmptyPosDraft,
  readPosDraft,
  savePosDraftToServer,
  writePosDraft,
  type PosDraftSnapshot,
} from '@/lib/posDraftStorage';

const SAVE_DEBOUNCE_MS = 400;

type UsePosDraftPersistenceArgs = {
  enabled: boolean;
  userId: string | null | undefined;
  /** Quando true (ex.: venda já finalizada), limpa o draft e não volta a gravar. */
  paused?: boolean;
  buildSnapshot: () => PosDraftSnapshot;
  applyDraft: (draft: PosDraftSnapshot) => void;
};

/**
 * Restaura o carrinho aberto (SQLite → fallback localStorage) e
 * grava alterações no localStorage (imediato) + SQLite (debounce).
 */
export function usePosDraftPersistence({
  enabled,
  userId,
  paused = false,
  buildSnapshot,
  applyDraft,
}: UsePosDraftPersistenceArgs) {
  const [hydrateToken, setHydrateToken] = useState(0);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const activeUserRef = useRef<string | null>(null);
  const hydrateDoneRef = useRef(false);
  const pausedRef = useRef(paused);
  /** Após clear: bloqueia flush/persist até o próximo render com estado fresco. */
  const blockPersistRef = useRef(false);
  const persistGenerationRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildSnapshotRef = useRef(buildSnapshot);
  const applyDraftRef = useRef(applyDraft);

  useEffect(() => {
    buildSnapshotRef.current = buildSnapshot;
  }, [buildSnapshot]);

  useEffect(() => {
    applyDraftRef.current = applyDraft;
  }, [applyDraft]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const persistSnapshot = useCallback(async (uid: string, snapshot: PosDraftSnapshot) => {
    const gen = persistGenerationRef.current;
    if (pausedRef.current || blockPersistRef.current) return;

    if (!isMeaningfulPosDraft(snapshot)) {
      await clearPosDraftEverywhere(uid);
      return;
    }

    writePosDraft(uid, snapshot);
    await savePosDraftToServer(uid, snapshot);

    // Clear a meio invalidou este save — apagar de novo.
    if (gen !== persistGenerationRef.current || pausedRef.current || blockPersistRef.current) {
      await clearPosDraftEverywhere(uid);
    }
  }, []);

  const flushDraftNow = useCallback(async () => {
    const uid = String(userId ?? '').trim();
    if (!uid || !enabled || !hydrateDoneRef.current) return;
    if (pausedRef.current || blockPersistRef.current) return;
    const snapshot = buildSnapshotRef.current();
    cancelPendingSave();
    await persistSnapshot(uid, snapshot);
  }, [cancelPendingSave, enabled, persistSnapshot, userId]);

  const clearDraftEverywhere = useCallback(async () => {
    const uid = String(userId ?? '').trim();
    persistGenerationRef.current += 1;
    blockPersistRef.current = true;
    cancelPendingSave();
    // Evita flush/pagehide a gravar o carrinho antigo a partir do ref stale.
    buildSnapshotRef.current = () => makeEmptyPosDraft();
    await clearPosDraftEverywhere(uid || userId);
  }, [cancelPendingSave, userId]);

  // Após finalizar venda: apagar draft e bloquear novas gravações enquanto o recibo está aberto.
  useEffect(() => {
    if (!enabled || !paused) return;
    void clearDraftEverywhere();
  }, [clearDraftEverywhere, enabled, paused]);

  // Restore once per user before any persist writes
  useEffect(() => {
    if (!enabled) {
      activeUserRef.current = null;
      hydrateDoneRef.current = false;
      blockPersistRef.current = false;
      setDraftHydrated(false);
      return;
    }
    const uid = String(userId ?? '').trim();
    if (!uid) return;
    if (activeUserRef.current === uid && hydrateDoneRef.current) return;

    let cancelled = false;
    activeUserRef.current = uid;
    hydrateDoneRef.current = false;
    setDraftHydrated(false);
    blockPersistRef.current = true; // não gravar durante o restore

    void (async () => {
      // Pintar já a partir do localStorage (docType FP, carrinho, etc.) — sem esperar a API.
      const local = readPosDraft(uid);
      if (!cancelled && isMeaningfulPosDraft(local)) {
        applyDraftRef.current(local!);
      }

      const server = await fetchPosDraftFromServer(uid);
      let draft: PosDraftSnapshot | null = null;

      if (server.ok) {
        // Servidor respondeu: é a fonte de verdade (não repor local stale).
        draft = isMeaningfulPosDraft(server.draft) ? server.draft : null;
        if (draft) writePosDraft(uid, draft);
        else await clearPosDraftEverywhere(uid);
      } else {
        // API indisponível: manter local já aplicado.
        draft = isMeaningfulPosDraft(local) ? local : null;
      }

      if (!cancelled && isMeaningfulPosDraft(draft)) {
        applyDraftRef.current(draft!);
      }
      if (!cancelled) {
        hydrateDoneRef.current = true;
        blockPersistRef.current = false;
        setDraftHydrated(true);
        setHydrateToken((value) => value + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  // Persist on every snapshot change after hydrate
  useEffect(() => {
    if (!enabled || paused) return;
    const uid = String(userId ?? '').trim();
    if (!uid) return;
    if (activeUserRef.current !== uid || !hydrateDoneRef.current) return;

    // Estado React fresco depois de clear/cancel — libertar o bloqueio.
    blockPersistRef.current = false;
    buildSnapshotRef.current = buildSnapshot;

    const snapshot = buildSnapshot();
    const gen = persistGenerationRef.current;

    if (!isMeaningfulPosDraft(snapshot)) {
      cancelPendingSave();
      void clearPosDraftEverywhere(uid);
      return;
    }

    writePosDraft(uid, snapshot);
    cancelPendingSave();
    saveTimerRef.current = setTimeout(() => {
      if (gen !== persistGenerationRef.current || pausedRef.current || blockPersistRef.current) return;
      void persistSnapshot(uid, snapshot);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      cancelPendingSave();
    };
  }, [cancelPendingSave, enabled, userId, buildSnapshot, hydrateToken, persistSnapshot, paused]);

  // Flush on page hide
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      void flushDraftNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, flushDraftNow]);

  return { flushDraftNow, clearDraftEverywhere, draftHydrated };
}
