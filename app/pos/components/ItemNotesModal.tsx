'use client';

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const MAX_NOTES = 500;

export function ItemNotesModal({
  isOpen,
  itemName,
  notes,
  setNotes,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  itemName: string;
  notes: string;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[#1a1a1a] border border-zinc-800 rounded p-6 w-full max-w-[400px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-1 text-center">{itemName}</h3>
            <p className="text-xs text-zinc-500 mb-4 text-center">
              Nota para a cozinha (ex.: sem cebola)
            </p>

            <textarea
              ref={inputRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))}
              rows={4}
              maxLength={MAX_NOTES}
              placeholder="Escreva a nota…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#0001fb] transition-colors resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onConfirm();
              }}
            />
            <p className="mt-1 text-[10px] text-zinc-600 text-right">
              {notes.length}/{MAX_NOTES}
            </p>

            <div className="flex gap-2 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-11 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-colors text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="flex-1 h-11 bg-[#0001fb] hover:bg-[#1a1bff] text-white rounded font-bold transition-colors text-sm"
              >
                Guardar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
