'use client';

import { useEffect, useRef } from 'react';

type EnterConfirmHandler = {
  onConfirm: () => void;
  onCancel?: () => void;
};

const stack: EnterConfirmHandler[] = [];

function isTypingInMultiline(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT' && (target as HTMLInputElement).type === 'search') return false;
  return false;
}

/**
 * Enter confirma a acção principal do diálogo aberto (Sim / OK / Confirmar).
 * Escape cancela. Só o diálogo no topo da pilha responde.
 */
export function useEnterToConfirm(
  enabled: boolean,
  onConfirm: () => void,
  onCancel?: () => void,
) {
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  onConfirmRef.current = onConfirm;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!enabled) return;

    const handler: EnterConfirmHandler = {
      onConfirm: () => onConfirmRef.current(),
      onCancel: () => onCancelRef.current?.(),
    };
    stack.push(handler);

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== handler) return;
      if (event.repeat || event.isComposing) return;

      if (event.key === 'Escape') {
        if (!handler.onCancel) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        handler.onCancel();
        return;
      }

      if (event.key !== 'Enter') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingInMultiline(event.target)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      handler.onConfirm();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const index = stack.lastIndexOf(handler);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [enabled]);
}
