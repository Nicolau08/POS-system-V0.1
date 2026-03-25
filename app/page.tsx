'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  X,
  Sun,
  Moon,
  Calendar,
  Clock,
  Unlock,
  Search, 
  User, 
  ArrowRightLeft, 
  Percent, 
  Plus, 
  RotateCcw, 
  Archive, 
  Utensils, 
  CreditCard, 
  Banknote, 
  Smartphone, 
  Monitor, 
  Menu,
  Trash2,
  Printer,
  Lock,
  Home,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Keyboard,
  Barcode,
  Pencil,
  AlertTriangle,
  Settings,
  Wrench,
  History,
  Layers,
  Download,
  FileText,
  UserCircle,
  LogOut,
  MessageSquare,
  Maximize,
  Power,
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Activity,
  Sliders
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { isConfigured } from '@/lib/supabase';
import type { CartItem, Customer, PaymentEntry, PaymentMethod, Product, User as PosUser } from '@/app/pos/types';
import { Header } from '@/app/pos/components/Header';
import { ProductList } from '@/app/pos/components/ProductList';
import { Cart } from '@/app/pos/components/Cart';
import { PaymentModal } from '@/app/pos/components/PaymentModal';
import { CustomerModal } from '@/app/pos/components/CustomerModal';
import { ReceiptPreview } from '@/app/pos/components/ReceiptPreview';
import { AdminPanel } from '@/app/pos/components/AdminPanel';
import { useCart } from '@/hooks/useCart';
import { useProducts } from '@/hooks/useProducts';
import { useAuth } from '@/hooks/useAuth';
import {
  createOrder,
  deleteCustomer,
  fetchCustomers as posFetchCustomers,
  fetchProducts as posFetchProducts,
  fetchUsers as posFetchUsers,
  saveCustomer,
  syncNextVDNumber as posSyncNextVDNumber,
} from '@/lib/services/posService';

const normalizeUnknownError = (error: any) => {
  if (error instanceof Error) {
    return {
      message: error.message || 'Erro desconhecido',
      details: (error as any).details || 'Sem detalhes adicionais',
      hint: (error as any).hint || 'Sem sugestÃµes',
      code: (error as any).code || 'Sem cÃ³digo de erro',
      raw: error,
    };
  }

  if (typeof Event !== 'undefined' && error instanceof Event) {
    return {
      message: `Evento inesperado: ${error.type || 'desconhecido'}`,
      details: 'O navegador retornou um evento em vez de um erro estruturado.',
      hint: 'Verifique a ligaÃ§Ã£o com a internet ou tente novamente.',
      code: 'BROWSER_EVENT',
      raw: error,
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
      details: 'Sem detalhes adicionais',
      hint: 'Sem sugestÃµes',
      code: 'STRING_ERROR',
      raw: error,
    };
  }

  return {
    message: error?.message || error?.error_description || error?.error || 'Erro desconhecido',
    details: error?.details || 'Sem detalhes adicionais',
    hint: error?.hint || 'Sem sugestÃµes',
    code: error?.code || 'Sem cÃ³digo de erro',
    raw: error,
  };
};

// --- Error Handling ---
const handleSupabaseError = (error: any, operation: string) => {
  const normalized = normalizeUnknownError(error);
  console.error(`Supabase Error (${operation}): ${normalized.message}`, normalized.raw);
  return {
    message: normalized.message,
    details: normalized.details,
    hint: normalized.hint,
    code: normalized.code,
  };
  let message = 'Erro desconhecido';
  if (typeof error === 'string') message = error;
  else if (error?.message) message = error.message;
  else if (error?.error_description) message = error.error_description;
  else if (error?.error) message = error.error;
  
  console.error(`Supabase Error (${operation}): ${message}`, error);
  
  // If it's a network error or similar, it might not have the standard Supabase error fields
  const details = error?.details || 'Sem detalhes adicionais';
  const hint = error?.hint || 'Sem sugestões';
  const code = error?.code || 'Sem código de erro';

  return { message, details, hint, code };
};

const getDocumentYear = (date = new Date()) => date.getFullYear();

const formatDocumentNumber = (sequence: number, date = new Date()) =>
  `${getDocumentYear(date)}/${String(sequence).padStart(4, '0')}`;


