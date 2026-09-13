'use client';

import { X } from 'lucide-react';
import { LICENSE_IN_USE_POPUP_DETAIL } from '@/lib/licensing/licenseConflict.js';
import { useEnterToConfirm } from '@/hooks/useEnterToConfirm';

const POSLY_BLUE = '#0001fb';

type LicenseInUseModalProps = {
  open: boolean;
  onClose: () => void;
};

export function LicenseInUseModal({ open, onClose }: LicenseInUseModalProps) {
  useEnterToConfirm(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center pos-modal-overlay px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-in-use-title"
      onClick={onClose}
    >
      <div
        className="pos-modal w-full max-w-md p-5"
        style={{ borderColor: `${POSLY_BLUE}99` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="license-in-use-title"
            className="text-base font-semibold"
            style={{ color: '#9ea0ff' }}
          >
            Licença em uso
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-200">{LICENSE_IN_USE_POPUP_DETAIL}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: POSLY_BLUE }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
