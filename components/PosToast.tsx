'use client';

import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, Info } from 'lucide-react';

export type PosToastType = 'success' | 'error' | 'info';

export type PosToastState = {
  message: string;
  type: PosToastType;
  id?: string | number;
};

type PosToastProps = {
  toast: PosToastState | null;
  /** Centro no rodapé (POS) ou canto direito (gestão). */
  placement?: 'center' | 'right';
};

const typeStyles: Record<PosToastType, string> = {
  success: 'bg-[#0001fb]/20 text-[#a5b4fc]',
  error: 'bg-red-500/20 text-red-400',
  info: 'bg-blue-500/20 text-blue-400',
};

function ToastIcon({ type }: { type: PosToastType }) {
  if (type === 'success') return <Check size={18} />;
  if (type === 'error') return <AlertTriangle size={18} />;
  return <Info size={18} />;
}

/**
 * Notificação de rodapé: sobe de baixo e sai a perder opacidade.
 */
export default function PosToast({ toast, placement = 'center' }: PosToastProps) {
  const positionClass =
    placement === 'right'
      ? 'fixed bottom-6 right-6 z-[200]'
      : 'fixed bottom-8 left-1/2 z-[100] -translate-x-1/2';

  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          key={toast.id ?? `${toast.type}:${toast.message}`}
          role="status"
          initial={{ opacity: 0, y: 36 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{
            duration: 0.32,
            ease: [0.22, 1, 0.36, 1],
            opacity: { duration: 0.28 },
          }}
          className={`${positionClass} pos-toast`}
        >
          <div className={`p-2 rounded ${typeStyles[toast.type] ?? typeStyles.info}`}>
            <ToastIcon type={toast.type} />
          </div>
          <span className="text-sm font-medium text-pos-fg max-w-[min(70vw,420px)]">{toast.message}</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