function LoginScreen({ 
  users, 
  selectedUser, 
  onSelectUser, 
  password, 
  setPassword, 
  onLogin, 
  error 
}: { 
  users: PosUser[], 
  selectedUser: PosUser | null, 
  onSelectUser: (user: PosUser) => void, 
  password: string, 
  setPassword: React.Dispatch<React.SetStateAction<string>>, 
  onLogin: () => void, 
  error: boolean 
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleKeyClick = (key: string) => {
    if (key === 'enter') {
      onLogin();
    } else if (key === 'back') {
      setPassword(prev => prev.slice(0, -1));
    } else {
      setPassword(prev => prev + key);
    }
  };

  // Physical keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isModalOpen) return;
      
      if (e.key === 'Enter') {
        onLogin();
      } else if (e.key === 'Backspace') {
        setPassword(prev => prev.slice(0, -1));
      } else if (e.key.length === 1) {
        // Allow all single characters (letters, numbers, symbols)
        setPassword(prev => prev + e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onLogin, setPassword, isModalOpen]);

  const keypad = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['back', '0', 'enter']
  ];

  return (
    <div className="flex flex-col h-screen bg-[#121212] text-zinc-100 font-sans overflow-hidden select-none relative p-8">
      <div className="flex flex-col items-center justify-center h-full">
        {/* User Grid */}
        <div className="flex flex-wrap justify-center gap-6 z-10 max-w-7xl">
          {users.slice().sort((a, b) => a.name.localeCompare(b.name)).map((user, idx) => (
            <button
              key={user.id}
              onClick={() => {
                onSelectUser(user);
                setIsModalOpen(true);
              }}
              className={`
                w-48 h-32 flex flex-col items-center justify-center gap-2 transition-transform active:scale-95 rounded
                ${user.role === 'admin' ? 'bg-[#c0c0c0] text-zinc-900' : 'bg-emerald-600 text-white'}
              `}
            >
              <div className="flex flex-col items-center">
                <User size={24} className={user.role === 'admin' ? 'text-zinc-700' : 'text-white/80'} />
                <span className="text-lg font-medium mt-1">{user.name}</span>
              </div>
            </button>
          ))}
        </div>
        {users.length === 0 && (
          <div className="rounded border border-zinc-800 bg-zinc-900/70 px-6 py-4 text-center text-zinc-400">
            Nenhum utilizador encontrado no Supabase.
          </div>
        )}
      </div>

      {/* Password Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div 
            className="fixed inset-0 flex items-center justify-center z-50 bg-black/80 backdrop-blur-sm"
            onClick={() => {
              setIsModalOpen(false);
              setPassword('');
            }}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-zinc-900 w-[400px] rounded overflow-hidden border border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="bg-zinc-800 px-4 py-3 flex items-center justify-center border-b border-zinc-700">
                <span className="text-xl text-zinc-100 font-medium">Senha</span>
              </div>

              {/* Modal Content */}
              <div className="p-4 flex flex-col gap-4">
                <div className="flex gap-2">
                  <div className={`flex-grow h-16 bg-zinc-800 border rounded flex items-center px-4 transition-all duration-200 ${error ? 'border-red-500 animate-shake' : 'border-zinc-700'}`}>
                    <input 
                      type="password"
                      value={password ?? ''}
                      readOnly
                      className="w-full text-3xl tracking-widest focus:outline-none bg-transparent text-white text-center"
                    />
                  </div>
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-2">
                  {keypad.flat().map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeyClick(key)}
                      className={`
                        h-16 text-xl font-medium flex items-center justify-center transition-colors rounded
                        ${key === 'enter' ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'}
                        ${key === 'back' ? 'text-lg' : ''}
                      `}
                    >
                      {key === 'enter' ? 'Entrar' : key === 'back' ? 'Apagar' : key}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-shake {
          animation: shake 0.2s ease-in-out 0s 2;
        }
      `}</style>

      {/* Exit Button */}
      <div className="absolute bottom-8 right-8">
        <button 
          className="w-16 h-16 flex items-center justify-center bg-zinc-800/50 hover:bg-red-600/20 text-zinc-500 hover:text-red-500 rounded-full transition-all duration-300 group border border-zinc-700/50"
          title="Sair do Sistema"
        >
          <Power size={32} className="group-hover:scale-110 transition-transform" />
        </button>
      </div>
    </div>
  );
}

export default function POSPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCartItemId, setSelectedCartItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  
  // Quantity Modal State
  const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [tempQuantity, setTempQuantity] = useState('');

  // Payment Modal State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [receivedAmount, setReceivedAmount] = useState<string>('');
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [isMultiplePayment, setIsMultiplePayment] = useState(false);
  const [multiplePaymentMethod, setMultiplePaymentMethod] = useState<PaymentMethod>('cash');
  const [multiplePaymentAmount, setMultiplePaymentAmount] = useState('');

  // Discount Modal State
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState<'value' | 'percentage'>('percentage');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountTarget, setDiscountTarget] = useState<'selected' | 'all'>('all');
  const [globalDiscount, setGlobalDiscount] = useState<{type: 'value' | 'percentage', amount: number} | null>(null);

  // Customer Modal State
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isSaleFinalized, setIsSaleFinalized] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<PosUser[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '' });
  const [customerSearch, setCustomerSearch] = useState('');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isAdminSidebarOpen, setIsAdminSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('sidebar') === 'open';
  });

  // Login State (isolated hook to keep session handling centralized)
  const auth = useAuth(users);
  const {
    isLoggedIn,
    setIsLoggedIn,
    currentUser,
    setCurrentUser,
    isAuthRestored,
    selectedLoginUser,
    setSelectedLoginUser,
    loginPassword,
    setLoginPassword,
    loginError,
    login,
    logout,
  } = auth;
  const [nextVDNumber, setNextVDNumber] = useState(1);
  const [currentReceiptNumber, setCurrentReceiptNumber] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [salesMode, setSalesMode] = useState<'customer' | 'table'>('customer');
  const [docType, setDocType] = useState<'VD' | 'TK' | 'FP'>('VD');
  const [tableOrders, setTableOrders] = useState<{[key: string]: { cart: CartItem[], globalDiscount: {type: 'value' | 'percentage', amount: number} | null, selectedCustomer: Customer | null, docType: 'VD' | 'TK' | 'FP' }}>({});
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isCashierModalOpen, setIsCashierModalOpen] = useState(false);
  const [isCashierOpen, setIsCashierOpen] = useState(false);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [cashierPrinter, setCashierPrinter] = useState('Impressora do evento');
  const [cashierStartDate, setCashierStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [cashierEndDate, setCashierEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  });
  const familiesScrollRef = useRef<HTMLDivElement | null>(null);
  const familiesMomentumFrameRef = useRef<number | null>(null);
  const familiesDragStateRef = useRef({
    isDragging: false,
    pointerId: null as number | null,
    startX: 0,
    lastX: 0,
    startScrollLeft: 0,
    lastMoveTime: 0,
    velocity: 0,
    moved: false,
  });

  // Stock Modal State
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!event.reason) return;

      const normalized = normalizeUnknownError(event.reason);
      const isBrowserEvent = normalized.code === 'BROWSER_EVENT';

      if (!isBrowserEvent) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      console.warn('Unhandled promise rejection interceptada:', normalized.message, normalized.raw);
    };

    const handleWindowError = (event: ErrorEvent) => {
      const normalized = normalizeUnknownError(event.error || event);
      const isBrowserEvent = normalized.code === 'BROWSER_EVENT' || !event.error;

      if (!isBrowserEvent) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      console.warn('Erro global do navegador interceptado:', normalized.message, normalized.raw);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection, { capture: true });
    window.addEventListener('error', handleWindowError, { capture: true });

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, { capture: true });
      window.removeEventListener('error', handleWindowError, { capture: true });
    };
  }, []);

  useEffect(() => {
    const node = familiesScrollRef.current;
    if (!node) return;

    const stopMomentum = () => {
      if (familiesMomentumFrameRef.current !== null) {
        window.cancelAnimationFrame(familiesMomentumFrameRef.current);
        familiesMomentumFrameRef.current = null;
      }
    };

    const handleWheel = (event: WheelEvent) => {
      stopMomentum();
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        node.scrollLeft += event.deltaY;
      } else if (event.deltaX !== 0) {
        event.preventDefault();
        node.scrollLeft += event.deltaX;
      }
    };

    node.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      stopMomentum();
      node.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const stopFamiliesMomentum = useCallback(() => {
    if (familiesMomentumFrameRef.current !== null) {
      window.cancelAnimationFrame(familiesMomentumFrameRef.current);
      familiesMomentumFrameRef.current = null;
    }
  }, []);

  const startFamiliesMomentum = useCallback((initialVelocity: number) => {
    const node = familiesScrollRef.current;
    if (!node) return;

    stopFamiliesMomentum();

    let velocity = initialVelocity;

    const step = () => {
      if (Math.abs(velocity) < 0.2) {
        familiesMomentumFrameRef.current = null;
        return;
      }

      node.scrollLeft -= velocity;
      velocity *= 0.94;
      familiesMomentumFrameRef.current = window.requestAnimationFrame(step);
    };

    familiesMomentumFrameRef.current = window.requestAnimationFrame(step);
  }, [stopFamiliesMomentum]);

  const handleFamiliesPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const node = familiesScrollRef.current;
    if (!node) return;

    stopFamiliesMomentum();
    familiesDragStateRef.current = {
      isDragging: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      startScrollLeft: node.scrollLeft,
      lastMoveTime: performance.now(),
      velocity: 0,
      moved: false,
    };
  }, [stopFamiliesMomentum]);

  const handleFamiliesPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const node = familiesScrollRef.current;
    const state = familiesDragStateRef.current;
    if (!node || !state.isDragging || state.pointerId !== event.pointerId) return;

    const delta = event.clientX - state.startX;
    const movement = event.clientX - state.lastX;
    const now = performance.now();
    const elapsed = Math.max(now - state.lastMoveTime, 1);

    if (Math.abs(delta) > 4) {
      if (!state.moved) {
        node.setPointerCapture(event.pointerId);
      }
      state.moved = true;
    }

    state.velocity = movement / elapsed * 16;
    state.lastX = event.clientX;
    state.lastMoveTime = now;
    node.scrollLeft = state.startScrollLeft - delta;
  }, []);

  const handleFamiliesPointerRelease = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const node = familiesScrollRef.current;
    const state = familiesDragStateRef.current;
    if (!node || state.pointerId !== event.pointerId) return;

    if (node.hasPointerCapture(event.pointerId)) {
      node.releasePointerCapture(event.pointerId);
    }

    familiesDragStateRef.current = {
      ...state,
      isDragging: false,
      pointerId: null,
    };

    if (state.moved) {
      startFamiliesMomentum(state.velocity);
    }
  }, [startFamiliesMomentum]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000); // Increased to 6 seconds
  };

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' MT';
  };
  const formatReceiptAmount = (value: number) => {
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}MT`;
  };
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // --- Calculations ---
  const { originalTotal, originalSubtotal, totalDiscount, total, subtotal, tax } = useCart(cart, globalDiscount);

  const buildPrintReceiptMarkup = () => {
    const now = new Date();
    const orderCode = currentReceiptNumber || formatDocumentNumber(nextVDNumber, now);
    const customerLabel = selectedCustomer ? selectedCustomer.name : 'Consumidor Final';
    const documentLabel = isSaleFinalized ? docType : 'Cons. Doc';
    const totalPaid = !isSaleFinalized
      ? 0
      : !isMultiplePayment
        ? (paymentMethod === 'cash' ? parseFloat(receivedAmount || `${total}`) : total)
        : payments.reduce((acc, p) => acc + p.amount, 0);
    const paymentRows = !isSaleFinalized
      ? ''
      : !isMultiplePayment
        ? `
          <div class="print-row payment-row">
            <span>${escapeHtml(paymentMethod === 'cash' ? 'Dinheiro' : paymentMethod === 'card' ? 'Cartao' : 'M-Pesa')}</span>
            <span>${formatReceiptAmount(total)}</span>
          </div>
        `
        : payments.map((p) => `
          <div class="print-row payment-row">
            <span>${escapeHtml(p.method === 'cash' ? 'Dinheiro' : p.method === 'card' ? 'Cartao' : 'M-Pesa')}</span>
            <span>${formatReceiptAmount(p.amount)}</span>
          </div>
        `).join('');

    const hasChange = ((!isMultiplePayment && paymentMethod === 'cash' && receivedAmount !== '') ||
      (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) > total));

    const shouldShowPaidRow = !isSaleFinalized
      ? false
      : !isMultiplePayment
        ? paymentMethod === 'cash' && receivedAmount !== '' && parseFloat(receivedAmount || '0') > total
        : payments.reduce((acc, p) => acc + p.amount, 0) > total;

    const changeAmount = !isMultiplePayment
      ? (parseFloat(receivedAmount || '0') - total)
      : (payments.reduce((acc, p) => acc + p.amount, 0) - total);

    const itemRows = cart.map((item) => `
      <div class="print-item-row">
        <span class="qty">${item.quantity.toFixed(2)}</span>
        <span class="desc">${escapeHtml(item.name)}</span>
        <span class="unit">${formatReceiptAmount(item.price)}</span>
        <span class="line-total">${formatReceiptAmount(item.price * item.quantity)}</span>
      </div>
    `).join('');

    return `
      <div class="print-receipt ${isSaleFinalized ? 'payment-receipt' : 'consult-receipt'}">
        <div class="print-header">
          <div class="logo">Your Logo</div>
          <div>Av. da Marginal - Maputo</div>
          <div>Tel: +258 87 2002 144</div>
          <div>NUIT: 401 000 000</div>
          <div class="customer">Cliente: ${escapeHtml(customerLabel)}</div>
        </div>

        <div class="print-block">
          <div class="print-meta">
            <span>Data: ${escapeHtml(now.toLocaleDateString())} ${escapeHtml(now.toLocaleTimeString())}</span>
            <span>Atendido por: ${escapeHtml(currentUser?.name || 'Admin')}</span>
          </div>
          <div class="print-doc">${documentLabel} No.: ${escapeHtml(orderCode)}</div>
        </div>

        <div class="print-block">
          <div class="print-columns">
            <span class="qty">Qt</span>
            <span class="desc">Descricao</span>
            <span class="unit">P.Unit</span>
            <span class="line-total">Valor</span>
          </div>
          <div class="print-divider"></div>
          <div class="print-items">${itemRows}</div>
          <div class="print-divider"></div>
        </div>

        <div class="print-totals">
          <div class="print-row">
            <span>Subtotal:</span>
            <span>${formatReceiptAmount(subtotal)}</span>
          </div>
          <div class="print-row">
            <span>IVA (16%):</span>
            <span>${formatReceiptAmount(tax)}</span>
          </div>
          <div class="print-divider"></div>
          <div class="print-row total-row">
            <span>Total:</span>
            <span>${formatReceiptAmount(total)}</span>
          </div>
        </div>

        ${isSaleFinalized ? `
          <div class="print-block">
            <div class="print-row print-pay-header">
              <span>Metodo de Pagamento</span>
              <span>Valor</span>
            </div>
            <div class="print-divider"></div>
            ${paymentRows}
            ${shouldShowPaidRow ? `
              <div class="print-divider payment-divider"></div>
              <div class="print-row payment-row">
                <span>Pagou</span>
                <span>${formatReceiptAmount(totalPaid)}</span>
              </div>
            ` : ''}
            ${hasChange ? `
              <div class="print-row print-change">
                <span>Troco</span>
                <span>${formatReceiptAmount(changeAmount)}</span>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div class="print-footer">
          <div>IVA Incluso</div>
          <div>Processada por Computador</div>
          <div>Obrigado pela preferencia!</div>
          <div class="foot-note">Sistema desenvolvido por: Nicolau Nino</div>
        </div>
      </div>
    `;
  };

  const fetchUsers = useCallback(async () => {
    try {
      const data = await posFetchUsers();

      if (data && data.length > 0) {
        setUsers(data as PosUser[]);
        setSelectedLoginUser((previous) =>
          (data as PosUser[]).find((user) => user.id === previous?.id) ?? (data[0] as PosUser)
        );
      } else {
        setUsers([]);
        setSelectedLoginUser(null);
      }
    } catch (error) {
      handleSupabaseError(error, 'fetchUsers');
      setUsers([]);
      setSelectedLoginUser(null);
    }
  }, [setSelectedLoginUser]);

  // --- Effects ---
  useEffect(() => {
    if (!isAuthRestored) return;
    let cancelled = false;

    void (async () => {
      try {
        const nextSequence = await posSyncNextVDNumber(new Date());
        if (cancelled) return;
        setNextVDNumber(nextSequence);
      } catch (error) {
        if (cancelled) return;
        handleSupabaseError(error, 'syncNextVDNumber');
        setNextVDNumber(1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthRestored]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isConfigured) {
        console.warn('Supabase nÃ£o configurado. A aplicaÃ§Ã£o irÃ¡ operar sem dados carregados.');
        setProducts([]);
        setCustomers([]);
        setUsers([]);
        setSelectedLoginUser(null);
        return;
      }
      try {
        const [productsData, customersData] = await Promise.all([posFetchProducts(), posFetchCustomers()]);
        setProducts(productsData || []);
        setCustomers(customersData || []);
      } catch (error) {
        handleSupabaseError(error, 'fetchProducts/fetchCustomers');
        setProducts([]);
        setCustomers([]);
      }

      // Fetch Users
      await fetchUsers();
    };

    fetchData();

    // Check for query param to open sidebar
    const params = new URLSearchParams(window.location.search);
    if (params.get('sidebar') === 'open') {
      // Clean up the URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchUsers, setSelectedLoginUser]);

  // --- Handlers ---
  const addToCart = (product: Product) => {
    if (product.price === 0) {
      setSelectedCategory(product.name);
      return;
    }

    // Check for stock warnings (only for products, not services)
    if (!product.is_service) {
      // If stock is 0 or negative, show confirmation modal
      if (product.stock_quantity !== undefined && product.stock_quantity <= 0) {
        setPendingProduct(product);
        setIsStockModalOpen(true);
        return;
      }
      
      // If stock is positive but below min_stock (and min_stock is defined and > 0)
      if (
        product.stock_quantity !== undefined && 
        product.min_stock !== undefined && 
        product.min_stock > 0 && 
        product.stock_quantity <= product.min_stock
      ) {
        showToast(`Aviso: O estoque de "${product.name}" está no nível mínimo (${product.stock_quantity}). Reabastecimento necessário.`, 'info');
      }
    }

    executeAddToCart(product);
  };

  const executeAddToCart = (product: Product) => {
    // Optimistic reservation in UI-only state.
    // Actual stock is decremented in `createOrder` atomically on the server.
    if (!product.is_service) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id
            ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) - 1 }
            : p
        )
      );
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = async (id: string) => {
    const itemToRemove = cart.find(item => item.id === id);
    if (itemToRemove && !itemToRemove.is_service) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) + itemToRemove.quantity } : p
        )
      );
    }

    setCart(prev => prev.filter(item => item.id !== id));
    if (selectedCartItemId === id) {
      setSelectedCartItemId(null);
    }
  };

  const updateQuantity = async (id: string, quantity: number) => {
    const item = cart.find(i => i.id === id);
    if (!item) return;

    if (quantity <= 0) {
      removeFromCart(id);
      return;
    }

    const delta = quantity - item.quantity;
    if (!item.is_service && delta !== 0) {
      const currentProduct = products.find((p) => p.id === id);
      const currentStock = Number(currentProduct?.stock_quantity ?? 0);

      if (delta > 0) {
        if (currentStock < delta) {
          // Keep existing UX patterns: show the stock modal only when stock is <= 0.
          if (currentStock <= 0) {
            setPendingProduct(currentProduct ?? item);
            setIsStockModalOpen(true);
          } else {
            showToast('Quantidade solicitada excede o estoque disponível.', 'error');
          }
          return;
        }
        setProducts((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) - delta } : p
          )
        );
      } else {
        // Restoring stock for decreasing quantity.
        const restore = -delta;
        setProducts((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) + restore } : p
          )
        );
      }
    }

    setCart(prev => prev.map(item => item.id === id ? { ...item, quantity } : item));
  };

  const clearCart = async (isFinalized: boolean = false) => {
    // Return stock for all items if NOT finalized
    if (!isFinalized) {
      const restockByProductId = new Map<string, number>();
      for (const item of cart) {
        if (item.is_service) continue;
        restockByProductId.set(
          item.id,
          (restockByProductId.get(item.id) ?? 0) + item.quantity
        );
      }

      if (restockByProductId.size > 0) {
        setProducts((prev) =>
          prev.map((p) => {
            const delta = restockByProductId.get(p.id);
            if (delta == null) return p;
            return { ...p, stock_quantity: Number(p.stock_quantity ?? 0) + delta };
          })
        );
      }
    }

    setCart([]);
    setSelectedCartItemId(null);
    setGlobalDiscount(null);
    setPaymentMethod(null);
    setReceivedAmount('');
    setPayments([]);
    setIsMultiplePayment(false);
    setMultiplePaymentAmount('');
    setSelectedCustomer(null);
    setCurrentReceiptNumber(null);
    setDocType('VD');
    if (salesMode === 'table' && selectedTableId) {
      setTableOrders(prev => {
        const next = { ...prev };
        delete next[selectedTableId];
        return next;
      });
    } else if (salesMode === 'customer') {
      setTableOrders(prev => {
        const next = { ...prev };
        delete next['direct'];
        return next;
      });
    }
  };

  const handleTableSelect = (tableId: string | null) => {
    // 1. Save current state to current ID (already done in openTableModal, but let's be safe)
    const currentId = selectedTableId || 'direct';
    const currentOrder = { cart, globalDiscount, selectedCustomer, docType };
    
    setTableOrders(prev => ({
      ...prev,
      [currentId]: currentOrder
    }));

    // 2. Update mode and ID
    const nextId = tableId || 'direct';
    if (tableId === null) {
      setSalesMode('customer');
      setSelectedTableId(null);
    } else {
      setSalesMode('table');
      setSelectedTableId(tableId);
    }

    // 3. Load state for next ID
    const nextOrder = tableOrders[nextId];
    if (nextOrder) {
      setCart(nextOrder.cart);
      setGlobalDiscount(nextOrder.globalDiscount);
      setSelectedCustomer(nextOrder.selectedCustomer);
      setDocType(nextOrder.docType || 'VD');
    } else {
      setCart([]);
      setGlobalDiscount(null);
      setSelectedCustomer(null);
      setDocType('VD');
    }
    setIsTableModalOpen(false);
  };

  const openTableModal = () => {
    const currentId = selectedTableId || 'direct';
    setTableOrders(prev => ({
      ...prev,
      [currentId]: { cart, globalDiscount, selectedCustomer, docType }
    }));
    setIsTableModalOpen(true);
  };

  const handleFinalizePayment = async () => {
    const saleDate = new Date();
    const saleTimestamp = saleDate.toISOString();
    const isVDDocument = docType === 'VD';
    if (!isConfigured) {
      const offlineSequence = isVDDocument ? nextVDNumber : null;
      const offlineDocumentNumber = isVDDocument && offlineSequence ? formatDocumentNumber(offlineSequence, saleDate) : null;
      alert('ConfiguraÃ§Ã£o do Supabase ausente ou invÃ¡lida. O pedido nÃ£o serÃ¡ salvo no banco de dados, mas o recibo serÃ¡ gerado.');
      setCurrentReceiptNumber(offlineDocumentNumber);
      setIsReceiptModalOpen(true);
      setIsSaleFinalized(true);
      if (isVDDocument && offlineSequence) {
        const updatedNext = offlineSequence + 1;
        setNextVDNumber(updatedNext);
      }
      setIsPaymentModalOpen(false);
      return;
    }

    const finalPayments = isMultiplePayment ? payments : (paymentMethod ? [{ method: paymentMethod, amount: paymentMethod === 'cash' && receivedAmount !== '' ? parseFloat(receivedAmount) : total }] : []);
    const amount = isMultiplePayment 
      ? payments.reduce((acc, p) => acc + p.amount, 0) 
      : (paymentMethod === 'cash' 
          ? (receivedAmount === '' ? total : parseFloat(receivedAmount)) 
          : total);
    const change = amount > total ? (amount - total) : 0;
    
    // Save to Supabase via service layer
    try {
      const result = await createOrder({
        cart,
        globalDiscount,
        selectedCustomerId: selectedCustomer?.id || null,
        selectedTableId: selectedTableId || null,
        docType,
        total,
        subtotal,
        tax,
        totalDiscount,
        isMultiplePayment,
        paymentMethod,
        receivedAmount,
        payments,
        saleTimestamp,
        saleDate,
      });

      // Open receipt modal for manual printing
      setCurrentReceiptNumber(result.usedDocumentNumber);
      setIsReceiptModalOpen(true);
      setIsSaleFinalized(true);
      if (isVDDocument && result.usedSequence) {
        const updatedNext = result.usedSequence + 1;
        setNextVDNumber(updatedNext);
      }

      // Align UI stock with the server after the atomic checkout succeeded.
      try {
        const productsData = await posFetchProducts();
        if (productsData && productsData.length > 0) setProducts(productsData);
      } catch {
        // Non-fatal: stock will be corrected on next refresh / error flow.
      }

      setIsPaymentModalOpen(false);
    } catch (error: any) {
      const err = handleSupabaseError(error, 'handleFinalizePayment');
      alert(`Erro ao salvar o pedido: ${err.message}` + "`n`n" + `O recibo será exibido para impressão.`);

      // The order was not persisted on the server, so release the optimistic UI reservations.
      // Then refresh product stock from the server (helps with concurrent sales).
      try {
        const restockByProductId = new Map<string, number>();
        for (const item of cart) {
          if (item.is_service) continue;
          restockByProductId.set(
            item.id,
            (restockByProductId.get(item.id) ?? 0) + item.quantity
          );
        }

        if (restockByProductId.size > 0) {
          setProducts((prev) =>
            prev.map((p) => {
              const delta = restockByProductId.get(p.id);
              if (delta == null) return p;
              return { ...p, stock_quantity: Number(p.stock_quantity ?? 0) + delta };
            })
          );
        }

        const productsData = await posFetchProducts();
        if (productsData && productsData.length > 0) setProducts(productsData);
      } catch {
        // If refresh fails, the optimistic release above is still enough to keep UI consistent.
      }

      // Still allow viewing receipt even if saving fails
      setCurrentReceiptNumber(null);
      setIsReceiptModalOpen(true);
      setIsSaleFinalized(true);
      try {
        const nextSequence = await posSyncNextVDNumber(new Date());
        setNextVDNumber(nextSequence);
      } catch {
        setNextVDNumber(1);
      }
      setIsPaymentModalOpen(false);
    }
  };

  const handleSaveCustomer = async () => {
    if (!newCustomer.name || !newCustomer.phone) return;
    
    try {
      const updatedCustomers = await saveCustomer({
        editingCustomerId: editingCustomer ? editingCustomer.id : null,
        newCustomer: {
          name: newCustomer.name,
          phone: newCustomer.phone,
          email: newCustomer.email,
          address: newCustomer.address,
        },
      });

      if (editingCustomer) setEditingCustomer(null);
      setCustomers(updatedCustomers);
      setNewCustomer({ name: '', phone: '', email: '', address: '' });
      setIsAddingCustomer(false);
      showToast('Cliente salvo com sucesso!', 'success');
    } catch (error: any) {
      handleSupabaseError(error, 'handleSaveCustomer');
      showToast('Erro ao salvar cliente no banco de dados.', 'error');
    }
  };

  const handleDeleteCustomer = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomerToDelete(id);
  };

  const confirmDeleteCustomer = async () => {
    if (customerToDelete) {
      try {
        const updatedCustomers = await deleteCustomer(customerToDelete);
        if (selectedCustomer?.id === customerToDelete) setSelectedCustomer(null);
        setCustomers(updatedCustomers);
        setCustomerToDelete(null);
        showToast('Cliente excluÃ­do com sucesso!', 'success');
      } catch (error) {
        handleSupabaseError(error, 'confirmDeleteCustomer');
        alert('Erro ao excluir cliente.');
      }
    }
  };

  const startEditingCustomer = (customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCustomer(customer);
    setNewCustomer({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || '',
      address: customer.address || ''
    });
    setIsAddingCustomer(true);
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
    c.phone.includes(customerSearch)
  );

  const applyDiscount = () => {
    const amount = parseFloat(discountAmount);
    if (isNaN(amount) || amount < 0) return;

    if (discountTarget === 'all') {
      setGlobalDiscount({ type: discountType, amount });
      // Limpar descontos individuais ao aplicar um global (opcional, mas evita confusão)
      setCart(prev => prev.map(item => ({ ...item, discount: undefined })));
    } else {
      setCart(prev => prev.map(item => {
        if (item.id === selectedCartItemId) {
          return {
            ...item,
            discount: {
              type: discountType,
              amount: amount
            }
          };
        }
        return item;
      }));
      setGlobalDiscount(null); // Limpar global ao aplicar específico
    }
    
    setIsDiscountModalOpen(false);
    setDiscountAmount('');
  };

  const selectedItem = useMemo(() => cart.find(item => item.id === selectedCartItemId), [cart, selectedCartItemId]);

  const previewDiscount = useMemo(() => {
    const amount = parseFloat(discountAmount) || 0;
    if (discountTarget === 'selected' && selectedItem) {
      const currentTotal = selectedItem.price * selectedItem.quantity;
      const discountVal = discountType === 'percentage' 
        ? (currentTotal * amount / 100) 
        : amount; // Valor total para a linha
      return { current: currentTotal, discount: discountVal, name: selectedItem.name };
    } else if (discountTarget === 'all') {
      const discountVal = discountType === 'percentage' 
        ? (originalTotal * amount / 100) 
        : amount; // Valor total para a conta
      return { current: originalTotal, discount: discountVal, name: 'Todos os Itens' };
    }
    return null;
  }, [discountAmount, discountType, discountTarget, selectedItem, originalTotal]);

  const { productFamilies, visibleProducts } = useProducts(products, searchQuery, selectedCategory);

  const handleReceiptPrimaryAction = () => {
    if (isSaleFinalized) {
      clearCart(true);
      setCustomerName('');
      setTableNumber('');
      setPaymentMethod(null);
      setReceivedAmount('');
      setGlobalDiscount(null);
      setSelectedCustomer(null);
      setCurrentReceiptNumber(null);
      setIsSaleFinalized(false);
      setPayments([]);
      setIsMultiplePayment(false);
      setMultiplePaymentAmount('');
    }
    setIsReceiptModalOpen(false);
  };

  const handleReceiptPrint = () => {
    const printMarkup = buildPrintReceiptMarkup();
    const estimatedHeightMm = Math.max(
      120,
      82 + (cart.length * 8) + (isSaleFinalized ? (payments.length > 0 ? payments.length * 6 : 12) + 22 : 0)
    );
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
                        <html>
                          <head>
                            <meta charset="utf-8" />
                            <title>Recibo POS</title>
                            <style id="page-size-style">
                              @page {
                                size: 72mm ${estimatedHeightMm}mm;
                                margin: 0;
                              }
                            </style>
                            <style>
                              html, body {
                                width: 72mm;
                                height: auto;
                                margin: 0;
                                padding: 0;
                                background: white;
                                overflow: hidden;
                              }
                              body {
                                font-family: Consolas, 'Lucida Console', 'Courier New', monospace;
                                color: black;
                                background: white;
                                width: 72mm;
                                padding: 0;
                                box-sizing: border-box;
                                -webkit-print-color-adjust: exact;
                                print-color-adjust: exact;
                              }
                              * {
                                box-sizing: border-box;
                              }
                              .print-receipt {
                                width: 66mm;
                                margin: 0;
                                padding: 3mm 3mm 4mm;
                              }
                              .print-header {
                                text-align: center;
                                font-size: 10px;
                                font-weight: 800;
                                line-height: 1.4;
                              }
                              .logo {
                                font-size: 23px;
                                font-weight: 900;
                                letter-spacing: 0.4px;
                                margin-bottom: 8px;
                              }
                              .customer {
                                margin-top: 12px;
                              }
                              .print-block {
                                padding-top: 6px;
                                margin-top: 10px;
                              }
                              .print-meta,
                              .print-row,
                              .print-columns {
                                display: flex;
                                justify-content: space-between;
                                gap: 6px;
                              }
                              .print-meta {
                                font-size: 9px;
                                font-weight: 700;
                              }
                              .print-meta span:last-child {
                                text-align: right;
                              }
                              .print-doc {
                                margin-top: 6px;
                                font-size: 12px;
                                font-weight: 900;
                              }
                              .print-columns {
                                font-size: 9px;
                                font-weight: 800;
                                margin-bottom: 3px;
                              }
                              .qty {
                                width: 8mm;
                                flex: 0 0 8mm;
                              }
                              .desc {
                                flex: 1 1 auto;
                                min-width: 0;
                              }
                              .unit {
                                width: 14mm;
                                flex: 0 0 14mm;
                                text-align: right;
                              }
                              .line-total {
                                width: 16mm;
                                flex: 0 0 16mm;
                                text-align: right;
                              }
                              .print-divider {
                                border-top: 1px dashed #000;
                                margin: 4px 0;
                              }
                              .payment-divider {
                                margin-top: 6px;
                              }
                              .print-items {
                                padding-top: 1px;
                              }
                              .print-item-row {
                                display: grid;
                                grid-template-columns: 8mm minmax(0, 1fr) 14mm 16mm;
                                gap: 6px;
                                align-items: start;
                                font-size: 9px;
                                font-weight: 800;
                                padding: 2px 0;
                              }
                              .print-totals {
                                margin-top: 10px;
                                font-size: 10px;
                                font-weight: 800;
                              }
                              .print-totals .print-row {
                                margin-top: 3px;
                              }
                              .total-row {
                                margin-top: 6px;
                                padding-top: 6px;
                                font-size: 15px;
                                font-weight: 900;
                              }
                              .print-pay-header {
                                font-size: 9px;
                                font-weight: 800;
                                margin-bottom: 3px;
                              }
                              .payment-row {
                                font-size: 9px;
                                margin-top: 4px;
                                font-weight: 800;
                              }
                              .print-change {
                                margin-top: 4px;
                                padding-top: 4px;
                                font-size: 9px;
                                font-weight: 800;
                              }
                              .print-footer {
                                border-top: 1px dashed #000;
                                margin-top: 10px;
                                padding-top: 10px;
                                text-align: center;
                                font-size: 10px;
                                font-weight: 800;
                                line-height: 1.5;
                              }
                              .foot-note {
                                margin-top: 10px;
                                font-size: 9px;
                                font-style: italic;
                                font-weight: 900;
                              }
                            </style>
                          </head>
                          <body>
                            ${printMarkup}
                            <script>
                              (function () {
                                const receipt = document.querySelector('.print-receipt');
                                const styleTag = document.getElementById('page-size-style');
                                const runPrint = function () {
                                  if (receipt && styleTag) {
                                    const receiptHeightPx = receipt.scrollHeight;
                                    const receiptHeightMm = Math.max(70, Math.ceil((receiptHeightPx * 25.4) / 96) + 4);
                                    styleTag.textContent = '@page { size: 72mm ' + receiptHeightMm + 'mm; margin: 0; }';
                                  }
                                  requestAnimationFrame(function () {
                                    requestAnimationFrame(function () {
                                      window.print();
                                      window.close();
                                    });
                                  });
                                };
                                if (document.fonts && document.fonts.ready) {
                                  document.fonts.ready.then(runPrint);
                                } else {
                                  runPrint();
                                }
                              })();
                            </script>
                          </body>
                        </html>
                      `);
      printWindow.document.close();
    } else {
      alert('Por favor, permita popups para imprimir o recibo.');
    }
  };

  if (!isLoggedIn || !isAuthRestored) {
    if (!isAuthRestored) return null; // Prevent flicker
    return (
      <LoginScreen 
        users={users}
        selectedUser={selectedLoginUser}
        onSelectUser={setSelectedLoginUser}
        password={loginPassword}
        setPassword={setLoginPassword}
        onLogin={login}
        error={loginError}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#121212] text-zinc-300 font-sans selection:bg-emerald-500/30">
      {!isConfigured && (
        <div className="bg-rose-600 text-white text-[10px] font-bold py-1 px-4 text-center animate-pulse z-[9999]">
          CONFIGURAÃ‡ÃƒO DO SUPABASE AUSENTE OU INVÃLIDA: Adicione NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY nas DefiniÃ§Ãµes (Settings).
        </div>
      )}
      
      {/* --- Top Header --- */}
      <Header
        selectedCustomerName={selectedCustomer?.name ?? null}
        selectedTableId={selectedTableId}
        salesMode={salesMode}
        isCashierModalOpen={isCashierModalOpen}
        onOpenCustomer={() => setIsCustomerModalOpen(true)}
        onOpenDiscount={() => setIsDiscountModalOpen(true)}
        onOpenTable={openTableModal}
        onOpenCashier={() => setIsCashierModalOpen(true)}
        onOpenAdminSidebar={() => setIsAdminSidebarOpen(true)}
      />

      <main className="flex flex-1 overflow-hidden">
        <ProductList
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          productFamilies={productFamilies}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          visibleProducts={visibleProducts}
          formatPrice={formatPrice}
          onAddToCart={addToCart}
          familiesScrollRef={familiesScrollRef}
          onFamiliesPointerDown={handleFamiliesPointerDown}
          onFamiliesPointerMove={handleFamiliesPointerMove}
          onFamiliesPointerRelease={handleFamiliesPointerRelease}
          onFamiliesClickCapture={(e) => {
            if (familiesDragStateRef.current.moved) {
              e.preventDefault();
              e.stopPropagation();
              familiesDragStateRef.current.moved = false;
            }
          }}
        />
        <Cart
          selectedCartItemId={selectedCartItemId}
          onDeleteSelected={() => selectedCartItemId && removeFromCart(selectedCartItemId)}
          docType={docType}
          onCycleDocType={() => {
            const types: ('VD' | 'TK' | 'FP')[] = ['VD', 'TK', 'FP'];
            const nextIndex = (types.indexOf(docType) + 1) % types.length;
            setDocType(types[nextIndex]);
          }}
          selectedCustomer={selectedCustomer}
          customerName={customerName}
          onCustomerNameChange={setCustomerName}
          customers={customers}
          onSelectCustomer={(customer) => {
            setSelectedCustomer(customer);
            if (customer) setCustomerName('');
          }}
          onCreateCustomerFromName={() => {
            setNewCustomer({ ...newCustomer, name: customerName });
            setIsAddingCustomer(true);
            setIsCustomerModalOpen(true);
          }}
          tableNumber={tableNumber}
          onTableNumberChange={setTableNumber}
          cart={cart}
          globalDiscount={globalDiscount}
          formatPrice={formatPrice}
          onToggleItemSelection={(id) => setSelectedCartItemId((prev) => (prev === id ? null : id))}
          onEditItemQuantity={(item) => {
            setEditingItem(item);
            setTempQuantity(item.quantity.toString());
            setIsQuantityModalOpen(true);
          }}
          onRemoveItem={removeFromCart}
          onClearSelection={() => setSelectedCartItemId(null)}
          originalSubtotal={originalSubtotal}
          totalDiscount={totalDiscount}
          tax={tax}
          total={total}
          onCancelOrder={() => {
            if (cart.length === 0) {
              showToast('NÃ£o existe nada no carrinho de compra', 'error');
            } else {
              setIsCancelModalOpen(true);
            }
          }}
          onOpenPayment={() => cart.length > 0 && setIsPaymentModalOpen(true)}
          onOpenBillPreview={() => cart.length > 0 && setIsReceiptModalOpen(true)}
        />
      </main>

      {/* --- Stock Warning Modal --- */}
      <AnimatePresence>
        {isStockModalOpen && pendingProduct && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => { setIsStockModalOpen(false); setPendingProduct(null); }}>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 mx-auto">
                  <AlertTriangle size={32} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Produto sem Estoque</h2>
                  <p className="text-sm text-zinc-400 mt-2">
                    O produto <span className="text-white font-bold">&quot;{pendingProduct.name}&quot;</span> está com quantidade zero no estoque.
                  </p>
                  <p className="text-sm text-zinc-500 mt-1 italic">
                    Deseja continuar com a venda mesmo assim?
                  </p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => {
                      setIsStockModalOpen(false);
                      setPendingProduct(null);
                    }}
                    className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-all"
                  >
                    Não
                  </button>
                  <button 
                    onClick={() => {
                      executeAddToCart(pendingProduct);
                      setIsStockModalOpen(false);
                      setPendingProduct(null);
                    }}
                    className="flex-1 h-12 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition-all"
                  >
                    Sim, Continuar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <CustomerModal
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        isAddingCustomer={isAddingCustomer}
        setIsAddingCustomer={setIsAddingCustomer}
        editingCustomer={editingCustomer}
        newCustomer={newCustomer}
        setNewCustomer={setNewCustomer}
        customerSearch={customerSearch}
        setCustomerSearch={setCustomerSearch}
        filteredCustomers={filteredCustomers}
        selectedCustomer={selectedCustomer}
        setSelectedCustomer={setSelectedCustomer}
        onStartAddNew={() => {
          setEditingCustomer(null);
          setNewCustomer({ name: '', phone: '', email: '', address: '' });
          setIsAddingCustomer(true);
        }}
        onSaveCustomer={handleSaveCustomer}
        onStartEditingCustomer={startEditingCustomer}
        onRequestDeleteCustomer={handleDeleteCustomer}
        customerToDelete={customerToDelete}
        onCancelDelete={() => setCustomerToDelete(null)}
        onConfirmDelete={confirmDeleteCustomer}
      />

      {/* --- Discount Modal --- */}
      <AnimatePresence>
        {isDiscountModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => setIsDiscountModalOpen(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1a1a1a] border border-zinc-800 rounded p-6 w-full max-w-[400px] space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center">
                <h3 className="text-xl font-bold text-white">Aplicar Desconto</h3>
                <p className="text-sm text-zinc-500 mt-1">Configure o desconto para o pedido</p>
              </div>

              <div className="space-y-4">
                {/* Discount Type */}
                <div className="space-y-2">
                  <span className="text-sm font-medium text-zinc-500 capitalize">Tipo de Desconto</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setDiscountType('percentage')}
                      className={`py-3 rounded border text-sm transition-all font-medium ${
                        discountType === 'percentage' 
                          ? 'bg-zinc-900 border-emerald-500 text-emerald-400' 
                          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      Porcentagem (%)
                    </button>
                    <button 
                      onClick={() => setDiscountType('value')}
                      className={`py-3 rounded border text-sm transition-all font-medium ${
                        discountType === 'value' 
                          ? 'bg-zinc-900 border-emerald-500 text-emerald-400' 
                          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      Valor (MT)
                    </button>
                  </div>
                </div>

                {/* Discount Target */}
                <div className="space-y-2">
                  <span className="text-sm font-medium text-zinc-500 capitalize">Aplicar em</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setDiscountTarget('all')}
                      className={`py-3 rounded border text-sm transition-all font-medium ${
                        discountTarget === 'all' 
                          ? 'bg-zinc-900 border-emerald-500 text-emerald-400' 
                          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      Todos os Itens
                    </button>
                    <button 
                      onClick={() => setDiscountTarget('selected')}
                      disabled={!selectedCartItemId}
                      className={`py-3 rounded border text-sm transition-all font-medium ${
                        discountTarget === 'selected' 
                          ? 'bg-zinc-900 border-emerald-500 text-emerald-400' 
                          : !selectedCartItemId 
                            ? 'bg-zinc-900/50 border-zinc-800/50 text-zinc-700 cursor-not-allowed'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      Item Selecionado
                    </button>
                  </div>
                  {!selectedCartItemId && discountTarget === 'selected' && (
                    <p className="text-sm text-red-400 italic">Selecione um item no carrinho primeiro</p>
                  )}
                </div>

                {/* Discount Amount */}
                <div className="space-y-2">
                  <span className="text-sm font-medium text-zinc-500 capitalize">Valor do Desconto</span>
                  <div className="relative">
                    <input 
                      type="number"
                      step="any"
                      value={discountAmount ?? ''}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-zinc-950 border border-zinc-700 rounded py-3 px-4 text-sm text-right text-emerald-400 font-mono font-bold outline-none focus:border-emerald-500 transition-colors"
                      autoFocus
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none">
                      {discountType === 'percentage' ? '%' : 'MT'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Preview Section */}
              {previewDiscount && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900/50 border border-zinc-800 rounded p-4 space-y-2"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-zinc-500 capitalize">Resumo do Desconto</span>
                    <span className="text-sm font-medium text-emerald-500 capitalize px-2 py-0.5 bg-emerald-500/10 rounded-full">Preview</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Alvo:</span>
                      <span className="text-zinc-200 font-bold">{previewDiscount.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Valor Atual:</span>
                      <span className="text-zinc-200 font-mono">{formatPrice(previewDiscount.current)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Desconto:</span>
                      <span className="text-emerald-500 font-mono">-{formatPrice(previewDiscount.discount)}</span>
                    </div>
                    <div className="pt-2 mt-2 border-t border-zinc-800 flex justify-between items-center">
                      <span className="text-sm font-medium text-white capitalize">Novo Total:</span>
                      <span className="text-lg font-bold text-white font-mono">
                        {formatPrice(Math.max(0, previewDiscount.current - previewDiscount.discount))}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setIsDiscountModalOpen(false)}
                  className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded font-medium transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={applyDiscount}
                  disabled={!discountAmount || (discountTarget === 'selected' && !selectedCartItemId)}
                  className={`flex-1 h-12 rounded text-sm font-medium transition-all ${
                    discountAmount && (discountTarget === 'all' || selectedCartItemId)
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  Aplicar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Quantity Modal --- */}
      <AnimatePresence>
        {isQuantityModalOpen && editingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setIsQuantityModalOpen(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1a1a1a] border border-zinc-800 rounded p-6 w-full max-w-[320px] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-white mb-1 text-center">{editingItem.name}</h3>
              <p className="text-xs text-zinc-500 mb-6 text-center">Atualizar quantidade do produto</p>
              
              <div className="space-y-6">
                <div className="flex items-center gap-2 w-full">
                  <button 
                    onClick={() => setTempQuantity(prev => {
                      const val = parseFloat(prev) || 0;
                      return Math.max(0, val - 1).toString();
                    })}
                    className="w-10 h-10 shrink-0 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded text-xl font-bold transition-colors"
                  >
                    -
                  </button>
                  <input 
                    type="number" 
                    step="any"
                    value={tempQuantity ?? ''}
                    onChange={(e) => setTempQuantity(e.target.value)}
                    className="flex-1 min-w-0 h-10 bg-zinc-900 border border-zinc-800 rounded text-center text-xl font-bold outline-none focus:border-emerald-500 transition-colors"
                    autoFocus
                  />
                  <button 
                    onClick={() => setTempQuantity(prev => {
                      const val = parseFloat(prev) || 0;
                      return (val + 1).toString();
                    })}
                    className="w-10 h-10 shrink-0 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded text-xl font-bold transition-colors"
                  >
                    +
                  </button>
                </div>
                
                <div className="flex gap-2 pt-2">
                  <button 
                    onClick={() => setIsQuantityModalOpen(false)}
                    className="flex-1 h-11 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => {
                      const q = parseFloat(tempQuantity);
                      if (!isNaN(q)) {
                        updateQuantity(editingItem.id, q);
                      }
                      setIsQuantityModalOpen(false);
                    }}
                    className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition-colors text-sm"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Payment Modal --- */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setPaymentMethod(null);
          setReceivedAmount('');
          setPayments([]);
          setIsMultiplePayment(false);
        }}
        selectedCustomer={selectedCustomer}
        customerName={customerName}
        tableNumber={tableNumber}
        cart={cart}
        globalDiscount={globalDiscount}
        originalTotal={originalTotal}
        subtotal={subtotal}
        tax={tax}
        totalDiscount={totalDiscount}
        total={total}
        isMultiplePayment={isMultiplePayment}
        onToggleMultiplePayment={() => {
          setIsMultiplePayment(!isMultiplePayment);
          setPayments([]);
          setPaymentMethod(null);
          setReceivedAmount('');
        }}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        receivedAmount={receivedAmount}
        setReceivedAmount={setReceivedAmount}
        payments={payments}
        setPayments={setPayments}
        multiplePaymentMethod={multiplePaymentMethod}
        setMultiplePaymentMethod={setMultiplePaymentMethod}
        multiplePaymentAmount={multiplePaymentAmount}
        setMultiplePaymentAmount={setMultiplePaymentAmount}
        onFinalize={handleFinalizePayment}
        formatPrice={formatPrice}
      />

      <ReceiptPreview
        isOpen={isReceiptModalOpen}
        isSaleFinalized={isSaleFinalized}
        docType={docType}
        nextVDNumber={nextVDNumber}
        currentReceiptNumber={currentReceiptNumber}
        selectedCustomer={selectedCustomer}
        currentUserName={currentUser?.name || null}
        cart={cart}
        subtotal={subtotal}
        tax={tax}
        total={total}
        isMultiplePayment={isMultiplePayment}
        paymentMethod={paymentMethod}
        receivedAmount={receivedAmount}
        payments={payments}
        formatDocumentNumber={formatDocumentNumber}
        onPrimaryAction={handleReceiptPrimaryAction}
        onPrint={handleReceiptPrint}
      />

      {/* --- Cancel Order Confirmation Modal --- */}
      <AnimatePresence>
        {isCancelModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded p-8 w-full max-w-[400px] text-center space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-20 h-20 bg-amber-500/10 rounded flex items-center justify-center mx-auto text-amber-500">
                <AlertTriangle size={40} />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white capitalize tracking-tight">Cancelar Pedido?</h3>
                <p className="text-sm text-zinc-500">
                  Tem certeza que deseja cancelar este pedido? Todos os itens adicionados ao carrinho serão removidos.
                </p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setIsCancelModalOpen(false)}
                  className="flex-1 h-14 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-all"
                >
                  Não, voltar
                </button>
                <button 
                  onClick={() => {
                    clearCart(false);
                    setIsCancelModalOpen(false);
                  }}
                  className="flex-1 h-14 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition-all"
                >
                  Sim, cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AdminPanel
        isOpen={isAdminSidebarOpen}
        onClose={() => setIsAdminSidebarOpen(false)}
        currentUserName={currentUser?.name || null}
        currentDate={currentDate}
        onGoToManagement={() => router.push('/management')}
        onLogout={() => {
          localStorage.setItem('isLoggedIn', 'false');
          localStorage.removeItem('currentUser');
          window.dispatchEvent(new Event('pos-auth-changed'));
          setIsLoggedIn(false);
          setCurrentUser(null);
          setIsAdminSidebarOpen(false);
        }}
      />

      {/* Table Selection Modal */}
      <AnimatePresence>
        {isTableModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsCashierModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 w-full max-w-4xl rounded border border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded text-emerald-500">
                    <Utensils size={24} />
                  </div>
                  <h2 className="text-xl font-bold text-white capitalize tracking-tight">SeleÃ§Ã£o de Mesa</h2>
                </div>
                <button 
                  onClick={() => setIsTableModalOpen(false)}
                  className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto">
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
                  {/* Direct Sale Option */}
                  <button
                    onClick={() => handleTableSelect(null)}
                    className={`flex flex-col items-center justify-center p-6 rounded border-2 transition-all ${
                      salesMode === 'customer' 
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                        : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                    }`}
                  >
                    <User size={32} className="mb-2" />
                    <span className="text-sm font-bold capitalize">Venda Direta</span>
                  </button>

                  {/* Tables */}
                  {Array.from({ length: 20 }, (_, i) => (i + 1).toString()).map(tableId => {
                    const order = tableOrders[tableId];
                    const isOccupied = order && order.cart.length > 0;
                    const isActive = selectedTableId === tableId;

                    return (
                      <button
                        key={tableId}
                        onClick={() => handleTableSelect(tableId)}
                        className={`flex flex-col items-center justify-center p-6 rounded border-2 transition-all relative ${
                          isActive
                            ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                            : isOccupied
                              ? 'bg-amber-500/10 border-amber-500 text-amber-400'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600'
                        }`}
                      >
                        <span className="text-2xl font-bold">{tableId}</span>
                        <span className="text-[10px] font-bold capitalize mt-1">
                          {isOccupied ? 'Ocupada' : 'Livre'}
                        </span>
                        {isOccupied && (
                          <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cashier Modal */}
      <AnimatePresence>
        {isCashierModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsCashierModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#121212] w-full max-w-4xl rounded border border-zinc-800 overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-[#1a1a1a]">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-white capitalize tracking-tight">OperaÃ§Ãµes de Caixa: Caixa 1</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsCashierModalOpen(false)}
                    className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex flex-1 min-h-[400px]">
                {/* Left Sidebar - Status Buttons */}
                <div className="w-48 p-4 border-r border-zinc-800 flex flex-col gap-2 bg-[#121212]">
                  <button 
                    className={`h-16 rounded border bg-transparent px-3 text-center font-semibold text-[15px] leading-[1.15] tracking-tight transition-all text-white ${
                      isCashierOpen
                        ? 'border-emerald-600/45 hover:border-emerald-500/70 hover:bg-zinc-800/60 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.14)]'
                        : 'border-red-600/45 hover:border-red-500/70 hover:bg-zinc-800/60 hover:shadow-[0_0_0_1px_rgba(239,68,68,0.12)]'
                    }`}
                    onClick={() => {
                      if (isCashierOpen) {
                        showToast("O caixa já está aberto", "info");
                      } else {
                        setIsCashierOpen(true);
                        showToast("Caixa aberto com sucesso", "success");
                      }
                    }}
                  >
                    Abrir<br/>Caixa
                  </button>
                  <button 
                    className={`h-16 rounded border bg-transparent px-3 text-center font-semibold text-[15px] leading-[1.15] tracking-tight transition-all text-white ${
                      isSessionOpen
                        ? 'border-emerald-600/45 hover:border-emerald-500/70 hover:bg-zinc-800/60 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.14)]'
                        : 'border-red-600/45 hover:border-red-500/70 hover:bg-zinc-800/60 hover:shadow-[0_0_0_1px_rgba(239,68,68,0.12)]'
                    }`}
                    onClick={() => {
                      if (!isCashierOpen) {
                        showToast("O caixa deve estar aberto para abrir uma sessão", "error");
                      } else if (isSessionOpen) {
                        showToast("A sessão já está aberta", "info");
                      } else {
                        setIsSessionOpen(true);
                        showToast("Sessão aberta com sucesso", "success");
                      }
                    }}
                  >
                    Abrir<br/>Sessão
                  </button>
                  
                  <div className="mt-auto flex flex-col gap-2">
                    <button 
                      className={`h-16 rounded border px-3 text-center font-semibold text-[15px] leading-[1.15] tracking-tight transition-all text-white ${
                        isSessionOpen
                          ? 'border-emerald-600/45 bg-transparent hover:border-emerald-500/70 hover:bg-zinc-800/60 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.14)]'
                          : 'border-zinc-800 bg-[#121212] hover:border-zinc-700 hover:bg-zinc-800/70'
                      }`}
                      onClick={() => {
                        if (!isSessionOpen) {
                          showToast("Não existe uma sessão aberta para fechar", "error");
                        } else {
                          setIsSessionOpen(false);
                          showToast("Sessão fechada com sucesso", "success");
                        }
                      }}
                    >
                      Fechar<br/>sessão
                    </button>
                    <button 
                      className={`h-16 rounded border px-3 text-center font-semibold text-[15px] leading-[1.15] tracking-tight transition-all text-white ${
                        isCashierOpen
                          ? 'border-emerald-600/45 bg-transparent hover:border-emerald-500/70 hover:bg-zinc-800/60 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.14)]'
                          : 'border-zinc-800 bg-[#121212] hover:border-zinc-700 hover:bg-zinc-800/70'
                      }`}
                      onClick={() => {
                        if (!isCashierOpen) {
                          showToast("O caixa já está fechado", "info");
                        } else if (isSessionOpen) {
                          showToast("A sessão deve estar fechada para fechar o caixa", "error");
                        } else {
                          setIsCashierOpen(false);
                          showToast("Caixa fechado com sucesso", "success");
                        }
                      }}
                    >
                      Fechar<br/>caixa
                    </button>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 p-6 flex flex-col gap-8 bg-[#121212]">
                  {/* Documento de Caixa Section */}
                  <section>
                    <div className="flex items-center gap-4 mb-4">
                      <h3 className="text-sm md:text-[15px] font-semibold text-zinc-400 tracking-[0.08em] whitespace-nowrap">Documento de caixa</h3>
                      <div className="h-px w-full bg-zinc-800" />
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {['Vale', 'Saída Caixa', 'Entrada Caixa', 'Vale liquidação', 'Saída de fundo de maneio', 'Entrada de fundo de maneio', 'Recibo de adiantamento'].map((doc) => (
                        <button 
                          key={doc}
                          className="h-16 rounded border border-zinc-800 bg-[#121212] px-4 text-center font-semibold text-[15px] leading-[1.15] tracking-tight text-white transition-all hover:border-zinc-700 hover:bg-zinc-800/70 flex items-center justify-center"
                        >
                          {doc}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Relatórios de Caixa Section */}
                  <section>
                    <div className="flex items-center gap-4 mb-4">
                      <h3 className="text-sm md:text-[15px] font-semibold text-zinc-400 tracking-[0.08em] whitespace-nowrap">Relatórios de caixa</h3>
                      <div className="h-px w-full bg-zinc-800" />
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        'Resumo de vendas', 
                        'Vendas por categoria', 
                        'Vendas por utilizador', 
                        'Vendas por mesa', 
                        'Vendas por cliente', 
                        'Vendas por hora', 
                        'Vendas por dia', 
                        'Vendas por mês'
                      ].map((report) => (
                        <button 
                          key={report}
                          className="h-16 rounded border border-zinc-800 bg-[#121212] px-4 text-center font-semibold text-[15px] leading-[1.15] tracking-tight text-white transition-all hover:border-zinc-700 hover:bg-zinc-800/70 flex items-center justify-center"
                        >
                          {report}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </div>

              {/* Bottom Row - Red Buttons */}
              <div className="p-4 border-t border-zinc-800 flex gap-3">
                <button 
                  className="flex-1 h-14 rounded border border-zinc-800 bg-[#121212] text-white font-medium text-sm capitalize transition-all hover:border-zinc-700 hover:bg-zinc-800/70 flex flex-col items-center justify-center"
                  onClick={() => showToast("Dia fechado com sucesso", "success")}
                >
                  <span className="text-[10px] md:text-xs">Fechar dia:</span>
                  <span className="text-xs md:text-sm leading-tight">{new Date().toLocaleDateString('pt-PT', { weekday: 'long' })}</span>
                  <span className="text-xs md:text-sm leading-tight">{new Date().toISOString().split('T')[0]}</span>
                </button>
                <button 
                  className="flex-1 h-14 rounded border border-zinc-800 bg-[#121212] text-white font-medium text-sm leading-tight capitalize transition-all hover:border-zinc-700 hover:bg-zinc-800/70"
                >
                  Registar relÃ³gio de ponto
                </button>
                <button 
                  className="flex-1 h-14 rounded border border-zinc-800 bg-[#121212] text-white font-medium text-sm leading-tight capitalize transition-all hover:border-zinc-700 hover:bg-zinc-800/70"
                >
                  Transferir vendas ativas
                </button>
                <button 
                  className="flex-1 h-14 rounded border border-zinc-800 bg-[#121212] text-white font-medium text-sm leading-tight capitalize transition-all hover:border-zinc-700 hover:bg-zinc-800/70"
                >
                  TransferÃªncia de turno
                </button>
              </div>

              {/* Footer Inputs */}
              <div className="p-4 bg-[#121212] border-t border-zinc-800 grid grid-cols-3 gap-6">
                <div className="flex flex-col gap-1">
                  <label className="text-xs md:text-sm font-bold text-zinc-500 capitalize">Impressora</label>
                  <select 
                    value={cashierPrinter}
                    onChange={(e) => setCashierPrinter(e.target.value)}
                    className="h-10 bg-zinc-800 border border-zinc-700 rounded px-3 text-base text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="Impressora do evento">Impressora do evento</option>
                    <option value="Impressora tÃ©rmica">Impressora tÃ©rmica</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs md:text-sm font-bold text-zinc-500 capitalize">Dia inicial</label>
                  <input 
                    type="date"
                    value={cashierStartDate}
                    onChange={(e) => setCashierStartDate(e.target.value)}
                    className="h-10 bg-zinc-800 border border-zinc-700 rounded px-3 text-base text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs md:text-sm font-bold text-zinc-500 capitalize">Dia final</label>
                  <input 
                    type="date"
                    value={cashierEndDate}
                    onChange={(e) => setCashierEndDate(e.target.value)}
                    className="h-10 bg-zinc-800 border border-zinc-700 rounded px-3 text-base text-white focus:outline-none focus:border-red-500"
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded flex items-center gap-3 border border-zinc-800 bg-[#1a1a1a]"
          >
            <div className={`p-2 rounded ${
              toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-500' :
              toast.type === 'error' ? 'bg-red-500/20 text-red-500' :
              'bg-blue-500/20 text-blue-500'
            }`}>
              <AlertTriangle size={20} />
            </div>
            <span className="text-sm font-medium text-white">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

function PaymentMethodButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-4 rounded border-2 transition-all ${
        active 
          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
      }`}
    >
      <div className="mb-2">{icon}</div>
      <span className="text-[10px] font-bold capitalize tracking-tight">{label}</span>
    </button>
  );
}

function HeaderButton({ icon, label, active, className, onClick }: { icon: React.ReactNode, label: string, active?: boolean, className?: string, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`group flex min-w-[80px] flex-col items-center justify-center rounded border px-2 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_rgba(0,0,0,0.12)] transition-all duration-200 hover:-translate-y-[1px] hover:border-zinc-600 hover:bg-zinc-800/85 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.22)] ${active ? 'border-zinc-600 bg-zinc-800/95 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(255,255,255,0.02),0_12px_24px_rgba(0,0,0,0.2)]' : 'border-zinc-800/90 bg-zinc-900/35 text-zinc-400'} ${className}`}
    >
      <div className="mb-1 transition-transform duration-200 group-hover:scale-110">{icon}</div>
      <span className="text-[11px] capitalize font-bold tracking-tighter text-center leading-none">{label}</span>
    </button>
  );
}

function PaginationButton({ icon }: { icon: React.ReactNode }) {
  return (
    <button className="p-2 hover:bg-zinc-800 hover:text-zinc-200 rounded transition-colors">
      {icon}
    </button>
  );
}

function SidebarItem({ icon, label, onClick, className }: { icon: React.ReactNode, label: string, onClick?: () => void, className?: string }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-4 py-3 text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded transition-all group ${className || ''}`}
    >
      <div className="text-zinc-500 group-hover:text-white transition-colors">
        {icon}
      </div>
      <span className="text-sm font-medium tracking-tight">{label}</span>
    </button>
  );
}
