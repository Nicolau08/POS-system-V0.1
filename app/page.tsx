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
  HelpCircle,
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
import { supabase, isConfigured } from '@/lib/supabase';

const normalizeUnknownError = (error: any) => {
  if (error instanceof Error) {
    return {
      message: error.message || 'Erro desconhecido',
      details: (error as any).details || 'Sem detalhes adicionais',
      hint: (error as any).hint || 'Sem sugestões',
      code: (error as any).code || 'Sem código de erro',
      raw: error,
    };
  }

  if (typeof Event !== 'undefined' && error instanceof Event) {
    return {
      message: `Evento inesperado: ${error.type || 'desconhecido'}`,
      details: 'O navegador retornou um evento em vez de um erro estruturado.',
      hint: 'Verifique a ligação com a internet ou tente novamente.',
      code: 'BROWSER_EVENT',
      raw: error,
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
      details: 'Sem detalhes adicionais',
      hint: 'Sem sugestões',
      code: 'STRING_ERROR',
      raw: error,
    };
  }

  return {
    message: error?.message || error?.error_description || error?.error || 'Erro desconhecido',
    details: error?.details || 'Sem detalhes adicionais',
    hint: error?.hint || 'Sem sugestões',
    code: error?.code || 'Sem código de erro',
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

// --- Types ---
interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  color?: string;
  stock_quantity?: number;
  min_stock?: number;
  is_service?: boolean;
}

interface CartItem extends Product {
  quantity: number;
  discount?: {
    type: 'value' | 'percentage';
    amount: number;
  };
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  points?: number;
}

interface User {
  id: string;
  name: string;
  password?: string;
  role: 'admin' | 'user';
  avatar?: string;
}

const getDocumentYear = (date = new Date()) => date.getFullYear();

const formatDocumentNumber = (sequence: number, date = new Date()) =>
  `${getDocumentYear(date)}/${String(sequence).padStart(4, '0')}`;

const getDocumentCounterStorageKey = (year: number) => `pos_vd_counter_${year}`;

const extractVDSequence = (documentNumber: string | null | undefined, year: number) => {
  if (typeof documentNumber !== 'string') return null;
  const match = documentNumber.match(new RegExp(`^${year}/(\\d{4,})$`));
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const isDuplicateDocumentNumberError = (error: any) =>
  error?.code === '23505' ||
  typeof error?.message === 'string' && error.message.includes('idx_orders_document_number_unique');

const DEFAULT_PRODUCTS: Product[] = [
  { id: '550e8400-e29b-41d4-a716-446655440001', name: 'CARNES', price: 0, category: 'Category', color: 'bg-zinc-800' },
  { id: '550e8400-e29b-41d4-a716-446655440002', name: 'REFRIGERANTES', price: 0, category: 'Category', color: 'bg-zinc-800' },
  { id: '550e8400-e29b-41d4-a716-446655440003', name: 'Tempero de carne', price: 150.00, category: 'Product', color: 'bg-zinc-800' },
  { id: '550e8400-e29b-41d4-a716-446655440004', name: 'Arroz 5kg', price: 450.00, category: 'Product' },
  { id: '550e8400-e29b-41d4-a716-446655440005', name: 'Feijão 1kg', price: 120.00, category: 'Product' },
  { id: '550e8400-e29b-41d4-a716-446655440006', name: 'Óleo 1L', price: 180.00, category: 'Product' },
  { id: '550e8400-e29b-41d4-a716-446655440007', name: 'Açúcar 1kg', price: 85.00, category: 'Product' },
  { id: '550e8400-e29b-41d4-a716-446655440008', name: 'Leite 1L', price: 95.00, category: 'Product' },
  { id: '550e8400-e29b-41d4-a716-446655440009', name: 'Pão de Forma', price: 110.00, category: 'Product' },
  { id: '550e8400-e29b-41d4-a716-446655440010', name: 'Manteiga 250g', price: 140.00, category: 'Product' },
];

const DEFAULT_CUSTOMERS: Customer[] = [
  { id: '550e8400-e29b-41d4-a716-446655440101', name: 'João Silva', phone: '841234567', email: 'joao@email.com', points: 150 },
  { id: '550e8400-e29b-41d4-a716-446655440102', name: 'Maria Santos', phone: '829876543', email: 'maria@email.com', points: 45 },
  { id: '550e8400-e29b-41d4-a716-446655440103', name: 'António Muchanga', phone: '855555555', email: 'antonio@email.com', points: 0 },
];

const DEFAULT_USERS: User[] = [
  { id: '1', name: 'Admin', password: 'admin', role: 'admin', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin' },
  { id: '2', name: 'Caixa 1', password: '123', role: 'user', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Caixa1' },
];

function LoginScreen({ 
  users, 
  selectedUser, 
  onSelectUser, 
  password, 
  setPassword, 
  onLogin, 
  error 
}: { 
  users: User[], 
  selectedUser: User | null, 
  onSelectUser: (user: User) => void, 
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
          className="p-4 bg-zinc-800/50 hover:bg-red-600/20 text-zinc-500 hover:text-red-500 rounded transition-all duration-300 group border border-zinc-700/50"
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
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'pix' | null>(null);
  const [receivedAmount, setReceivedAmount] = useState<string>('');
  const [payments, setPayments] = useState<{method: 'cash' | 'card' | 'pix', amount: number}[]>([]);
  const [isMultiplePayment, setIsMultiplePayment] = useState(false);
  const [multiplePaymentMethod, setMultiplePaymentMethod] = useState<'cash' | 'card' | 'pix'>('cash');
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
  const [users, setUsers] = useState<User[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '' });
  const [customerSearch, setCustomerSearch] = useState('');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isAdminSidebarOpen, setIsAdminSidebarOpen] = useState(false);

  // Login State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthRestored, setIsAuthRestored] = useState(false);
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
  const [currentDate, setCurrentDate] = useState('');
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
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    setCurrentDate(`${day}/${month}/${year}`);
  }, []);

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

  const syncNextVDNumber = useCallback(async () => {
    const year = getDocumentYear();
    const localSequence = Number(localStorage.getItem(getDocumentCounterStorageKey(year)) || '1');

    if (!isConfigured) {
      setNextVDNumber(localSequence);
      return;
    }

    try {
      const startOfYear = `${year}-01-01T00:00:00`;
      const endOfYear = `${year}-12-31T23:59:59`;

      const { data, error } = await supabase
        .from('orders')
        .select('document_number, created_at')
        .eq('doc_type', 'VD')
        .gte('created_at', startOfYear)
        .lte('created_at', endOfYear);

      if (error) throw error;

      const maxSequence = (data || []).reduce((highest, order: any) => {
        const parsed = extractVDSequence(order.document_number, year);
        return parsed ? Math.max(highest, parsed) : highest;
      }, 0);

      const nextSequence = Math.max(localSequence, maxSequence + 1);
      localStorage.setItem(getDocumentCounterStorageKey(year), String(nextSequence));
      setNextVDNumber(nextSequence);
    } catch (error) {
      const fallbackSequence = Math.max(1, localSequence);
      handleSupabaseError(error, 'syncNextVDNumber');
      setNextVDNumber(fallbackSequence);
    }
  }, []);

  const getNextVDSequence = useCallback(async (date = new Date()) => {
    const year = getDocumentYear(date);
    const localSequence = Number(localStorage.getItem(getDocumentCounterStorageKey(year)) || '1');

    if (!isConfigured) {
      return Math.max(1, localSequence);
    }

    const startOfYear = `${year}-01-01T00:00:00`;
    const endOfYear = `${year}-12-31T23:59:59`;

    const { data, error } = await supabase
      .from('orders')
      .select('document_number, created_at')
      .eq('doc_type', 'VD')
      .gte('created_at', startOfYear)
      .lte('created_at', endOfYear);

    if (error) throw error;

    const maxSequence = (data || []).reduce((highest, order: any) => {
      const parsed = extractVDSequence(order.document_number, year);
      return parsed ? Math.max(highest, parsed) : highest;
    }, 0);

    return Math.max(1, localSequence, maxSequence + 1);
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
  const [selectedLoginUser, setSelectedLoginUser] = useState<User | null>(DEFAULT_USERS[0]);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(false);

  // --- Calculations ---
  const originalTotal = useMemo(() => cart.reduce((acc, item) => acc + (item.price * item.quantity), 0), [cart]);
  const originalSubtotal = originalTotal / 1.16;
  const originalTax = originalTotal - originalSubtotal;
  
  const totalDiscount = useMemo(() => {
    const itemsDiscount = cart.reduce((acc, item) => {
      if (!item.discount) return acc;
      const itemPriceWithTax = item.price; 
      let discountVal = 0;
      if (item.discount.type === 'percentage') {
        discountVal = (itemPriceWithTax * item.discount.amount / 100) * item.quantity;
      } else {
        // Valor fixo por LINHA (total para a quantidade do item)
        discountVal = item.discount.amount;
      }
      return acc + discountVal;
    }, 0);

    let gDiscount = 0;
    if (globalDiscount) {
      if (globalDiscount.type === 'percentage') {
        gDiscount = (originalTotal * globalDiscount.amount / 100);
      } else {
        gDiscount = globalDiscount.amount;
      }
    }

    return itemsDiscount + gDiscount;
  }, [cart, globalDiscount, originalTotal]);

  const total = Math.max(0, originalTotal - totalDiscount);
  const subtotal = total / 1.16;
  const tax = total - subtotal;

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
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return;
    }
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*');
      
      if (error) throw error;

      if (data && data.length > 0) {
        setUsers(data as User[]);
        if (!selectedLoginUser) {
          setSelectedLoginUser(data[0] as User);
        }
      } else {
        setUsers(DEFAULT_USERS);
      }
    } catch (error) {
      handleSupabaseError(error, 'fetchUsers');
      setUsers(DEFAULT_USERS);
    }
  }, [selectedLoginUser]);

  // --- Effects ---
  // Restore Session State (Auth & Cart)
  useEffect(() => {
    // Auth
    const savedLogin = localStorage.getItem('isLoggedIn');
    const savedUser = localStorage.getItem('currentUser');
    if (savedLogin === 'true' && savedUser) {
      try {
        setIsLoggedIn(true);
        setCurrentUser(JSON.parse(savedUser));
      } catch (error) {
        console.error('Error restoring auth session:', error);
        localStorage.removeItem('currentUser');
        localStorage.setItem('isLoggedIn', 'false');
      }
    }

    // Cart
    const savedCart = localStorage.getItem('pos_cart');
    const savedCustomer = localStorage.getItem('pos_selectedCustomer');
    const savedGlobalDiscount = localStorage.getItem('pos_globalDiscount');
    const savedDocType = localStorage.getItem('pos_docType');
    const savedSalesMode = localStorage.getItem('pos_salesMode');

    if (savedCart) {
      try {
        setCart(JSON.parse(savedCart));
      } catch (e) {
        console.error('Error restoring cart:', e);
      }
    }
    if (savedCustomer) {
      try {
        setSelectedCustomer(JSON.parse(savedCustomer));
      } catch (e) {
        console.error('Error restoring customer:', e);
      }
    }
    if (savedGlobalDiscount) {
      try {
        setGlobalDiscount(JSON.parse(savedGlobalDiscount));
      } catch (e) {
        console.error('Error restoring global discount:', e);
      }
    }
    if (savedDocType) {
      setDocType(savedDocType as 'VD' | 'TK' | 'FP');
    }
    if (savedSalesMode) {
      setSalesMode(savedSalesMode as 'customer' | 'table');
    }

    setIsAuthRestored(true);
  }, []);

  // Persist Cart State
  useEffect(() => {
    if (isAuthRestored) {
      localStorage.setItem('pos_cart', JSON.stringify(cart));
      if (selectedCustomer) {
        localStorage.setItem('pos_selectedCustomer', JSON.stringify(selectedCustomer));
      } else {
        localStorage.removeItem('pos_selectedCustomer');
      }
      if (globalDiscount) {
        localStorage.setItem('pos_globalDiscount', JSON.stringify(globalDiscount));
      } else {
        localStorage.removeItem('pos_globalDiscount');
      }
      localStorage.setItem('pos_docType', docType);
      localStorage.setItem('pos_salesMode', salesMode);
    }
  }, [cart, selectedCustomer, globalDiscount, docType, salesMode, isAuthRestored]);

  // Persist Auth State
  useEffect(() => {
    if (isAuthRestored) {
      localStorage.setItem('isLoggedIn', isLoggedIn.toString());
      if (currentUser) {
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
      } else {
        localStorage.removeItem('currentUser');
      }
      window.dispatchEvent(new Event('pos-auth-changed'));
    }
  }, [isLoggedIn, currentUser, isAuthRestored]);

  useEffect(() => {
    if (!isAuthRestored) return;
    syncNextVDNumber();
  }, [isAuthRestored, syncNextVDNumber]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isConfigured) {
        console.warn('Supabase não configurado. Usando dados padrão.');
        setProducts(DEFAULT_PRODUCTS);
        setCustomers(DEFAULT_CUSTOMERS);
        setUsers(DEFAULT_USERS);
        return;
      }
      // Fetch Products
      try {
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*, categories(name)');
        
        if (productsError) throw productsError;

        if (productsData && productsData.length > 0) {
          setProducts(productsData.map(p => ({
            id: p.id,
            name: p.name,
            price: Number(p.price),
            category: p.categories?.name || 'Product',
            color: p.color,
            image: p.image_url,
            stock_quantity: Number(p.stock_quantity || 0),
            min_stock: Number(p.min_stock || 0),
            is_service: p.is_service
          })));
        } else {
          setProducts(DEFAULT_PRODUCTS);
        }
      } catch (error) {
        handleSupabaseError(error, 'fetchProducts');
        setProducts(DEFAULT_PRODUCTS);
      }

      // Fetch Customers
      try {
        const { data: customersData, error: customersError } = await supabase
          .from('customers')
          .select('*');
        
        if (customersError) throw customersError;

        if (customersData && customersData.length > 0) {
          setCustomers(customersData as Customer[]);
        } else {
          setCustomers(DEFAULT_CUSTOMERS);
        }
      } catch (error) {
        handleSupabaseError(error, 'fetchCustomers');
        setCustomers(DEFAULT_CUSTOMERS);
      }

      // Fetch Users
      await fetchUsers();
    };

    fetchData();

    // Check for query param to open sidebar
    const params = new URLSearchParams(window.location.search);
    if (params.get('sidebar') === 'open') {
      setIsAdminSidebarOpen(true);
      // Clean up the URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchUsers]);

  const fetchProducts = () => {}; // No longer needed as we use onSnapshot
  const fetchCustomers = () => {}; // No longer needed as we use onSnapshot

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

  const executeAddToCart = async (product: Product) => {
    // Update stock in Supabase immediately
    if (!product.is_service && isConfigured) {
      try {
        const { data: latestProduct } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', product.id)
          .single();
        
        const currentStock = Number(latestProduct?.stock_quantity || 0);
        const newStock = currentStock - 1;

        const { error } = await supabase
          .from('products')
          .update({ stock_quantity: newStock })
          .eq('id', product.id);
        
        if (error) throw error;

        // Update local products state
        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, stock_quantity: newStock } : p));
      } catch (error) {
        console.error('Error updating stock on add to cart:', error);
        showToast('Erro ao atualizar estoque no servidor', 'error');
      }
    }

    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = async (id: string) => {
    const itemToRemove = cart.find(item => item.id === id);
    if (itemToRemove && !itemToRemove.is_service && isConfigured) {
      try {
        const { data: latestProduct } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', id)
          .single();
        
        const currentStock = Number(latestProduct?.stock_quantity || 0);
        const newStock = currentStock + itemToRemove.quantity;

        const { error } = await supabase
          .from('products')
          .update({ stock_quantity: newStock })
          .eq('id', id);
        
        if (error) throw error;

        // Update local products state
        setProducts(prev => prev.map(p => p.id === id ? { ...p, stock_quantity: newStock } : p));
      } catch (error) {
        console.error('Error updating stock on remove from cart:', error);
      }
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

    if (!item.is_service && isConfigured && delta !== 0) {
      try {
        const { data: latestProduct } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', id)
          .single();
        
        const currentStock = Number(latestProduct?.stock_quantity || 0);
        const newStock = currentStock - delta;

        const { error } = await supabase
          .from('products')
          .update({ stock_quantity: newStock })
          .eq('id', id);
        
        if (error) throw error;

        // Update local products state
        setProducts(prev => prev.map(p => p.id === id ? { ...p, stock_quantity: newStock } : p));
      } catch (error) {
        console.error('Error updating stock on quantity change:', error);
      }
    }

    setCart(prev => prev.map(item => item.id === id ? { ...item, quantity } : item));
  };

  const clearCart = async (isFinalized: boolean = false) => {
    // Return stock for all items if NOT finalized
    if (isConfigured && !isFinalized) {
      for (const item of cart) {
        if (item.is_service) continue;
        try {
          const { data: latestProduct } = await supabase
            .from('products')
            .select('stock_quantity')
            .eq('id', item.id)
            .single();
          
          const currentStock = Number(latestProduct?.stock_quantity || 0);
          const newStock = currentStock + item.quantity;

          await supabase
            .from('products')
            .update({ stock_quantity: newStock })
            .eq('id', item.id);
          
          // Update local products state
          setProducts(prev => prev.map(p => p.id === item.id ? { ...p, stock_quantity: newStock } : p));
        } catch (error) {
          console.error('Error returning stock on clear cart:', error);
        }
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
      alert('Configuração do Supabase ausente ou inválida. O pedido não será salvo no banco de dados, mas o recibo será gerado.');
      setCurrentReceiptNumber(offlineDocumentNumber);
      setIsReceiptModalOpen(true);
      setIsSaleFinalized(true);
      if (isVDDocument && offlineSequence) {
        const updatedNext = offlineSequence + 1;
        setNextVDNumber(updatedNext);
        localStorage.setItem(getDocumentCounterStorageKey(getDocumentYear(saleDate)), String(updatedNext));
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
    
    // Save to Supabase
    try {
      let order: any = null;
      let usedSequence: number | null = null;
      let usedDocumentNumber: string | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        usedSequence = isVDDocument ? await getNextVDSequence(saleDate) : null;
        usedDocumentNumber = isVDDocument && usedSequence ? formatDocumentNumber(usedSequence, saleDate) : null;

        const orderData = {
          customer_id: selectedCustomer?.id || null,
          table_number: selectedTableId ? String(selectedTableId) : null,
          total: total,
          subtotal: subtotal,
          tax: tax,
          discount: totalDiscount,
          payment_method: isMultiplePayment ? 'multiple' : paymentMethod,
          received_amount: amount,
          change_amount: change,
          doc_type: docType,
          document_number: usedDocumentNumber,
          status: 'completed',
          created_at: saleTimestamp,
          // We might want to store the multiple payments in a separate table or as JSON if the schema allows
          // For now, we'll store the primary method or 'multiple'
        };

        const { data: insertedOrder, error: orderError } = await supabase
          .from('orders')
          .insert(orderData)
          .select()
          .single();

        if (!orderError) {
          order = insertedOrder;
          break;
        }

        if (!isVDDocument || !isDuplicateDocumentNumberError(orderError) || attempt === 2) {
          throw orderError;
        }
      }

      if (!order) {
        throw new Error('Não foi possível gerar um número de VD único.');
      }

      // Save order items
      const orderItems = cart.map(item => ({
        order_id: order.id,
        product_id: item.id,
        product_name: item.name,
        quantity: item.quantity,
        price: item.price,
        discount_amount: item.discount ? (item.discount.type === 'percentage' ? (item.price * item.discount.amount / 100) * item.quantity : item.discount.amount) : 0
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      // Open receipt modal for manual printing
      setCurrentReceiptNumber(usedDocumentNumber);
      setIsReceiptModalOpen(true);
      setIsSaleFinalized(true);
      if (isVDDocument && usedSequence) {
        const updatedNext = usedSequence + 1;
        setNextVDNumber(updatedNext);
        localStorage.setItem(getDocumentCounterStorageKey(getDocumentYear(saleDate)), String(updatedNext));
      }
      setIsPaymentModalOpen(false);

    } catch (error: any) {
      const err = handleSupabaseError(error, 'handleFinalizePayment');
      alert(`Erro ao salvar o pedido: ${err.message}\n\nO recibo será exibido para impressão.`);
      
      // Still allow viewing receipt even if saving fails
      setCurrentReceiptNumber(null);
      setIsReceiptModalOpen(true);
      setIsSaleFinalized(true);
      void syncNextVDNumber();
      setIsPaymentModalOpen(false);
    }
  };

  const handleSaveCustomer = async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      alert('Configuração do Supabase ausente. Verifique as variáveis de ambiente.');
      return;
    }
    if (!newCustomer.name || !newCustomer.phone) return;
    
    try {
      if (editingCustomer) {
        const { error } = await supabase
          .from('customers')
          .update({
            name: newCustomer.name,
            phone: newCustomer.phone,
            email: newCustomer.email,
            address: newCustomer.address
          })
          .eq('id', editingCustomer.id);
        
        if (error) throw error;
        setEditingCustomer(null);
      } else {
        const { error } = await supabase
          .from('customers')
          .insert({
            name: newCustomer.name,
            phone: newCustomer.phone,
            email: newCustomer.email,
            address: newCustomer.address,
            points: 0,
            created_at: new Date().toISOString()
          });
        
        if (error) throw error;
      }
      
      // Refresh customers
      const { data: customersData } = await supabase.from('customers').select('*');
      if (customersData) setCustomers(customersData as Customer[]);

      setNewCustomer({ name: '', phone: '', email: '', address: '' });
      setIsAddingCustomer(false);
      showToast('Cliente salvo com sucesso!', 'success');
    } catch (error: any) {
      handleSupabaseError(error, 'handleSaveCustomer');
      
      // Fallback for demo mode (local state only)
      if (editingCustomer) {
        setCustomers(prev => prev.map(c => c.id === editingCustomer.id ? { ...c, ...newCustomer } : c));
        setEditingCustomer(null);
      } else {
        const tempId = Math.random().toString(36).substr(2, 9);
        setCustomers(prev => [...prev, { id: tempId, ...newCustomer, points: 0 }]);
      }
      
      setNewCustomer({ name: '', phone: '', email: '', address: '' });
      setIsAddingCustomer(false);
      showToast('Cliente salvo localmente (Erro no banco de dados)', 'info');
    }
  };

  const handleDeleteCustomer = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomerToDelete(id);
  };

  const confirmDeleteCustomer = async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      alert('Configuração do Supabase ausente. Verifique as variáveis de ambiente.');
      return;
    }
    if (customerToDelete) {
      try {
        const { error } = await supabase
          .from('customers')
          .delete()
          .eq('id', customerToDelete);
        
        if (error) throw error;
        
        if (selectedCustomer?.id === customerToDelete) setSelectedCustomer(null);
        setCustomers(prev => prev.filter(c => c.id !== customerToDelete));
        setCustomerToDelete(null);
        showToast('Cliente excluído com sucesso!', 'success');
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

  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [products]);

  const productFamilies = useMemo(() => {
    return Array.from(
      new Set(
        sortedProducts
          .filter(p => p.price > 0 && p.category && p.category !== 'Category')
          .map(p => p.category)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [sortedProducts]);

  const sellableProducts = useMemo(() => {
    return sortedProducts.filter(p => p.price > 0);
  }, [sortedProducts]);

  const visibleProducts = useMemo(() => {
    return sellableProducts.filter(p => {
      const matchesCategory = !selectedCategory || p.category === selectedCategory;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [sellableProducts, selectedCategory, searchQuery]);

  if (!isLoggedIn || !isAuthRestored) {
    if (!isAuthRestored) return null; // Prevent flicker
    return (
      <LoginScreen 
        users={users.length > 0 ? users : DEFAULT_USERS}
        selectedUser={selectedLoginUser}
        onSelectUser={setSelectedLoginUser}
        password={loginPassword}
        setPassword={setLoginPassword}
        onLogin={() => {
          const userToAuth = users.length > 0 ? users : DEFAULT_USERS;
          const foundUser = userToAuth.find(u => u.id === selectedLoginUser?.id);
          
          if (foundUser && loginPassword === foundUser.password) {
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('currentUser', JSON.stringify(foundUser));
            window.dispatchEvent(new Event('pos-auth-changed'));
            setCurrentUser(foundUser);
            setIsLoggedIn(true);
            setLoginError(false);
            setLoginPassword('');
          } else {
            setLoginError(true);
            setTimeout(() => setLoginError(false), 500);
          }
        }}
        error={loginError}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#121212] text-zinc-300 font-sans selection:bg-emerald-500/30">
      {!isConfigured && (
        <div className="bg-rose-600 text-white text-[10px] font-bold py-1 px-4 text-center animate-pulse z-[9999]">
          CONFIGURAÇÃO DO SUPABASE AUSENTE OU INVÁLIDA: Adicione NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY nas Definições (Settings).
        </div>
      )}
      
      {/* --- Top Header --- */}
      <header className="flex items-center bg-[#1a1a1a] border-b border-zinc-800 px-2 py-1 gap-1 overflow-x-auto scrollbar-hide">
        <HeaderButton 
          icon={<User size={20} />} 
          label={selectedCustomer ? selectedCustomer.name : "Cliente"} 
          active={!!selectedCustomer}
          onClick={() => setIsCustomerModalOpen(true)}
        />
        <HeaderButton 
          icon={<Percent size={20} />} 
          label="Desconto" 
          onClick={() => setIsDiscountModalOpen(true)}
        />
        
        <div className="w-px h-8 bg-zinc-800 mx-1" />
        
        <HeaderButton icon={<Archive size={20} />} label="Gaveta de dinheiro" />
        <HeaderButton 
          icon={<Utensils size={20} />} 
          label={selectedTableId ? `Mesa ${selectedTableId}` : "Mesas"} 
          active={salesMode === 'table'}
          onClick={openTableModal}
        />
        <HeaderButton 
          icon={<CreditCard size={20} />} 
          label="Caixa" 
          active={isCashierModalOpen}
          onClick={() => setIsCashierModalOpen(true)}
          className={isCashierModalOpen ? 'bg-red-600/20 text-red-500 border border-red-500/30' : ''}
        />
        
        <div className="flex-grow" />
        <button 
          onClick={() => setIsAdminSidebarOpen(true)}
          className="p-2 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
          title="Configurações"
        >
          <Settings size={24} />
        </button>
      </header>

      <main className="flex flex-1 overflow-hidden">
        
        {/* --- Main Content (Products) --- */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#121212]">
          
          {/* Search Bar */}
          <div className="h-14 p-2 flex items-center gap-2 bg-[#1a1a1a] border-b border-zinc-800">
            <div className="flex items-center gap-3 px-3 text-zinc-500 border-r border-zinc-800">
              <Search size={18} />
            </div>
            <div className="flex-1 relative">
              <input 
                type="text" 
                placeholder="Pesquisar produto por nome"
                className="w-full bg-transparent py-2 px-2 outline-none text-sm placeholder:text-zinc-600"
                value={searchQuery ?? ''}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Product Grid */}
          <div className="flex-1 p-4 overflow-y-auto scrollbar-hide">
            <div
              ref={familiesScrollRef}
              className="mb-4 max-w-full overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing select-none [touch-action:pan-y]"
              onPointerDown={handleFamiliesPointerDown}
              onPointerMove={handleFamiliesPointerMove}
              onPointerUp={handleFamiliesPointerRelease}
              onPointerCancel={handleFamiliesPointerRelease}
              onLostPointerCapture={handleFamiliesPointerRelease}
              onClickCapture={(e) => {
                if (familiesDragStateRef.current.moved) {
                  e.preventDefault();
                  e.stopPropagation();
                  familiesDragStateRef.current.moved = false;
                }
              }}
            >
              <div className="flex gap-3 w-max min-w-full pr-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`shrink-0 w-[180px] md:w-[190px] lg:w-[210px] xl:w-[220px] h-14 rounded border text-sm font-semibold tracking-tight transition-all ${
                  !selectedCategory
                    ? 'border-zinc-700 bg-zinc-800/70 text-white'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-white'
                }`}
              >
                Todas
              </button>
              {productFamilies.map((family) => (
                <button
                  key={family}
                  onClick={() => setSelectedCategory(family)}
                  className={`shrink-0 w-[180px] md:w-[190px] lg:w-[210px] xl:w-[220px] h-14 rounded border text-sm font-semibold tracking-tight transition-all ${
                    selectedCategory === family
                      ? 'border-zinc-700 bg-zinc-800/70 text-white'
                      : 'border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-white'
                  }`}
                >
                  {family}
                </button>
              ))}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {visibleProducts.map((product) => (
                <motion.button
                  key={product.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => addToCart(product)}
                  className={`relative flex flex-col items-start justify-between h-28 p-4 rounded border border-zinc-800 transition-all ${product.color || 'bg-zinc-900/30'} hover:border-zinc-600 hover:bg-zinc-800/50 group text-left`}
                >
                  {product.stock_quantity !== undefined && (
                    <span className={`absolute top-1 right-1 px-1.5 py-0.5 rounded-sm text-[10px] font-bold ${product.stock_quantity > 0 ? 'bg-emerald-500/10 text-emerald-500/70' : 'bg-red-500/10 text-red-500/70'}`}>
                      {product.stock_quantity}
                    </span>
                  )}
                  <div className="pr-8">
                    <span className="block text-sm font-medium text-zinc-100 group-hover:text-white transition-colors">
                      {product.name}
                    </span>
                    <span className="block mt-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      {product.category || 'Sem familia'}
                    </span>
                  </div>
                  <span className="text-[13px] font-mono text-zinc-500 group-hover:text-emerald-400 transition-colors">
                    {formatPrice(product.price)}
                  </span>
                </motion.button>
              ))}
            </div>

            {visibleProducts.length === 0 && (
              <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
                Nenhum item encontrado
              </div>
            )}
          </div>

          {/* Pagination Footer */}
          <footer className="p-2 bg-[#1a1a1a] border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
            <div>Página 1 / 1</div>
            <div className="flex items-center gap-1">
              <PaginationButton icon={<Home size={14} />} />
              <PaginationButton icon={<ChevronsLeft size={14} />} />
              <PaginationButton icon={<ChevronLeft size={14} />} />
              <PaginationButton icon={<ChevronRight size={14} />} />
              <PaginationButton icon={<ChevronsRight size={14} />} />
            </div>
          </footer>
        </div>

        {/* --- Right Sidebar (Cart) --- */}
        <div className="w-[350px] flex flex-col border-l border-zinc-800 bg-[#151515]">
          <div className="h-14 p-2 border-b border-zinc-800 flex items-center gap-2 bg-[#1a1a1a]">
            <button 
              onClick={() => selectedCartItemId && removeFromCart(selectedCartItemId)}
              disabled={!selectedCartItemId}
              className={`w-12 h-10 flex flex-col items-center justify-center rounded transition-colors ${
                selectedCartItemId 
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-red-400' 
                  : 'bg-zinc-800 text-zinc-700 cursor-not-allowed opacity-50'
              }`}
              title="Deletar item selecionado"
            >
              <Trash2 size={14} />
              <span className="text-[8px] capitalize font-bold mt-0.5">Del</span>
            </button>
            
            <div className="flex-[2] flex items-center bg-zinc-800 rounded h-10 relative overflow-hidden">
              <button 
                onClick={() => {
                  const types: ('VD' | 'TK' | 'FP')[] = ['VD', 'TK', 'FP'];
                  const nextIndex = (types.indexOf(docType) + 1) % types.length;
                  setDocType(types[nextIndex]);
                }}
                className="h-full px-3 bg-emerald-600 text-white font-bold text-xs flex items-center justify-center min-w-[45px] hover:bg-emerald-500 transition-colors border-r border-zinc-700/50"
                title="Tipo de Documento"
              >
                {docType}
              </button>
              
              <div className="flex-1 flex items-center px-3 h-full">
                {selectedCustomer ? (
                  <div className="flex items-center gap-2 w-full overflow-hidden">
                    <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white flex-shrink-0">
                      <User size={12} />
                    </div>
                    <span className="text-xs text-emerald-400 font-bold truncate">{selectedCustomer.name}</span>
                    <button 
                      onClick={() => setSelectedCustomer(null)}
                      className="ml-auto text-zinc-500 hover:text-rose-500 transition-colors"
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <input 
                      type="text" 
                      value={customerName ?? ''}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="bg-transparent w-full outline-none text-xs text-zinc-200 placeholder:text-zinc-600" 
                      placeholder="Nome do cliente..." 
                    />
                    {customerName.length > 0 && (
                      <div className="absolute top-full left-0 w-full mt-1 bg-zinc-900 border border-zinc-800 rounded shadow-2xl z-50 overflow-hidden py-1">
                        {customers
                          .filter(c => c.name.toLowerCase().includes(customerName.toLowerCase()))
                          .slice(0, 3)
                          .map(c => (
                            <button
                              key={c.id}
                              onClick={() => {
                                setSelectedCustomer(c);
                                setCustomerName('');
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-zinc-800 flex items-center gap-2 transition-colors"
                            >
                              <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                                <User size={10} />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[11px] text-white font-bold leading-none">{c.name}</span>
                                <span className="text-[9px] text-zinc-500">{c.phone}</span>
                              </div>
                            </button>
                          ))}
                        
                        {!customers.some(c => c.name.toLowerCase() === customerName.toLowerCase()) && (
                          <button
                            onClick={() => {
                              setNewCustomer({ ...newCustomer, name: customerName });
                              setIsAddingCustomer(true);
                              setIsCustomerModalOpen(true);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-emerald-500/10 text-emerald-500 flex items-center gap-2 transition-colors border-t border-zinc-800/50 mt-1"
                          >
                            <Plus size={12} />
                            <span className="text-[10px] font-bold capitalize tracking-tight">Cadastrar &quot;{customerName}&quot;</span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            
            <div className="w-20 flex items-center px-2 bg-zinc-800 rounded h-10">
              <span className="text-[10px] text-zinc-500 mr-1 capitalize font-bold whitespace-nowrap">Mesa</span>
              <input 
                type="text" 
                value={tableNumber ?? ''}
                onChange={(e) => setTableNumber(e.target.value)}
                className="bg-transparent w-full text-center outline-none text-xs text-zinc-200 placeholder:text-zinc-600 font-mono" 
                placeholder="00" 
              />
            </div>
          </div>

          <div 
            className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-hide"
            onClick={() => setSelectedCartItemId(null)}
          >
            {cart.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-600 text-sm italic">
                Sem itens
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {cart.map((item) => (
                  <motion.div 
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCartItemId(prev => prev === item.id ? null : item.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingItem(item);
                      setTempQuantity(item.quantity.toString());
                      setIsQuantityModalOpen(true);
                    }}
                    className={`flex justify-between items-center p-3 border rounded transition-colors group cursor-pointer ${
                      selectedCartItemId === item.id 
                        ? 'bg-emerald-500/20 border-emerald-500/50' 
                        : 'bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-zinc-200">{item.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">{item.quantity} x {formatPrice(item.price)}</span>
                        {item.discount && (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded-md font-bold">
                            -{item.discount.type === 'percentage' ? `${item.discount.amount}%` : formatPrice(item.discount.amount)}
                          </span>
                        )}
                        {globalDiscount && (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded-md font-bold">
                            Global: -{globalDiscount.type === 'percentage' ? `${globalDiscount.amount}%` : formatPrice(globalDiscount.amount / cart.length)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-zinc-100">{formatPrice(item.price * item.quantity)}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromCart(item.id);
                        }} 
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>

          <div className="p-3 bg-[#1a1a1a] border-t border-zinc-800 space-y-0.5">
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Subtotal</span>
              <span>{formatPrice(originalSubtotal)}</span>
            </div>
            {totalDiscount > 0 && (
              <div className="flex justify-between text-xs text-emerald-500">
                <span>Desconto</span>
                <span>-{formatPrice(totalDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Imposto</span>
              <span>{formatPrice(tax)}</span>
            </div>
            <div className="pt-1.5 mt-1.5 border-t border-dashed border-zinc-700 flex justify-between items-end">
              <span className="text-xs font-bold uppercase tracking-wider">TOTAL</span>
              <span className="text-2xl font-bold text-white">{formatPrice(total)}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-900">
            <button 
              onClick={() => {
                if (cart.length === 0) {
                  showToast('Não existe nada no carrinho de compra', 'error');
                } else {
                  setIsCancelModalOpen(true);
                }
              }}
              className="flex flex-col items-center justify-center py-3 bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
            >
              <Trash2 size={18} />
              <span className="text-[10px] mt-1 capitalize font-bold">Cancelar pedido</span>
            </button>
            <button 
              onClick={() => cart.length > 0 && setIsPaymentModalOpen(true)}
              disabled={cart.length === 0}
              className={`flex flex-col items-center justify-center py-3 rounded transition-colors ${
                cart.length > 0 
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' 
                  : 'bg-zinc-800 text-zinc-700 cursor-not-allowed opacity-50'
              }`}
            >
              <Banknote size={18} />
              <span className="text-[10px] mt-1 capitalize font-bold">Pagamento</span>
            </button>
            <button 
              onClick={() => cart.length > 0 && setIsReceiptModalOpen(true)}
              disabled={cart.length === 0}
              className={`flex flex-col items-center justify-center py-3 rounded transition-colors ${
                cart.length > 0 
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' 
                  : 'bg-zinc-800 text-zinc-700 cursor-not-allowed opacity-50'
              }`}
            >
              <Printer size={18} />
              <span className="text-[10px] mt-1 capitalize font-bold">CONTA</span>
            </button>
          </div>
        </div>
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

      {/* --- Customer Modal --- */}
      <AnimatePresence>
        {isCustomerModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setIsCustomerModalOpen(false)}>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                    <User size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-tight">
                      {isAddingCustomer ? (editingCustomer ? 'Editar Cliente' : 'Novo Cliente') : 'Gestão de Clientes'}
                    </h2>
                    <p className="text-xs text-zinc-500 font-medium capitalize">
                      {isAddingCustomer ? 'Preencha os dados abaixo' : 'Selecionar ou cadastrar cliente'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsCustomerModalOpen(false)}
                  className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
                >
                  <RotateCcw size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {isAddingCustomer ? (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-500 capitalize ml-1">Nome Completo *</label>
                        <input 
                          type="text"
                          value={newCustomer.name ?? ''}
                          onChange={(e) => setNewCustomer({...newCustomer, name: e.target.value})}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded px-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Ex: João Silva"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-500 capitalize ml-1">Telefone *</label>
                        <input 
                          type="text"
                          value={newCustomer.phone ?? ''}
                          onChange={(e) => setNewCustomer({...newCustomer, phone: e.target.value})}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded px-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Ex: 841234567"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-500 capitalize ml-1">E-mail</label>
                        <input 
                          type="email"
                          value={newCustomer.email ?? ''}
                          onChange={(e) => setNewCustomer({...newCustomer, email: e.target.value})}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded px-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="joao@email.com"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-500 capitalize ml-1">Endereço</label>
                        <input 
                          type="text"
                          value={newCustomer.address ?? ''}
                          onChange={(e) => setNewCustomer({...newCustomer, address: e.target.value})}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded px-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Rua, Bairro, Cidade"
                        />
                      </div>
                    </div>
                    <div className="flex gap-3 pt-4">
                      <button 
                        onClick={() => setIsAddingCustomer(false)}
                        className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-all"
                      >
                        Voltar para Lista
                      </button>
                      <button 
                        onClick={handleSaveCustomer}
                        disabled={!newCustomer.name || !newCustomer.phone}
                        className={`flex-1 h-12 rounded font-bold transition-all ${
                          newCustomer.name && newCustomer.phone
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                            : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                        }`}
                      >
                        {editingCustomer ? 'Atualizar Cliente' : 'Salvar Cliente'}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex gap-3">
                      <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                        <input 
                          type="text"
                          value={customerSearch ?? ''}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded pl-12 pr-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Pesquisar por nome ou telefone..."
                        />
                      </div>
                      <button 
                        onClick={() => {
                          setEditingCustomer(null);
                          setNewCustomer({ name: '', phone: '', email: '', address: '' });
                          setIsAddingCustomer(true);
                        }}
                        className="h-12 px-6 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition-all flex items-center gap-2"
                      >
                        <Plus size={20} />
                        Novo
                      </button>
                    </div>

                    <div className="space-y-2">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map(customer => (
                          <div
                            key={customer.id}
                            onClick={() => {
                              setSelectedCustomer(customer);
                              setIsCustomerModalOpen(false);
                            }}
                            className={`w-full p-4 rounded border transition-all flex items-center justify-between group cursor-pointer ${
                              selectedCustomer?.id === customer.id
                                ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                                : 'bg-zinc-800/50 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                            }`}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                                selectedCustomer?.id === customer.id ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500 group-hover:bg-zinc-700'
                              }`}>
                                <User size={24} />
                              </div>
                              <div className="text-left">
                                <h3 className="font-bold text-white leading-tight">{customer.name}</h3>
                                <p className="text-xs text-zinc-500">{customer.phone}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-xs font-medium text-zinc-500 capitalize">Pontos</div>
                                <div className="text-sm font-mono font-bold text-emerald-500">{customer.points} pts</div>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={(e) => startEditingCustomer(customer, e)}
                                  className="p-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button 
                                  onClick={(e) => handleDeleteCustomer(customer.id, e)}
                                  className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-12 text-center">
                          <User className="mx-auto text-zinc-700 mb-3" size={48} />
                          <p className="text-zinc-500 font-bold">Nenhum cliente encontrado</p>
                          <p className="text-xs text-zinc-600">Tente outro termo ou cadastre um novo cliente</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>

              {selectedCustomer && !isAddingCustomer && (
                <div className="p-4 bg-zinc-800/30 border-t border-zinc-800 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-medium text-zinc-500 capitalize">Selecionado:</div>
                    <div className="text-sm font-bold text-white">{selectedCustomer.name}</div>
                  </div>
                  <button 
                    onClick={() => setSelectedCustomer(null)}
                    className="text-xs font-bold text-rose-500 hover:text-rose-400 transition-colors"
                  >
                    Remover Seleção
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                  <span className="text-xs font-medium text-zinc-500 capitalize">Tipo de Desconto</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setDiscountType('percentage')}
                      className={`py-3 rounded border-2 transition-all font-medium ${
                        discountType === 'percentage' 
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      Porcentagem (%)
                    </button>
                    <button 
                      onClick={() => setDiscountType('value')}
                      className={`py-3 rounded border-2 transition-all font-medium ${
                        discountType === 'value' 
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      Valor (MT)
                    </button>
                  </div>
                </div>

                {/* Discount Target */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-zinc-500 capitalize">Aplicar em</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setDiscountTarget('all')}
                      className={`py-3 rounded border-2 transition-all font-medium ${
                        discountTarget === 'all' 
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      Todos os Itens
                    </button>
                    <button 
                      onClick={() => setDiscountTarget('selected')}
                      disabled={!selectedCartItemId}
                      className={`py-3 rounded border-2 transition-all font-medium ${
                        discountTarget === 'selected' 
                          ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                          : !selectedCartItemId 
                            ? 'bg-zinc-900/50 border-zinc-800/50 text-zinc-700 cursor-not-allowed'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      Item Selecionado
                    </button>
                  </div>
                  {!selectedCartItemId && discountTarget === 'selected' && (
                    <p className="text-[10px] text-red-400 italic">Selecione um item no carrinho primeiro</p>
                  )}
                </div>

                {/* Discount Amount */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-zinc-500 capitalize">Valor do Desconto</span>
                  <div className="relative">
                    <input 
                      type="number"
                      step="any"
                      value={discountAmount ?? ''}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-zinc-950 border border-zinc-700 rounded py-3 px-4 text-right text-emerald-400 font-mono font-bold outline-none focus:border-emerald-500 transition-colors"
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
                    <span className="text-xs font-medium text-zinc-500 capitalize">Resumo do Desconto</span>
                    <span className="text-[10px] font-bold text-emerald-500 capitalize px-2 py-0.5 bg-emerald-500/10 rounded-full">Preview</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Alvo:</span>
                      <span className="text-zinc-200 font-bold">{previewDiscount.name}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Valor Atual:</span>
                      <span className="text-zinc-200 font-mono">{formatPrice(previewDiscount.current)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Desconto:</span>
                      <span className="text-emerald-500 font-mono">-{formatPrice(previewDiscount.discount)}</span>
                    </div>
                    <div className="pt-2 mt-2 border-t border-zinc-800 flex justify-between items-center">
                      <span className="text-xs font-medium text-white capitalize">Novo Total:</span>
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
                  className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-medium transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={applyDiscount}
                  disabled={!discountAmount || (discountTarget === 'selected' && !selectedCartItemId)}
                  className={`flex-1 h-12 rounded font-medium transition-all ${
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
      <AnimatePresence>
        {isPaymentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => setIsPaymentModalOpen(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-[450px] overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
                <h3 className="text-xl font-bold text-white capitalize tracking-tight">Finalizar Pagamento</h3>
                <div className="flex gap-4 mt-2 text-xs text-zinc-500 font-medium">
                  <span className="flex items-center gap-1">
                    <User size={12} /> 
                    {selectedCustomer ? selectedCustomer.name : (customerName || 'Consumidor Final')}
                  </span>
                  <span className="flex items-center gap-1"><Monitor size={12} /> Mesa: {tableNumber || 'N/A'}</span>
                </div>
              </div>

              {/* Order Summary */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <div className="space-y-2">
                  <span className="text-xs font-medium text-zinc-500 capitalize">Resumo do Pedido</span>
                  <div className="space-y-2">
                    {cart.map(item => (
                      <div key={item.id} className="flex flex-col">
                        <div className="flex justify-between text-sm">
                          <span className="text-zinc-400">{item.quantity}x {item.name}</span>
                          <span className="font-mono text-zinc-200">{formatPrice(item.price * item.quantity)}</span>
                        </div>
                        {item.discount && (
                          <div className="flex justify-between text-[10px] text-emerald-500 italic">
                            <span>Desconto ({item.discount.type === 'percentage' ? `${item.discount.amount}%` : formatPrice(item.discount.amount)})</span>
                            <span>-{formatPrice(item.discount.type === 'percentage' ? (item.price * item.discount.amount / 100) * item.quantity : item.discount.amount)}</span>
                          </div>
                        )}
                      </div>
                    ))}
                    {globalDiscount && (
                      <div className="flex justify-between text-[10px] text-emerald-500 italic pt-1 border-t border-zinc-800/50">
                        <span>Desconto Global ({globalDiscount.type === 'percentage' ? `${globalDiscount.amount}%` : formatPrice(globalDiscount.amount)})</span>
                        <span>-{formatPrice(globalDiscount.type === 'percentage' ? (originalTotal * globalDiscount.amount / 100) : globalDiscount.amount)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-800 space-y-0.5">
                  <div className="flex justify-between text-sm text-zinc-500">
                    <span>Subtotal (Base)</span>
                    <span className="font-mono">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-zinc-500">
                    <span>IVA (17% Incluso)</span>
                    <span className="font-mono">{formatPrice(tax)}</span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between text-sm text-emerald-500">
                      <span>Desconto</span>
                      <span className="font-mono">-{formatPrice(totalDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xl font-bold text-white pt-1">
                    <span>Total</span>
                    <span className="font-mono text-emerald-400">{formatPrice(total)}</span>
                  </div>
                </div>

                {/* Payment Methods */}
                <div className="pt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-zinc-500 capitalize">Método de Pagamento</span>
                    <button 
                      onClick={() => {
                        setIsMultiplePayment(!isMultiplePayment);
                        setPayments([]);
                        setPaymentMethod(null);
                        setReceivedAmount('');
                      }}
                      className={`text-[10px] font-bold px-2 py-1 rounded transition-all ${
                        isMultiplePayment ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Múltiplos Pagamentos
                    </button>
                  </div>

                  {!isMultiplePayment ? (
                    <div className="grid grid-cols-3 gap-2">
                      <PaymentMethodButton 
                        active={paymentMethod === 'cash'} 
                        onClick={() => {
                          setPaymentMethod('cash');
                          setReceivedAmount('');
                        }}
                        icon={<Banknote size={20} />}
                        label="Dinheiro"
                      />
                      <PaymentMethodButton 
                        active={paymentMethod === 'card'} 
                        onClick={() => {
                          setPaymentMethod('card');
                          setReceivedAmount('');
                        }}
                        icon={<CreditCard size={20} />}
                        label="Cartão"
                      />
                      <PaymentMethodButton 
                        active={paymentMethod === 'pix'} 
                        onClick={() => {
                          setPaymentMethod('pix');
                          setReceivedAmount('');
                        }}
                        icon={<Smartphone size={20} />}
                        label="PIX"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3 bg-zinc-900/50 border border-zinc-800 rounded p-3">
                      <div className="grid grid-cols-3 gap-2">
                        <button 
                          onClick={() => setMultiplePaymentMethod('cash')}
                          className={`h-10 rounded flex items-center justify-center gap-2 text-xs font-bold transition-all ${
                            multiplePaymentMethod === 'cash' ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          <Banknote size={14} /> Dinheiro
                        </button>
                        <button 
                          onClick={() => setMultiplePaymentMethod('card')}
                          className={`h-10 rounded flex items-center justify-center gap-2 text-xs font-bold transition-all ${
                            multiplePaymentMethod === 'card' ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          <CreditCard size={14} /> Cartão
                        </button>
                        <button 
                          onClick={() => setMultiplePaymentMethod('pix')}
                          className={`h-10 rounded flex items-center justify-center gap-2 text-xs font-bold transition-all ${
                            multiplePaymentMethod === 'pix' ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          <Smartphone size={14} /> PIX
                        </button>
                      </div>
                      
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input 
                            type="number"
                            value={multiplePaymentAmount}
                            onChange={(e) => setMultiplePaymentAmount(e.target.value)}
                            placeholder="Valor"
                            className="w-full bg-zinc-950 border border-zinc-700 rounded h-10 px-3 text-sm text-emerald-400 font-mono outline-none focus:border-emerald-500"
                          />
                        </div>
                        <button 
                          onClick={() => {
                            const amt = parseFloat(multiplePaymentAmount);
                            if (amt > 0) {
                              setPayments(prev => [...prev, { method: multiplePaymentMethod, amount: amt }]);
                              setMultiplePaymentAmount('');
                            }
                          }}
                          className="px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-xs"
                        >
                          Adicionar
                        </button>
                      </div>

                      {payments.length > 0 && (
                        <div className="space-y-1 pt-2 border-t border-zinc-800">
                          {payments.map((p, i) => (
                            <div key={i} className="flex justify-between items-center text-xs">
                              <span className="text-zinc-400 capitalize">{p.method === 'cash' ? 'Dinheiro' : p.method === 'card' ? 'Cartão' : 'PIX'}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-white font-mono">{formatPrice(p.amount)}</span>
                                <button 
                                  onClick={() => setPayments(prev => prev.filter((_, idx) => idx !== i))}
                                  className="text-rose-500 hover:text-rose-400"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-between items-center pt-1 mt-1 border-t border-zinc-800 font-bold">
                            <span className="text-zinc-500">Total Pago:</span>
                            <span className="text-emerald-400 font-mono">{formatPrice(payments.reduce((acc, p) => acc + p.amount, 0))}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cash Input & Change Calculation */}
                  <AnimatePresence>
                    {(!isMultiplePayment && paymentMethod === 'cash') && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden space-y-4 pt-2"
                      >
                        <div className="bg-zinc-900/80 border border-zinc-800 rounded p-4 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-zinc-400 uppercase">Valor Recebido</span>
                            <div className="relative">
                              <input 
                                type="number"
                                step="any"
                                value={receivedAmount ?? ''}
                                onChange={(e) => setReceivedAmount(e.target.value)}
                                placeholder="0.00"
                                className="w-40 bg-zinc-950 border border-zinc-700 rounded py-2 pl-3 pr-10 text-right text-emerald-400 font-mono font-bold outline-none focus:border-emerald-500 transition-colors"
                                autoFocus
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs pointer-events-none ml-1">MT</span>
                            </div>
                          </div>
                          
                          <div className="flex justify-between items-center pt-2 border-t border-zinc-800/50">
                            <span className="text-xs font-medium text-zinc-400 uppercase">Troco</span>
                            <span className={`text-xl font-bold font-mono ${
                              (receivedAmount === '' || parseFloat(receivedAmount) >= total) ? 'text-white' : 'text-red-500'
                            }`}>
                              {receivedAmount === '' ? formatPrice(0) : formatPrice(Math.max(0, parseFloat(receivedAmount) - total))}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                    {(isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) > total) && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden pt-2"
                      >
                        <div className="bg-zinc-900/80 border border-zinc-800 rounded p-4 flex justify-between items-center">
                          <span className="text-xs font-medium text-zinc-400 uppercase">Troco</span>
                          <span className="text-xl font-bold font-mono text-white">
                            {formatPrice(payments.reduce((acc, p) => acc + p.amount, 0) - total)}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-zinc-900/50 border-t border-zinc-800 flex gap-3">
                <button 
                  onClick={() => {
                    setIsPaymentModalOpen(false);
                    setPaymentMethod(null);
                    setReceivedAmount('');
                    setPayments([]);
                    setIsMultiplePayment(false);
                  }}
                  className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-medium transition-all"
                >
                  Voltar
                </button>
                <button 
                  onClick={handleFinalizePayment}
                  disabled={
                    (!isMultiplePayment && (!paymentMethod || (paymentMethod === 'cash' && receivedAmount !== '' && parseFloat(receivedAmount) < total))) ||
                    (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) < total)
                  }
                  className={`flex-1 h-12 rounded font-bold transition-all flex items-center justify-center gap-2 ${
                    (!isMultiplePayment && paymentMethod && (paymentMethod !== 'cash' || receivedAmount === '' || parseFloat(receivedAmount) >= total)) ||
                    (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) >= total)
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  <Lock size={16} />
                  Finalizar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Receipt Modal (Bill Preview) --- */}
      <AnimatePresence>
        {isReceiptModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white text-black rounded-sm w-full max-w-[380px] overflow-hidden flex flex-col max-h-[90vh] font-mono"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Receipt Content */}
              <div id="receipt-print-area" className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="text-center space-y-1">
                  <h1 className="text-3xl font-bold tracking-tighter mb-2">Your Logo</h1>
                  <p className="text-[11px] font-bold">Av. da Marginal - Maputo</p>
                  <p className="text-[11px] font-bold">Tel: +258 87 2002 144</p>
                  <p className="text-[11px] font-bold">NUIT: 401 000 000</p>
                  <p className="text-[11px] font-bold mt-2">Cliente: {selectedCustomer ? selectedCustomer.name : 'Consumidor Final'}</p>
                </div>

                <div className="border-t border-dashed border-black pt-2">
                  <div className="flex justify-between text-[10px] font-bold">
                    <span>Data: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</span>
                    <span>Atendido por: {currentUser?.name || 'Admin'}</span>
                  </div>
                  <div className="text-[12px] font-bold mt-1">
                    {isSaleFinalized ? docType : 'Cons. Doc'} nº: {currentReceiptNumber || formatDocumentNumber(nextVDNumber)}
                  </div>
                </div>

                <div className="border-y border-dashed border-black py-2">
                  <div className="flex justify-between text-[10px] font-bold mb-1">
                    <span className="w-8">Qt</span>
                    <span className="flex-1 px-2">Descrição</span>
                    <span className="w-16 text-right">P.Unit</span>
                    <span className="w-20 text-right">Valor</span>
                  </div>
                  <div className="space-y-0.5">
                    {cart.map(item => (
                      <div key={item.id} className="flex justify-between text-[10px] font-bold">
                        <span className="w-8">{item.quantity.toFixed(2)}</span>
                        <span className="flex-1 px-2 truncate">{item.name}</span>
                        <span className="w-16 text-right">{item.price.toFixed(2)}MT</span>
                        <span className="w-20 text-right">{(item.price * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1 text-[11px] font-bold">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IVA (16%):</span>
                    <span>{tax.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                  </div>
                  <div className="flex justify-between text-2xl font-bold border-t border-dashed border-black pt-2 mt-2">
                    <span>Total:</span>
                    <span>{total.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                  </div>
                </div>

                {isSaleFinalized && (
                  <div className="border-t border-dashed border-black pt-2 space-y-1">
                    <div className="flex justify-between text-[10px] font-bold">
                      <span>Metodo de Pagamento</span>
                      <span>Valor</span>
                    </div>
                    <div className="border-t border-dashed border-black pt-1 space-y-0.5">
                      {!isMultiplePayment ? (
                        <div className="flex justify-between text-[10px] font-bold">
                          <span className="capitalize">{paymentMethod === 'cash' ? 'Dinheiro' : paymentMethod === 'card' ? 'Cartao' : 'M-Pesa'}</span>
                          <span>{total.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                        </div>
                      ) : (
                        payments.map((p, i) => (
                          <div key={i} className="flex justify-between text-[10px] font-bold">
                            <span className="capitalize">{p.method === 'cash' ? 'Dinheiro' : p.method === 'card' ? 'Cartao' : 'M-Pesa'}</span>
                            <span>{p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                          </div>
                        ))
                      )}
                    </div>
                    
                    {/* Display Change (Troco) */}
                    {((!isMultiplePayment && paymentMethod === 'cash' && receivedAmount !== '') || (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) > total)) && (
                      <div className="flex justify-between text-[11px] font-bold border-t border-dashed border-black pt-1 mt-1">
                        <span>Troco:</span>
                        <span>
                          {(!isMultiplePayment 
                            ? (parseFloat(receivedAmount) - total) 
                            : (payments.reduce((acc, p) => acc + p.amount, 0) - total)
                          ).toLocaleString('en-US', { minimumFractionDigits: 2 })}MT
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="text-center pt-4 border-t border-dashed border-black space-y-1">
                  <p className="text-[11px] font-bold">IVA Incluso</p>
                  <p className="text-[11px] font-bold">Processada por Computador</p>
                  <p className="text-[11px] font-bold">Obrigado pela preferência!</p>
                  <p className="text-[10px] font-bold italic">Formato otimizado para impressora tÃ©rmica de 80mm</p>
                  <p className="text-[10px] font-bold italic mt-2">Sistema desenvolvido por: Nicolau Nino</p>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-zinc-100 border-t border-zinc-200 flex gap-3 font-sans no-print">
                <button 
                  onClick={() => {
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
                  }}
                  className="flex-1 h-12 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded font-bold transition-all"
                >
                  {isSaleFinalized ? 'Nova Venda' : 'Fechar'}
                </button>
                <button 
                  onClick={() => {
                    const printMarkup = buildPrintReceiptMarkup();
                    const estimatedHeightMm = Math.max(120, 82 + (cart.length * 8) + (isSaleFinalized ? (payments.length > 0 ? payments.length * 6 : 12) + 22 : 0));
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
                  }}
                  className="flex-1 h-12 bg-zinc-900 hover:bg-zinc-800 text-white rounded font-bold transition-all flex items-center justify-center gap-2"
                >
                  <Printer size={18} />
                  Imprimir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Delete Confirmation Modal --- */}
      <AnimatePresence>
        {customerToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded p-8 w-full max-w-[400px] text-center space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-20 h-20 bg-rose-500/10 rounded flex items-center justify-center mx-auto text-rose-500">
                <Trash2 size={40} />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white capitalize tracking-tight">Excluir Cliente?</h3>
                <p className="text-sm text-zinc-500">
                  Esta ação não pode ser desfeita. Todos os dados e pontos deste cliente serão removidos permanentemente.
                </p>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setCustomerToDelete(null)}
                  className="flex-1 h-14 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmDeleteCustomer}
                  className="flex-1 h-14 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold transition-all"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

      {/* --- Admin Sidebar --- */}
      <AnimatePresence>
        {isAdminSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdminSidebarOpen(false)}
              className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 z-[90] w-full max-w-[320px] bg-[#1a1a1a] border-l border-zinc-800 flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sidebar Header */}
              <div className="p-6 flex items-center justify-between border-b border-zinc-800/50">
                <h2 className="text-xl font-bold text-white tracking-tight">{currentUser?.name || 'POS - Admin'}</h2>
                <button 
                  onClick={() => setIsAdminSidebarOpen(false)}
                  className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors"
                >
                  <ArrowRight size={20} />
                </button>
              </div>

              {/* Sidebar Content */}
              <div className="flex-1 overflow-y-auto py-4 scrollbar-hide">
                {/* Main Menu Items */}
                <div className="px-2 space-y-1">
                  <SidebarItem 
                    icon={<Wrench size={18} />} 
                    label="Gerenciamento" 
                    onClick={() => router.push('/management')}
                  />
                  <div className="h-px bg-zinc-800/50 mx-4 my-2" />
                  <SidebarItem icon={<History size={18} />} label="Ver histórico de vendas" />
                  <SidebarItem icon={<Layers size={18} />} label="Ver vendas abertas" />
                  <SidebarItem icon={<Download size={18} />} label="Entrada / Saída de Dinheiro" />
                  <SidebarItem icon={<FileText size={18} />} label="Credit payments" />
                  <SidebarItem icon={<Activity size={18} />} label="Fim do dia" />
                </div>

                <div className="px-6 mt-6 mb-2">
                  <span className="text-xs font-medium capitalize text-zinc-600">Usuário</span>
                  <div className="h-px bg-zinc-800/50 flex-1 ml-2 inline-block align-middle w-24" />
                </div>

                <div className="px-2 space-y-1">
                  <SidebarItem icon={<UserCircle size={18} />} label="Info do Usuário" />
                  <SidebarItem 
                    icon={<LogOut size={18} />} 
                    label="Logout" 
                    onClick={() => {
                      localStorage.setItem('isLoggedIn', 'false');
                      localStorage.removeItem('currentUser');
                      window.dispatchEvent(new Event('pos-auth-changed'));
                      setIsLoggedIn(false);
                      setCurrentUser(null);
                      setIsAdminSidebarOpen(false);
                    }}
                  />
                </div>

                <div className="h-px bg-zinc-800/50 mx-6 my-4" />

                <div className="px-2">
                  <SidebarItem icon={<MessageSquare size={18} />} label="Comentários" />
                </div>

                {/* Date Display */}
                <div className="mt-8 text-center">
                  <span className="text-xl font-bold text-zinc-700 tracking-tighter">{currentDate}</span>
                </div>
              </div>

              {/* Sidebar Footer */}
              <div className="p-4 grid grid-cols-3 gap-2 border-t border-zinc-800/50">
                <button className="flex items-center justify-center p-3 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-all">
                  <Sliders size={20} />
                </button>
                <button className="flex items-center justify-center p-3 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-all">
                  <Maximize size={20} />
                </button>
                <button className="flex items-center justify-center p-3 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-all">
                  <Power size={20} />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Table Selection Modal */}
      <AnimatePresence>
        {isTableModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
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
                  <h2 className="text-xl font-bold text-white capitalize tracking-tight">Seleção de Mesa</h2>
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
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 w-full max-w-4xl rounded border border-zinc-800 overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-white capitalize tracking-tight">Operações de Caixa: Caixa 1</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-colors">
                    <HelpCircle size={20} />
                  </button>
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
                <div className="w-48 p-4 border-r border-zinc-800 flex flex-col gap-2 bg-zinc-900/30">
                  <button 
                    className={`h-16 rounded font-bold text-base leading-tight capitalize transition-all ${isCashierOpen ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-700 hover:bg-red-600'} text-white`}
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
                    className={`h-16 rounded font-bold text-base leading-tight capitalize transition-all ${isSessionOpen ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'} text-white`}
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
                      className={`h-16 rounded font-bold text-base leading-tight capitalize transition-all ${isSessionOpen ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}
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
                      className={`h-16 rounded font-bold text-base leading-tight capitalize transition-all ${isCashierOpen ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}
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
                <div className="flex-1 p-6 flex flex-col gap-8">
                  {/* Documento de Caixa Section */}
                  <section>
                    <div className="flex items-center gap-4 mb-4">
                      <h3 className="text-sm md:text-base font-bold text-zinc-400 capitalize tracking-[0.2em] whitespace-nowrap">Documento de caixa</h3>
                      <div className="h-px w-full bg-zinc-800" />
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {['Vale', 'Saída Caixa', 'Entrada Caixa', 'Vale liquidação', 'Saída de fundo de maneio', 'Entrada de fundo de maneio', 'Recibo de adiantamento'].map((doc) => (
                        <button 
                          key={doc}
                          className="h-16 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold text-sm md:text-base leading-tight capitalize transition-all border border-zinc-700/50 flex items-center justify-center text-center px-3"
                        >
                          {doc}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Relatórios de Caixa Section */}
                  <section>
                    <div className="flex items-center gap-4 mb-4">
                      <h3 className="text-sm md:text-base font-bold text-zinc-400 capitalize tracking-[0.2em] whitespace-nowrap">Relatórios de caixa</h3>
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
                          className="h-16 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold text-sm md:text-base leading-tight capitalize transition-all border border-zinc-700/50 flex items-center justify-center text-center px-3"
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
                  className="flex-1 h-14 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-sm md:text-base capitalize transition-all flex flex-col items-center justify-center"
                  onClick={() => showToast("Dia fechado com sucesso", "success")}
                >
                  <span className="text-[10px] md:text-xs">Fechar dia:</span>
                  <span className="text-xs md:text-sm leading-tight">{new Date().toLocaleDateString('pt-PT', { weekday: 'long' })}</span>
                  <span className="text-xs md:text-sm leading-tight">{new Date().toISOString().split('T')[0]}</span>
                </button>
                <button 
                  className="flex-1 h-14 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-sm md:text-base leading-tight capitalize transition-all"
                >
                  Registar relógio de ponto
                </button>
                <button 
                  className="flex-1 h-14 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-sm md:text-base leading-tight capitalize transition-all"
                >
                  Transferir vendas ativas
                </button>
                <button 
                  className="flex-1 h-14 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-sm md:text-base leading-tight capitalize transition-all"
                >
                  Transferência de turno
                </button>
              </div>

              {/* Footer Inputs */}
              <div className="p-4 bg-zinc-900/50 border-t border-zinc-800 grid grid-cols-3 gap-6">
                <div className="flex flex-col gap-1">
                  <label className="text-xs md:text-sm font-bold text-zinc-500 capitalize">Impressora</label>
                  <select 
                    value={cashierPrinter}
                    onChange={(e) => setCashierPrinter(e.target.value)}
                    className="h-10 bg-zinc-800 border border-zinc-700 rounded px-3 text-base text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="Impressora do evento">Impressora do evento</option>
                    <option value="Impressora térmica">Impressora térmica</option>
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
      className={`flex flex-col items-center justify-center min-w-[80px] py-2 px-2 rounded transition-all hover:bg-zinc-800 group ${active ? 'bg-zinc-800 text-white' : 'text-zinc-400'} ${className}`}
    >
      <div className="mb-1 group-hover:scale-110 transition-transform">{icon}</div>
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
