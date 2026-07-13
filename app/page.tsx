'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef, use } from 'react';
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
import { getPosApiBase } from '@/lib/apiBase';
import type {
  CartItem,
  CompanyProfile,
  Customer,
  PaymentEntry,
  PaymentMethod,
  PaymentMethodOption,
  Product,
  User as PosUser,
} from '@/app/pos/types';
import { Header } from '@/app/pos/components/Header';
import { ProductList } from '@/app/pos/components/ProductList';
import { Cart } from '@/app/pos/components/Cart';
import { PaymentModal } from '@/app/pos/components/PaymentModal';
import { CustomerModal } from '@/app/pos/components/CustomerModal';
import { ReceiptPreview } from '@/app/pos/components/ReceiptPreview';
import { AdminPanel } from '@/app/pos/components/AdminPanel';
import { ConfirmDialog, quitPoslyApp } from '@/app/pos/components/ConfirmDialog';
import { EndOfDayModal } from '@/app/pos/components/EndOfDayModal';
import { ensureCashSession } from '@/lib/cashSession';
import { SalesHistoryModal } from '@/app/pos/components/SalesHistoryModal';
import { QuotationModal, type QuotationRow } from '@/app/pos/components/QuotationModal';
import { useCart } from '@/hooks/useCart';
import { useCustomerDisplay } from '@/hooks/useCustomerDisplay';
import { usePosDraftPersistence } from '@/hooks/usePosDraftPersistence';
import { POS_DRAFT_SCHEMA_VERSION, type PosDraftSnapshot } from '@/lib/posDraftStorage';
import { clientLog } from '@/lib/clientLog';
import { loadPosSettings } from '@/lib/posSettings';
import { openCashDrawerIfNeeded } from '@/lib/cashDrawerClient';
import { buildThermalPrintPageCss, resolveThermalWidthMm } from '@/lib/thermalPrintPage';
import { useProducts } from '@/hooks/useProducts';
import { useAuth } from '@/hooks/useAuth';
import { useIsPackagedDesktop } from '@/hooks/useIsPackagedDesktop';
import {
  createOrder,
  deleteCustomer,
  fetchCustomers as posFetchCustomers,
  fetchProducts as posFetchProducts,
  fetchSetupStatus as posFetchSetupStatus,
  fetchLoginUsers as posFetchUsers,
  fetchPaymentMethods as posFetchPaymentMethods,
  fetchCompanyProfile,
  fetchDocumentItems,
  fetchDocuments,
  PosApiError,
  saveCustomer,
  setupAdminPassword,
  syncNextVDNumber as posSyncNextVDNumber,
  type SetupStatusPayload,
} from '@/lib/services/posService';
import { buildReceiptHeader, safeReceiptLogoSrc } from '@/lib/receiptCompanyHeader';
import { getPosTaxPercentLabel } from '@/lib/taxConfig';
import LicenseExpiredScreen from '@/components/LicenseExpiredScreen';
import { useLicenseGuard } from '@/components/LicenseGuardProvider';
import SetupWizard from '@/components/SetupWizard';
import ActivationScreen from '@/components/ActivationScreen';
import PosSelect from '@/components/PosSelect';

type RouteProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ActivationStatePayload = {
  success: boolean;
  isActivated: boolean;
  machineId: string;
  activationCode: string;
  reason?: string;
  licensePath?: string;
};

const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    id: 'cash',
    name: 'DINHEIRO',
    code: 'cash',
    shortcut: null,
    position: 1,
    enabled: true,
    quickPayment: true,
    requiredCustomer: false,
    allowChange: true,
    markAsPaid: true,
    printReceipt: true,
    openCashDrawer: true,
  },
  {
    id: 'conta-corrente',
    name: 'CONTA CORRENTE',
    code: 'conta-corrente',
    shortcut: null,
    position: 2,
    enabled: true,
    quickPayment: true,
    requiredCustomer: true,
    allowChange: false,
    markAsPaid: false,
    printReceipt: true,
    openCashDrawer: false,
  },
];

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

const getDocumentYear = (date = new Date()) => date.getFullYear();

const formatDocumentNumber = (
  sequence: number,
  date = new Date(),
  docType: 'VD' | 'TK' | 'FP' | 'FT' = 'VD'
) => `${docType}/${getDocumentYear(date)}/${String(sequence).padStart(4, '0')}`;

type QuotationItemRow = {
  id: string;
  order_id: string;
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  price?: number | null;
  discount_amount?: number | null;
};

const normalizeQuotationToken = (value: string | null | undefined) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();


function LoginScreen({ 
  users, 
  selectedUser, 
  onSelectUser, 
  password, 
  setPassword, 
  onLogin, 
  error,
  requiresAdminPasswordSetup = false,
  onAdminPasswordConfigured,
}: { 
  users: PosUser[], 
  selectedUser: PosUser | null, 
  onSelectUser: (user: PosUser) => void, 
  password: string, 
  setPassword: React.Dispatch<React.SetStateAction<string>>, 
  onLogin: () => void | Promise<unknown>, 
  error: boolean,
  requiresAdminPasswordSetup?: boolean,
  onAdminPasswordConfigured?: () => void | Promise<void>,
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isResettingAdminPin, setIsResettingAdminPin] = useState(false);
  const [isQuitConfirmOpen, setIsQuitConfirmOpen] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [activeField, setActiveField] = useState<'pin' | 'confirm'>('pin');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const isPackagedDesktop = useIsPackagedDesktop();
  const allowAdminPinReset =
    process.env.NODE_ENV !== 'production' && !isPackagedDesktop;

  const closeModal = () => {
    setIsModalOpen(false);
    setPassword('');
    setConfirmPassword('');
    setActiveField('pin');
    setSetupError(null);
    setIsSetupMode(false);
  };

  const handleSaveAdminPassword = async () => {
    const pin = password.trim();
    const confirm = confirmPassword.trim();
    if (pin.length < 4) {
      setSetupError('O PIN deve conter pelo menos 4 caracteres.');
      return;
    }
    if (pin !== confirm) {
      setSetupError('A confirmação do PIN não confere.');
      return;
    }

    setIsSavingPassword(true);
    setSetupError(null);
    try {
      await setupAdminPassword(pin);
      await onAdminPasswordConfigured?.();
      setIsSetupMode(false);
      setConfirmPassword('');
      setActiveField('pin');
      setPassword('');
      setSetupError(null);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Falha ao configurar a senha.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleKeyClick = (key: string) => {
    if (key === 'enter') {
      if (isSetupMode) {
        void handleSaveAdminPassword();
      } else {
        void onLogin();
      }
      return;
    }
    if (key === 'back') {
      if (isSetupMode && activeField === 'confirm') {
        setConfirmPassword((prev) => prev.slice(0, -1));
      } else {
        setPassword((prev) => prev.slice(0, -1));
      }
      return;
    }
    if (isSetupMode && activeField === 'confirm') {
      setConfirmPassword((prev) => prev + key);
    } else {
      setPassword((prev) => prev + key);
    }
  };

  // Physical keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isModalOpen) return;
      
      if (e.key === 'Enter') {
        if (isSetupMode) {
          void handleSaveAdminPassword();
        } else {
          void onLogin();
        }
      } else if (e.key === 'Backspace') {
        if (isSetupMode && activeField === 'confirm') {
          setConfirmPassword((prev) => prev.slice(0, -1));
        } else {
          setPassword((prev) => prev.slice(0, -1));
        }
      } else if (e.key.length === 1) {
        if (isSetupMode && activeField === 'confirm') {
          setConfirmPassword((prev) => prev + e.key);
        } else {
          setPassword((prev) => prev + e.key);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onLogin, setPassword, isModalOpen, isSetupMode, activeField, password, confirmPassword]);

  const keypad = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['back', '0', 'enter']
  ];

  const handleResetAdminPin = async () => {
    if (!selectedUser || String(selectedUser.role ?? '').toLowerCase() !== 'admin') return;
    const confirmed = window.confirm('Redefinir PIN do Admin para 1234?');
    if (!confirmed) return;

    try {
      setIsResettingAdminPin(true);
      const response = await fetch(`${getPosApiBase()}/auth/admin/reset-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(payload?.error ?? `Erro HTTP ${response.status}`));
      }
      setPassword('');
      window.alert('PIN do Admin redefinido para 1234.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'falha ao redefinir PIN do Admin';
      window.alert(message);
    } finally {
      setIsResettingAdminPin(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#121212] text-zinc-100 font-sans overflow-hidden select-none relative p-8">
      <img
        src="/posly-p-mark.svg"
        alt=""
        aria-hidden
        width={121}
        height={131}
        decoding="async"
        draggable={false}
        className="pointer-events-none fixed left-[-90px] top-[-70px] h-[1200px] w-auto max-w-none select-none z-0 opacity-25"
      />
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center min-h-0">
        {/* User Grid */}
        <div className="flex flex-wrap justify-center gap-6 max-w-7xl">
          {users.slice().sort((a, b) => a.name.localeCompare(b.name)).map((user) => (
            <button
              key={user.id}
              onClick={() => {
                onSelectUser(user);
                const needsSetup =
                  requiresAdminPasswordSetup &&
                  String(user.role ?? '').toLowerCase() === 'admin';
                setIsSetupMode(needsSetup);
                setConfirmPassword('');
                setActiveField('pin');
                setSetupError(null);
                setPassword('');
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
            onClick={closeModal}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-zinc-900 w-[400px] rounded overflow-hidden border border-zinc-800"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="bg-zinc-800 px-4 py-3 flex flex-col items-center justify-center border-b border-zinc-700 gap-1">
                <span className="text-xl text-zinc-100 font-medium">
                  {isSetupMode ? 'Configurar senha' : 'Senha'}
                </span>
                {isSetupMode ? (
                  <span className="text-xs text-zinc-400">Defina o PIN do Administrador</span>
                ) : null}
              </div>

              {/* Modal Content */}
              <div className="p-4 flex flex-col gap-4">
                {isSetupMode ? (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveField('pin')}
                      className={`h-14 bg-zinc-800 border rounded flex items-center px-4 transition-all ${
                        activeField === 'pin' ? 'border-[#0001fb]' : 'border-zinc-700'
                      }`}
                    >
                      <span className="w-full text-center text-2xl tracking-widest text-white">
                        {password ? '•'.repeat(password.length) : (
                          <span className="text-sm tracking-normal text-zinc-500">Nova senha</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveField('confirm')}
                      className={`h-14 bg-zinc-800 border rounded flex items-center px-4 transition-all ${
                        activeField === 'confirm' ? 'border-[#0001fb]' : 'border-zinc-700'
                      }`}
                    >
                      <span className="w-full text-center text-2xl tracking-widest text-white">
                        {confirmPassword ? '•'.repeat(confirmPassword.length) : (
                          <span className="text-sm tracking-normal text-zinc-500">Confirmar senha</span>
                        )}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className={`flex-grow h-16 bg-zinc-800 border rounded flex items-center px-4 transition-all duration-200 ${error ? 'border-red-500 animate-shake' : 'border-zinc-700'}`}>
                      <input 
                        type="password"
                        value={password ?? ''}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full text-3xl tracking-widest focus:outline-none bg-transparent text-white text-center"
                      />
                    </div>
                  </div>
                )}

                {setupError ? (
                  <div className="rounded border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                    {setupError}
                  </div>
                ) : null}

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-2">
                  {keypad.flat().map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeyClick(key)}
                      disabled={isSavingPassword}
                      className={`
                        h-16 text-xl font-medium flex items-center justify-center transition-colors rounded disabled:opacity-50
                        ${key === 'enter' ? 'bg-[#0001fb] text-white hover:bg-[#1a1cff]' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'}
                        ${key === 'back' ? 'text-lg' : ''}
                      `}
                    >
                      {key === 'enter'
                        ? isSetupMode
                          ? isSavingPassword
                            ? '...'
                            : 'Guardar'
                          : 'Entrar'
                        : key === 'back'
                          ? 'Apagar'
                          : key}
                    </button>
                  ))}
                </div>

                {!isSetupMode &&
                  allowAdminPinReset &&
                  String(selectedUser?.role ?? '').toLowerCase() === 'admin' && (
                  <button
                    type="button"
                    onClick={() => void handleResetAdminPin()}
                    disabled={isResettingAdminPin}
                    className="h-11 rounded border border-amber-700/60 bg-amber-900/20 text-amber-300 text-sm font-medium transition-colors hover:bg-amber-900/35 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isResettingAdminPin ? 'A redefinir...' : 'Redefinir PIN do Admin (1234)'}
                  </button>
                )}
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
      <div className="absolute bottom-8 right-8 z-10">
        <button
          type="button"
          onClick={() => setIsQuitConfirmOpen(true)}
          className="w-16 h-16 flex items-center justify-center bg-zinc-800/50 hover:bg-red-600/20 text-zinc-500 hover:text-red-500 rounded-full transition-all duration-300 group border border-zinc-700/50"
          title="Fechar o sistema"
        >
          <Power size={32} className="group-hover:scale-110 transition-transform" />
        </button>
      </div>

      <ConfirmDialog
        isOpen={isQuitConfirmOpen}
        title="Fechar sistema"
        message="Deseja fechar o sistema? O POSly será encerrado neste computador."
        confirmLabel="Fechar"
        cancelLabel="Cancelar"
        tone="danger"
        onCancel={() => setIsQuitConfirmOpen(false)}
        onConfirm={() => {
          setIsQuitConfirmOpen(false);
          void quitPoslyApp();
        }}
      />
    </div>
  );
}

export default function POSPage({ params, searchParams }: RouteProps) {
  // Next 16 passes route props as Promises in app router.
  // Explicitly unwrapping avoids sync dynamic API warnings in dev overlays.
  use(params);
  use(searchParams);
  const router = useRouter();
  const { licenseExpired, tenantName, expiresAt, clearLicenseExpired } = useLicenseGuard();
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
  const [isReceiptPrintEnabled, setIsReceiptPrintEnabled] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [receivedAmount, setReceivedAmount] = useState<string>('');
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [isMultiplePayment, setIsMultiplePayment] = useState(false);
  const [multiplePaymentMethod, setMultiplePaymentMethod] = useState<PaymentMethod>('cash');
  const [multiplePaymentAmount, setMultiplePaymentAmount] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [isFinalizingPayment, setIsFinalizingPayment] = useState(false);
  const [paymentFinalizeError, setPaymentFinalizeError] = useState<string | null>(null);
  const [allowStockOverrideOnCheckout, setAllowStockOverrideOnCheckout] = useState(false);

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
  const [setupStatus, setSetupStatus] = useState<SetupStatusPayload | null>(null);
  const [isSetupLoading, setIsSetupLoading] = useState(true);
  const [activationState, setActivationState] = useState<ActivationStatePayload | null>(null);
  const [isActivationLoading, setIsActivationLoading] = useState(true);
  const [isActivatingLicense, setIsActivatingLicense] = useState(false);
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
  const [isSalesHistoryOpen, setIsSalesHistoryOpen] = useState(false);
  const [isEndOfDayOpen, setIsEndOfDayOpen] = useState(false);

  // Login State (isolated hook to keep session handling centralized)
  const auth = useAuth();
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
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [salesMode, setSalesMode] = useState<'customer' | 'table'>('customer');
  const [docType, setDocType] = useState<'VD' | 'TK' | 'FP' | 'FT'>('VD');
  const [finalizedDocType, setFinalizedDocType] = useState<'VD' | 'TK' | 'FP' | 'FT'>('VD');
  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);
  const [quotationRows, setQuotationRows] = useState<QuotationRow[]>([]);
  const [quotationItemsByOrderId, setQuotationItemsByOrderId] = useState<Record<string, QuotationItemRow[]>>({});
  const [isQuotationLoading, setIsQuotationLoading] = useState(false);
  const [loadedQuotationSource, setLoadedQuotationSource] = useState<{ sourceId: string; sourceType: 'order' | 'sale' } | null>(null);
  const [tableOrders, setTableOrders] = useState<{[key: string]: { cart: CartItem[], globalDiscount: {type: 'value' | 'percentage', amount: number} | null, selectedCustomer: Customer | null, docType: 'VD' | 'TK' | 'FP' | 'FT' }}>({});
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
  const scannerBufferRef = useRef('');
  const scannerResetTimerRef = useRef<number | null>(null);
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);
  /** Recibo pré-carregado no Electron enquanto o pagamento está aberto. */
  const receiptPreparedRef = useRef(false);
  const receiptPrepareGenRef = useRef(0);
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

      if (!isBrowserEvent) {
        clientLog.error('client.unhandled_rejection', normalized.message || 'Promise rejeitada sem tratamento', {
          module: 'pos.page',
          action: 'unhandledrejection',
          reason: 'Erro assíncrono não tratado na interface do POS',
          code: normalized.code,
        });
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      clientLog.warn('client.browser_rejection', normalized.message, {
        module: 'pos.page',
        action: 'unhandledrejection',
        reason: 'Rejeição benigna do browser interceptada',
        persist: false,
      });
    };

    const handleWindowError = (event: ErrorEvent) => {
      const normalized = normalizeUnknownError(event.error || event);
      const isBrowserEvent = normalized.code === 'BROWSER_EVENT' || !event.error;

      if (!isBrowserEvent) {
        clientLog.error('client.window_error', normalized.message || 'Erro na janela', {
          module: 'pos.page',
          action: 'window.error',
          reason: 'Excepção não tratada no renderer',
          code: normalized.code,
        });
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      clientLog.warn('client.browser_error', normalized.message, {
        module: 'pos.page',
        action: 'window.error',
        reason: 'Erro benigno do browser interceptado',
        persist: false,
      });
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
  const isCashPaymentMethod = useCallback(
    (methodCode: PaymentMethod | null) => {
      if (!methodCode) return false;
      const method = paymentMethods.find((item) => item.code === methodCode);
      if (!method) return String(methodCode).toLowerCase() === 'cash';
      return method.allowChange || method.code === 'cash';
    },
    [paymentMethods]
  );
  const paymentLabel = useCallback(
    (methodCode: PaymentMethod | null) => {
      if (!methodCode) return 'N/A';
      const method = paymentMethods.find((item) => item.code === methodCode);
      return method?.name ?? String(methodCode);
    },
    [paymentMethods]
  );
  const paymentMethodMarksAsPaid = useCallback(
    (methodCode: PaymentMethod | null) => {
      if (!methodCode) return true;
      const normalized = String(methodCode).toLowerCase().replace(/-/g, ' ');
      // Conta Corrente gera dívida (FT) — nunca marca como pago.
      if (normalized.includes('conta') && normalized.includes('corrente')) return false;
      const method = paymentMethods.find((item) => item.code === methodCode);
      if (!method) return true;
      return method.markAsPaid !== false;
    },
    [paymentMethods]
  );
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // --- Calculations ---
  const { originalTotal, originalSubtotal, totalDiscount, total, subtotal, tax } = useCart(cart, globalDiscount);
  useCustomerDisplay({
    cart,
    total,
    isPaymentOpen: isPaymentModalOpen,
    isSaleFinalized,
  });

  const buildPosDraftSnapshot = useCallback((): PosDraftSnapshot => {
    return {
      v: POS_DRAFT_SCHEMA_VERSION,
      cart,
      selectedCustomer,
      customerName,
      tableNumber,
      globalDiscount,
      docType,
      salesMode,
      selectedTableId,
      tableOrders,
      selectedCartItemId,
    };
  }, [
    cart,
    selectedCustomer,
    customerName,
    tableNumber,
    globalDiscount,
    docType,
    salesMode,
    selectedTableId,
    tableOrders,
    selectedCartItemId,
  ]);

  const applyPosDraft = useCallback((d: PosDraftSnapshot) => {
    const nextCart = Array.isArray(d.cart) ? d.cart : [];
    setCart(nextCart);
    setSelectedCustomer(d.selectedCustomer ?? null);
    setCustomerName(typeof d.customerName === 'string' ? d.customerName : '');
    setTableNumber(typeof d.tableNumber === 'string' ? d.tableNumber : '');
    setGlobalDiscount(d.globalDiscount ?? null);
    setDocType((d.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT');
    setSalesMode(d.salesMode === 'table' ? 'table' : 'customer');
    setSelectedTableId(d.selectedTableId ?? null);
    setTableOrders(d.tableOrders && typeof d.tableOrders === 'object' ? d.tableOrders : {});
    const sid = typeof d.selectedCartItemId === 'string' ? d.selectedCartItemId : null;
    setSelectedCartItemId(sid && nextCart.some((item) => item.id === sid) ? sid : null);
  }, []);

  const { flushDraftNow, clearDraftEverywhere } = usePosDraftPersistence({
    enabled: Boolean(isLoggedIn && isAuthRestored),
    userId: currentUser?.id,
    paused: isSaleFinalized,
    buildSnapshot: buildPosDraftSnapshot,
    applyDraft: applyPosDraft,
  });

  // Abertura automática da sessão de caixa no login.
  useEffect(() => {
    if (!isLoggedIn || !isAuthRestored || !currentUser?.id) return;
    void ensureCashSession().catch(() => undefined);
  }, [isLoggedIn, isAuthRestored, currentUser?.id]);

  const buildPrintReceiptMarkup = (options?: {
    saleFinalized?: boolean;
    docTypeOverride?: 'VD' | 'TK' | 'FP' | 'FT';
    receiptNumber?: string | null;
  }) => {
    const now = new Date();
    const saleFinalized = options?.saleFinalized ?? isSaleFinalized;
    const activeDocType = options?.docTypeOverride ?? finalizedDocType;
    const orderCode =
      options?.receiptNumber ||
      currentReceiptNumber ||
      formatDocumentNumber(nextVDNumber, now);
    const customerLabel = selectedCustomer ? selectedCustomer.name : 'Consumidor Final';
    const documentLabel = saleFinalized ? activeDocType : 'Cons. Doc';
    const totalPaid = !saleFinalized
      ? 0
      : !isMultiplePayment
        ? (isCashPaymentMethod(paymentMethod) ? parseFloat(receivedAmount || `${total}`) : total)
        : payments.reduce((acc, p) => acc + p.amount, 0);
    const paymentRows = !saleFinalized
      ? ''
      : !isMultiplePayment
        ? `
          <div class="print-row payment-row">
            <span>${escapeHtml(paymentLabel(paymentMethod))}</span>
            <span>${formatReceiptAmount(total)}</span>
          </div>
        `
        : payments.map((p) => `
          <div class="print-row payment-row">
            <span>${escapeHtml(paymentLabel(p.method))}</span>
            <span>${formatReceiptAmount(p.amount)}</span>
          </div>
        `).join('');

    const hasChange = ((!isMultiplePayment && isCashPaymentMethod(paymentMethod) && receivedAmount !== '') ||
      (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) > total));

    const shouldShowPaidRow = !saleFinalized
      ? false
      : !isMultiplePayment
        ? isCashPaymentMethod(paymentMethod) && receivedAmount !== '' && parseFloat(receivedAmount || '0') > total
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

    const hasDiscount = totalDiscount > 0.0001;
    const discountNet = Math.max(0, originalSubtotal - subtotal);
    const discountRowHtml = hasDiscount
      ? `
          <div class="print-row discount-row">
            <span>Desconto:</span>
            <span>-${formatReceiptAmount(discountNet)}</span>
          </div>
        `
      : '';

    const receiptHead = buildReceiptHeader(companyProfile);
    const logoSrc = safeReceiptLogoSrc(receiptHead.logoDataUrl);
    const headerTitleHtml = logoSrc
      ? `<div class="print-logo-wrap"><img src="${logoSrc}" alt="" class="print-logo" /></div>`
      : `<div class="logo">${escapeHtml(receiptHead.title)}</div>`;
    const headerLinesHtml = receiptHead.lines
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join('');
    const printCfg = loadPosSettings();
    const extraHeader = String(printCfg.printExtraHeader || '').trim();
    const extraFooter = String(printCfg.printExtraFooter || '').trim();
    const headerAlign = printCfg.printHeaderAlign === 'left' ? 'align-left' : 'align-center';
    const footerAlign = printCfg.printFooterAlign === 'left' ? 'align-left' : 'align-center';
    const extraHeaderHtml = extraHeader
      ? `<div class="print-extra-header ${headerAlign}">${escapeHtml(extraHeader)}</div>`
      : '';
    const extraFooterHtml = extraFooter
      ? `<div class="print-extra-footer ${footerAlign}">${escapeHtml(extraFooter)}</div>`
      : '';

    return `
      <div class="print-receipt ${saleFinalized ? 'payment-receipt' : 'consult-receipt'}">
        ${extraHeaderHtml}
        <div class="print-header">
          ${headerTitleHtml}
          ${headerLinesHtml}
          <div class="customer">Cliente: ${escapeHtml(customerLabel)}</div>
        </div>

        <div class="print-block">
          <div class="print-meta">
            <div class="print-meta-col">
              <span>Data: ${escapeHtml(now.toLocaleDateString())}</span>
              <span class="print-meta-sub">${escapeHtml(now.toLocaleTimeString())}</span>
            </div>
            <div class="print-meta-col print-meta-right">
              <span>Atendido por:</span>
              <span class="print-attendant">${escapeHtml(currentUser?.name || 'Admin')}</span>
            </div>
          </div>
          <div class="print-doc" data-receipt-doc>${documentLabel} No.: ${escapeHtml(orderCode)}</div>
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
            <span>${formatReceiptAmount(originalSubtotal)}</span>
          </div>
          ${discountRowHtml}
          <div class="print-row">
            <span>IVA (${getPosTaxPercentLabel()}):</span>
            <span>${formatReceiptAmount(tax)}</span>
          </div>
          <div class="print-divider"></div>
          <div class="print-row total-row">
            <span>Total:</span>
            <span>${formatReceiptAmount(total)}</span>
          </div>
        </div>

        ${saleFinalized ? `
          <div class="print-block">
            <div class="print-row print-pay-header">
              <span>Método de Pagamento</span>
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
          <div>Obrigado pela preferência!</div>
          <div class="foot-note">Sistema desenvolvido por: Nicolau Nino</div>
        </div>
        ${extraFooterHtml}
      </div>
    `;
  };

  const buildThermalReceiptHtml = (options?: {
    saleFinalized?: boolean;
    docTypeOverride?: 'VD' | 'TK' | 'FP' | 'FT';
    receiptNumber?: string | null;
  }) => {
    const saleFinalized = options?.saleFinalized ?? isSaleFinalized;
    const printMarkup = buildPrintReceiptMarkup(options);
    const estimatedHeightMm = Math.max(
      34,
      66 + (cart.length * 9) + (saleFinalized ? (payments.length > 0 ? payments.length * 7 : 14) + 20 : 0),
    );
    const printSettings = loadPosSettings();
    const widthMm = resolveThermalWidthMm(printSettings.printPaperWidth);
    const heightMm = Math.max(estimatedHeightMm + 20, 120);
    const printHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Recibo</title>
    <style>${buildThermalPrintPageCss(widthMm, {
      top: printSettings.printMarginTop,
      right: printSettings.printMarginRight,
      bottom: printSettings.printMarginBottom,
      left: printSettings.printMarginLeft,
    })}</style>
  </head>
  <body>${printMarkup}</body>
</html>`;
    return { printHtml, printSettings, widthMm, heightMm };
  };

  const estimateCheckoutDocType = useCallback((): 'VD' | 'TK' | 'FP' | 'FT' => {
    if (docType === 'FP') return 'FP';
    const finalPayments = isMultiplePayment
      ? payments
      : paymentMethod
        ? [
            {
              method: paymentMethod,
              amount:
                isCashPaymentMethod(paymentMethod) && receivedAmount !== ''
                  ? parseFloat(receivedAmount)
                  : total,
            },
          ]
        : [];
    if (finalPayments.length === 0) return docType === 'TK' ? 'TK' : 'VD';
    const isPaidSale = finalPayments.every((entry) => paymentMethodMarksAsPaid(entry.method));
    return isPaidSale ? docType : 'FT';
  }, [
    docType,
    isMultiplePayment,
    payments,
    paymentMethod,
    receivedAmount,
    total,
    paymentMethodMarksAsPaid,
    isCashPaymentMethod,
  ]);

  // Pré-montar recibo no Electron enquanto o pagamento está aberto.
  useEffect(() => {
    if (!isPaymentModalOpen || !isReceiptPrintEnabled) {
      receiptPreparedRef.current = false;
      return;
    }
    if (typeof window === 'undefined' || !window.electronAPI?.prepareReceiptPrint) {
      return;
    }
    if (cart.length === 0) {
      receiptPreparedRef.current = false;
      return;
    }

    const gen = ++receiptPrepareGenRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const saleDocType = estimateCheckoutDocType();
          const { printHtml, printSettings, widthMm, heightMm } = buildThermalReceiptHtml({
            saleFinalized: true,
            docTypeOverride: saleDocType,
            receiptNumber: formatDocumentNumber(nextVDNumber, new Date()),
          });
          const result = await window.electronAPI!.prepareReceiptPrint!(printHtml, {
            printer: printSettings.printJobs?.receipt?.printer || undefined,
            copies: printSettings.printCopies,
            widthMm,
            heightMm,
          });
          if (gen !== receiptPrepareGenRef.current) return;
          receiptPreparedRef.current = Boolean(result?.success);
        } catch {
          if (gen === receiptPrepareGenRef.current) {
            receiptPreparedRef.current = false;
          }
        }
      })();
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
    // Não incluir receivedAmount: cada tecla no troco invalidava o prepare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isPaymentModalOpen,
    isReceiptPrintEnabled,
    cart,
    paymentMethod,
    payments,
    isMultiplePayment,
    total,
    subtotal,
    tax,
    totalDiscount,
    originalSubtotal,
    docType,
    selectedCustomer,
    companyProfile,
    nextVDNumber,
    currentUser?.name,
    estimateCheckoutDocType,
  ]);

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

  const refreshSetupStatus = useCallback(async () => {
    try {
      const status = await posFetchSetupStatus();
      setSetupStatus(status);
      return status;
    } catch {
      setSetupStatus(null);
      return null;
    } finally {
      setIsSetupLoading(false);
    }
  }, []);

  const refreshActivationState = useCallback(async () => {
    if (!window.electronAPI?.getActivationState) {
      const fallback: ActivationStatePayload = {
        success: true,
        isActivated: true,
        machineId: '',
        activationCode: '',
      };
      setActivationState(fallback);
      setIsActivationLoading(false);
      return fallback;
    }

    try {
      const state = await window.electronAPI.getActivationState();
      const normalized: ActivationStatePayload = {
        success: Boolean(state?.success),
        isActivated: Boolean(state?.isActivated),
        machineId: String(state?.machineId ?? ''),
        activationCode: String(state?.activationCode ?? ''),
        reason: state?.reason ? String(state.reason) : undefined,
        licensePath: state?.licensePath ? String(state.licensePath) : undefined,
      };
      setActivationState(normalized);
      return normalized;
    } catch {
      const failed: ActivationStatePayload = {
        success: false,
        isActivated: false,
        machineId: '',
        activationCode: '',
        reason: 'Falha ao obter estado de ativação.',
      };
      setActivationState(failed);
      return failed;
    } finally {
      setIsActivationLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSetupStatus();
  }, [refreshSetupStatus]);

  useEffect(() => {
    void refreshActivationState();
  }, [refreshActivationState]);

  // --- Effects ---
  useEffect(() => {
    if (!isAuthRestored) return;
    let cancelled = false;

    void (async () => {
      try {
        const nextSequence = 1;
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
    if (!isAuthRestored || !isLoggedIn) return;

    const fetchData = async () => {
      try {
        const [productsData, customersData, companyData] = await Promise.all([
          posFetchProducts(),
          posFetchCustomers(),
          fetchCompanyProfile().catch(() => null),
        ]);
        const paymentMethodsData = await posFetchPaymentMethods();
  
        console.log('🔥 PRODUTOS DO BACKEND:', productsData);
  
        setProducts(productsData || []);
        setCustomers(customersData || []);
        setCompanyProfile(companyData);
        const normalizedMethods = Array.isArray(paymentMethodsData) ? paymentMethodsData : [];
        setPaymentMethods(normalizedMethods);
        const firstEnabledMethod = normalizedMethods.find((method) => method.enabled);
        if (firstEnabledMethod?.code) {
          setMultiplePaymentMethod(firstEnabledMethod.code);
        }
      } catch (error) {
        console.error('Erro ao carregar dados:', error);
        setProducts([]);
        setCustomers([]);
        setCompanyProfile(null);
        setPaymentMethods(FALLBACK_PAYMENT_METHODS);
      }
    };

    void fetchData();
  }, [isAuthRestored, isLoggedIn]);

  useEffect(() => {
    if (!isAuthRestored) return;
    void fetchUsers();
  }, [fetchUsers, isAuthRestored]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sidebar') === 'open') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const refreshCompany = () => {
      void fetchCompanyProfile()
        .then(setCompanyProfile)
        .catch(() => setCompanyProfile(null));
    };
    window.addEventListener('company-profile-changed', refreshCompany);
    return () => window.removeEventListener('company-profile-changed', refreshCompany);
  }, []);

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

  const submitSearchValue = useCallback((value: string) => {
    const raw = value.trim();
    if (!raw) return;

    const normalized = raw.toLowerCase();
    const exactBarcodeMatch = products.find(
      (product) => String(product.barcode ?? '').trim().toLowerCase() === normalized
    );
    const exactCodeMatch = products.find(
      (product) => String(product.code ?? '').trim().toLowerCase() === normalized
    );
    const fuzzyMatches = products.filter((product) => {
      if (product.active === false) return false;
      const productName = String(product.name ?? '').toLowerCase();
      const productBarcode = String(product.barcode ?? '').toLowerCase();
      const productCode = String(product.code ?? '').toLowerCase();
      return (
        productName.includes(normalized) ||
        productBarcode.includes(normalized) ||
        productCode.includes(normalized)
      );
    });
    const fallbackVisibleSingle = fuzzyMatches.length === 1 ? fuzzyMatches[0] : null;
    const selectedProduct = exactBarcodeMatch ?? exactCodeMatch ?? fallbackVisibleSingle;

    if (!selectedProduct) {
      showToast('Produto não encontrado para este código de barras.', 'error');
      return;
    }

    addToCart(selectedProduct);
    setSearchQuery('');
  }, [addToCart, products, searchQuery, showToast]);

  const handleSearchSubmit = useCallback(() => {
    submitSearchValue(searchQuery);
  }, [searchQuery, submitSearchValue]);

  useEffect(() => {
    if (!isLoggedIn) return;

    const isTypingElement = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target.isContentEditable
      );
    };

    const clearScannerBuffer = () => {
      scannerBufferRef.current = '';
      if (scannerResetTimerRef.current !== null) {
        window.clearTimeout(scannerResetTimerRef.current);
        scannerResetTimerRef.current = null;
      }
    };

    const armResetTimer = () => {
      if (scannerResetTimerRef.current !== null) {
        window.clearTimeout(scannerResetTimerRef.current);
      }
      scannerResetTimerRef.current = window.setTimeout(() => {
        scannerBufferRef.current = '';
        scannerResetTimerRef.current = null;
      }, 120);
    };

    const onGlobalScannerKeydown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (event.key === 'Enter') {
        const scanned = scannerBufferRef.current.trim();
        if (scanned) {
          event.preventDefault();
          submitSearchValue(scanned);
          clearScannerBuffer();
        }
        return;
      }

      if (event.key.length === 1) {
        scannerBufferRef.current += event.key;
        armResetTimer();
      }
    };

    window.addEventListener('keydown', onGlobalScannerKeydown);
    return () => {
      window.removeEventListener('keydown', onGlobalScannerKeydown);
      clearScannerBuffer();
    };
  }, [isLoggedIn, submitSearchValue]);

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
    setAllowStockOverrideOnCheckout(false);
    setPaymentFinalizeError(null);
    setIsFinalizingPayment(false);
    checkoutIdempotencyKeyRef.current = null;
    setSelectedCustomer(null);
    setCustomerName('');
    setCurrentReceiptNumber(null);
    setDocType('VD');
    setFinalizedDocType('VD');
    setLoadedQuotationSource(null);
    setTableOrders({});
    void clearDraftEverywhere();
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
    if (isFinalizingPayment) return;

    const saleDate = new Date();
    const saleTimestamp = saleDate.toISOString();
    const isVDDocument = docType === 'VD';
    setPaymentFinalizeError(null);

    const finalPayments = isMultiplePayment ? payments : (paymentMethod ? [{ method: paymentMethod, amount: isCashPaymentMethod(paymentMethod) && receivedAmount !== '' ? parseFloat(receivedAmount) : total }] : []);
    const isAccountReceivable = finalPayments.some((entry) => {
      const normalized = String(entry.method ?? '').toLowerCase().replace(/-/g, ' ');
      return normalized.includes('conta') && normalized.includes('corrente');
    });
    if (isAccountReceivable && !selectedCustomer) {
      setPaymentFinalizeError('Selecione um cliente para poder guardar esta divida');
      return;
    }

    setIsFinalizingPayment(true);

    const isProforma = docType === 'FP';
    const isPaidSale = isProforma ? false : finalPayments.every((entry) => paymentMethodMarksAsPaid(entry.method));
    const paymentStatus = isProforma ? 'pending' : isPaidSale ? 'completed' : 'pending';
    const saleDocType: 'VD' | 'TK' | 'FP' | 'FT' = isProforma ? 'FP' : isPaidSale ? docType : 'FT';
    const amount = isProforma
      ? 0
      : isMultiplePayment
        ? payments.reduce((acc, p) => acc + p.amount, 0)
        : (isCashPaymentMethod(paymentMethod)
            ? (receivedAmount === '' ? total : parseFloat(receivedAmount))
            : total);
    const change = !isProforma && amount > total ? (amount - total) : 0;

    // Enquanto a API grava a venda, garantir recibo pronto na janela de impressão.
    const printSettingsEarly = loadPosSettings();
    const shouldPrintReceipt =
      isReceiptPrintEnabled && Boolean(window.electronAPI?.prepareReceiptPrint || window.electronAPI?.printReceipt);
    let prepareDuringCheckout: Promise<{
      ok: boolean;
      widthMm: number;
      heightMm: number;
      printHtml: string;
    }> | null = null;

    if (shouldPrintReceipt && window.electronAPI?.prepareReceiptPrint) {
      const bundle = buildThermalReceiptHtml({
        saleFinalized: true,
        docTypeOverride: saleDocType,
        receiptNumber: formatDocumentNumber(nextVDNumber, saleDate),
      });
      prepareDuringCheckout = window.electronAPI
        .prepareReceiptPrint(bundle.printHtml, {
          printer: printSettingsEarly.printJobs?.receipt?.printer || undefined,
          copies: printSettingsEarly.printCopies,
          widthMm: bundle.widthMm,
          heightMm: bundle.heightMm,
        })
        .then((r) => {
          const ok = Boolean(r?.success);
          receiptPreparedRef.current = ok;
          return {
            ok,
            widthMm: bundle.widthMm,
            heightMm: bundle.heightMm,
            printHtml: bundle.printHtml,
          };
        })
        .catch(() => ({
          ok: false,
          widthMm: bundle.widthMm,
          heightMm: bundle.heightMm,
          printHtml: bundle.printHtml,
        }));
    }
    
    // Save to Supabase via service layer
    try {
      const idempotencyKey =
        checkoutIdempotencyKeyRef.current ||
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`);
      checkoutIdempotencyKeyRef.current = idempotencyKey;

      const result = await createOrder({
        cart,
        globalDiscount,
        selectedCustomerId: selectedCustomer?.cloud_id || selectedCustomer?.id || null,
        selectedCustomerName: selectedCustomer?.name || customerName || null,
        selectedUserId: currentUser?.id || null,
        selectedUserName: currentUser?.name || null,
        selectedTableId: selectedTableId || null,
        docType: saleDocType,
        total,
        subtotal,
        tax,
        totalDiscount,
        isMultiplePayment: isProforma ? false : isMultiplePayment,
        paymentMethod: isProforma ? null : paymentMethod,
        receivedAmount: isProforma ? '' : receivedAmount,
        payments: isProforma ? [] : payments,
        paymentStatus,
        saleTimestamp,
        saleDate,
        allowNegativeStockOverride: isProforma ? false : allowStockOverrideOnCheckout,
        stockOverrideReason: !isProforma && allowStockOverrideOnCheckout ? 'Override confirmado no POS durante checkout.' : null,
      }, {
        idempotencyKey,
      });

      checkoutIdempotencyKeyRef.current = null;
      setPaymentFinalizeError(null);

      // Cotação em background — não atrasar a impressão.
      if (loadedQuotationSource) {
        const quotationSource = loadedQuotationSource;
        setLoadedQuotationSource(null);
        void (async () => {
          try {
            const approvalRes = await fetch(`${getPosApiBase()}/cotacoes/aprovar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sourceId: quotationSource.sourceId,
                sourceType: quotationSource.sourceType,
                approvedDocType: String(result.usedDocType || saleDocType).toUpperCase(),
                approvedDocumentNumber: String(result.usedDocumentNumber ?? ''),
              }),
            });
            if (!approvalRes.ok) throw new Error(`Falha ao aprovar cotação (${approvalRes.status})`);
          } catch {
            showToast('Venda concluída, mas não foi possível atualizar o status da cotação.', 'info');
          }
        })();
      }

      // Impressão: commit do recibo já preparado (só atualiza nº + manda ao spooler).
      if (shouldPrintReceipt && window.electronAPI?.printReceipt) {
        const printerLabel =
          printSettingsEarly.printJobs?.receipt?.printer || 'a impressora';
        showToast(`Recibo enviado para ${printerLabel}.`, 'success');

        const preparedState = prepareDuringCheckout
          ? await prepareDuringCheckout
          : {
              ok: receiptPreparedRef.current,
              widthMm: resolveThermalWidthMm(printSettingsEarly.printPaperWidth),
              heightMm: 200,
              printHtml: '',
            };

        const printOptions = {
          printer: printSettingsEarly.printJobs?.receipt?.printer || undefined,
          copies: printSettingsEarly.printCopies,
          widthMm: preparedState.widthMm,
          heightMm: preparedState.heightMm,
        };
        const docLine = `${saleDocType} No.: ${String(result.usedDocumentNumber ?? '')}`;

        const sendFullPrint = (html: string) => {
          if (!html) return;
          void window.electronAPI!.printReceipt!(html, printOptions).catch(() => {
            showToast('Falha na impressão silenciosa.', 'info');
          });
        };

        if (window.electronAPI.commitReceiptPrint) {
          try {
            const commitResult = await window.electronAPI.commitReceiptPrint({
              ...printOptions,
              patch: { docLine },
            });
            if (!commitResult?.success || commitResult?.needFullPrint) {
              const fallbackHtml =
                preparedState.printHtml ||
                buildThermalReceiptHtml({
                  saleFinalized: true,
                  docTypeOverride: saleDocType,
                  receiptNumber: result.usedDocumentNumber,
                }).printHtml;
              sendFullPrint(fallbackHtml);
            }
          } catch {
            const fallbackHtml =
              preparedState.printHtml ||
              buildThermalReceiptHtml({
                saleFinalized: true,
                docTypeOverride: saleDocType,
                receiptNumber: result.usedDocumentNumber,
              }).printHtml;
            sendFullPrint(fallbackHtml);
          }
        } else {
          const fallbackHtml =
            preparedState.printHtml ||
            buildThermalReceiptHtml({
              saleFinalized: true,
              docTypeOverride: saleDocType,
              receiptNumber: result.usedDocumentNumber,
            }).printHtml;
          sendFullPrint(fallbackHtml);
        }

        receiptPreparedRef.current = false;
        resetForNewSale();
      } else if (isReceiptPrintEnabled) {
        setFinalizedDocType(saleDocType);
        setCurrentReceiptNumber(result.usedDocumentNumber);
        setIsReceiptModalOpen(true);
        setIsSaleFinalized(true);
      }

      // Gaveta depois de disparar a impressão — menos contenção na XP-80C.
      if (!isProforma) {
        void openCashDrawerIfNeeded({
          payments: finalPayments,
          paymentMethods,
        }).then((drawer) => {
          if (drawer.attempted && !drawer.success && drawer.error) {
            showToast(`Venda OK. Gaveta: ${drawer.error}`, 'info');
          }
        });
      }

      if (String(result.usedDocType || saleDocType).toUpperCase() === 'VD' && result.usedSequence) {
        const updatedNext = result.usedSequence + 1;
        setNextVDNumber(updatedNext);
      }

      setIsPaymentModalOpen(false);
      // Venda concluída: nunca manter rascunho do carrinho (mesmo com recibo ainda aberto).
      void clearDraftEverywhere();
      if (!isReceiptPrintEnabled) {
        resetForNewSale();
      }
      setAllowStockOverrideOnCheckout(false);

      // Refresh stock/customers in background — não bloquear o caixa após finalizar.
      void (async () => {
        try {
          const [productsData, customersData] = await Promise.all([
            posFetchProducts(),
            posFetchCustomers(),
          ]);
          if (productsData && productsData.length > 0) setProducts(productsData);
          // Só actualiza a lista — não reaplicar selectedCustomer (resetForNewSale já o limpou).
          if (Array.isArray(customersData)) setCustomers(customersData);
        } catch {
          // Non-fatal: stock/customers will be corrected on next refresh / error flow.
        }
      })();
    } catch (error: any) {
      const err = handleSupabaseError(error, 'handleFinalizePayment');
      const code = error instanceof PosApiError ? String(error.code ?? '') : '';
      if (code === 'CHECKOUT_IN_PROGRESS') {
        setPaymentFinalizeError('Este pedido já está a ser processado. Aguarde e tente novamente.');
      } else if (code === 'INSUFFICIENT_STOCK') {
        setPaymentFinalizeError('Estoque insuficiente. Solicite autorização para venda sem stock ou ajuste o carrinho.');
      } else {
        setPaymentFinalizeError(`Falha ao salvar pedido: ${err.message}`);
      }
      showToast(`Falha ao concluir pagamento: ${err.message}`, 'error');

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

      try {
        const nextSequence = await posSyncNextVDNumber(new Date());
        setNextVDNumber(nextSequence);
      } catch {
        setNextVDNumber(1);
      }
    } finally {
      setIsFinalizingPayment(false);
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
        showToast('Cliente excluído com sucesso!', 'success');
      } catch (error) {
        handleSupabaseError(error, 'confirmDeleteCustomer');
        const message =
          error instanceof PosApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Erro ao excluir cliente.';
        showToast(message, 'error');
        setCustomerToDelete(null);
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

  const isQuotationDocument = (row: QuotationRow) => {
    const docType = normalizeQuotationToken(row.doc_type);
    if (!docType) return false;
    return docType === 'fp' || docType.includes('proforma') || docType.includes('cotacao');
  };

  const loadQuotations = async () => {
    setIsQuotationLoading(true);
    try {
      const [rawDocuments, rawItems] = await Promise.all([fetchDocuments(), fetchDocumentItems()]);
      const documents = (Array.isArray(rawDocuments) ? rawDocuments : []) as QuotationRow[];
      const items = (Array.isArray(rawItems) ? rawItems : []) as QuotationItemRow[];

      const quotations = documents
        .filter((row) => {
          if (!isQuotationDocument(row)) return false;
          const statusToken = normalizeQuotationToken(row.status);
          return statusToken !== 'approved' && statusToken !== 'aprovado';
        })
        .sort((a, b) => {
          const aTime = Date.parse(String(a.created_at ?? '')) || 0;
          const bTime = Date.parse(String(b.created_at ?? '')) || 0;
          return bTime - aTime;
        });

      const grouped: Record<string, QuotationItemRow[]> = {};
      for (const item of items) {
        const key = String(item.order_id ?? '').trim();
        if (!key) continue;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
        const saleKey = `venda:${key}`;
        if (!grouped[saleKey]) grouped[saleKey] = [];
        grouped[saleKey].push(item);
      }

      setQuotationRows(quotations);
      setQuotationItemsByOrderId(grouped);
    } catch (error) {
      handleSupabaseError(error, 'loadQuotations');
      showToast('Não foi possível carregar as cotações.', 'error');
      setQuotationRows([]);
      setQuotationItemsByOrderId({});
    } finally {
      setIsQuotationLoading(false);
    }
  };

  const handleLoadQuotation = (quotation: QuotationRow) => {
    const orderId = String(quotation.id);
    const sourceItems = quotationItemsByOrderId[orderId] ?? [];
    if (sourceItems.length === 0) {
      showToast('Esta cotação não possui itens.', 'error');
      return;
    }

    const nextCartMap = new Map<string, CartItem>();
    for (const [index, item] of sourceItems.entries()) {
      const itemProductId = String(item.product_id ?? '').trim();
      const itemName = String(item.product_name ?? '').trim() || `Item ${index + 1}`;
      const matchedProduct =
        products.find((product) => String(product.id) === itemProductId) ??
        products.find((product) => product.name.trim().toLowerCase() === itemName.toLowerCase()) ??
        null;

      const baseId = (matchedProduct?.id ?? itemProductId) || `cotacao-${orderId}-${index}`;
      const unitPrice = Number(item.price ?? matchedProduct?.price ?? 0);
      const quantity = Number(item.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;

      const cartItem: CartItem = {
        ...(matchedProduct ?? {
          id: baseId,
          name: itemName,
          price: Number.isFinite(unitPrice) ? unitPrice : 0,
          category: 'Cotação',
        }),
        id: baseId,
        name: itemName,
        price: Number.isFinite(unitPrice) ? unitPrice : 0,
        quantity,
      };

      const existing = nextCartMap.get(baseId);
      if (existing) {
        nextCartMap.set(baseId, { ...existing, quantity: existing.quantity + quantity });
      } else {
        nextCartMap.set(baseId, cartItem);
      }
    }

    const nextCart = Array.from(nextCartMap.values());
    if (nextCart.length === 0) {
      showToast('Não há itens válidos nesta cotação.', 'error');
      return;
    }

    const restockMap = new Map<string, number>();
    for (const item of cart) {
      if (item.is_service) continue;
      restockMap.set(item.id, (restockMap.get(item.id) ?? 0) + item.quantity);
    }

    const reserveMap = new Map<string, number>();
    for (const item of nextCart) {
      if (item.is_service) continue;
      reserveMap.set(item.id, (reserveMap.get(item.id) ?? 0) + item.quantity);
    }

    if (restockMap.size > 0 || reserveMap.size > 0) {
      setProducts((prev) =>
        prev.map((product) => {
          const restock = restockMap.get(product.id) ?? 0;
          const reserve = reserveMap.get(product.id) ?? 0;
          if (restock === 0 && reserve === 0) return product;
          return { ...product, stock_quantity: Number(product.stock_quantity ?? 0) + restock - reserve };
        })
      );
    }

    const customerId = String(quotation.customer_id ?? '').trim();
    const customerLabel = String(quotation.client_name ?? '').trim();
    const customerFromQuotation =
      customers.find((customer) => customerId && String(customer.id) === customerId) ??
      customers.find((customer) => customerId && String(customer.cloud_id ?? '') === customerId) ??
      customers.find((customer) => customerLabel && customer.name.trim().toLowerCase() === customerLabel.toLowerCase()) ??
      null;

    setCart(nextCart);
    setSelectedCartItemId(null);
    setSelectedCustomer(customerFromQuotation);
    setCustomerName(customerFromQuotation?.name ?? customerLabel);
    setGlobalDiscount(null);
    setDocType('VD');
    setFinalizedDocType('VD');
    setIsSaleFinalized(false);
    setCurrentReceiptNumber(null);
    setPaymentMethod(null);
    setReceivedAmount('');
    setPayments([]);
    setIsMultiplePayment(false);
    setMultiplePaymentAmount('');
    setLoadedQuotationSource({
      sourceId: orderId,
      sourceType: orderId.startsWith('venda:') ? 'sale' : 'order',
    });
    setIsQuotationModalOpen(false);
    showToast('Cotação carregada para o carrinho.', 'success');
  };

  const handleOpenQuotationModal = () => {
    setIsQuotationModalOpen(true);
    void loadQuotations();
  };

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

  const resetForNewSale = () => {
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
    setIsReceiptModalOpen(false);
  };

  const handleReceiptPrimaryAction = () => {
    if (isSaleFinalized) {
      resetForNewSale();
      return;
    }
    setIsReceiptModalOpen(false);
  };

  const handleReceiptPrint = async (options?: {
    saleFinalized?: boolean;
    docTypeOverride?: 'VD' | 'TK' | 'FP' | 'FT';
    receiptNumber?: string | null;
    silentOnly?: boolean;
  }) => {
    const saleFinalized = options?.saleFinalized ?? isSaleFinalized;
    const printMarkup = buildPrintReceiptMarkup(options);
    const estimatedHeightMm = Math.max(
      34,
      66 + (cart.length * 9) + (saleFinalized ? (payments.length > 0 ? payments.length * 7 : 14) + 20 : 0)
    );

    const printSettings = loadPosSettings();
    const widthMm = resolveThermalWidthMm(printSettings.printPaperWidth);
    const heightMm = Math.max(estimatedHeightMm + 20, 120);
    const printHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Recibo</title>
    <style>${buildThermalPrintPageCss(widthMm, {
      top: printSettings.printMarginTop,
      right: printSettings.printMarginRight,
      bottom: printSettings.printMarginBottom,
      left: printSettings.printMarginLeft,
    })}</style>
  </head>
  <body>${printMarkup}</body>
</html>`;

    if (window.electronAPI?.printReceipt) {
      const printOptions = {
        printer: printSettings.printJobs?.receipt?.printer || undefined,
        copies: printSettings.printCopies,
        widthMm,
        heightMm,
      };
      // Finalizar venda: toast imediato — não esperar a impressora (a notificação não atrasa o envio).
      if (options?.silentOnly) {
        const printerLabel =
          printSettings.printJobs?.receipt?.printer || 'a impressora';
        showToast(`Recibo enviado para ${printerLabel}.`, 'success');
        void window.electronAPI.printReceipt(printHtml, printOptions).then((result) => {
          if (result && result.success === false && result.error) {
            showToast(`Impressão falhou (${result.error}).`, 'info');
          }
        }).catch(() => {
          showToast('Falha na impressão silenciosa.', 'info');
        });
        return true;
      }
      try {
        const result = await window.electronAPI.printReceipt(printHtml, printOptions);
        if (result?.success) {
          showToast(
            `Recibo enviado para ${result.printer || printSettings.printJobs?.receipt?.printer || 'a impressora'}.`,
            'success',
          );
          return true;
        }
        if (result?.error) {
          showToast(
            `Impressão silenciosa indisponível (${result.error}). A abrir fallback manual...`,
            'info'
          );
        }
      } catch {
        showToast(
          'Falha na impressão silenciosa. A abrir fallback manual...',
          'info',
        );
      }
    } else if (options?.silentOnly) {
      return false;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute(
      'style',
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;margin:0;padding:0;opacity:0;pointer-events:none;'
    );
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const removeIframe = () => {
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
    };

    const onLoad = () => {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) {
        removeIframe();
        return;
      }

      const runPrint = () => {
        const receipt = doc.querySelector<HTMLElement>('.print-receipt');
        const styleTag = doc.getElementById('page-size-style');
        if (receipt && styleTag) {
          const px = Math.max(receipt.scrollHeight, receipt.offsetHeight);
          const mm = Math.max(28, Math.ceil((px * 25.4) / 96));
          styleTag.textContent = `@page { size: ${widthMm}mm ${mm}mm; margin: 0 !important; }`;
        }
        void doc.body?.offsetHeight;

        const fallbackRemove = window.setTimeout(removeIframe, 120000);
        const done = () => {
          window.clearTimeout(fallbackRemove);
          window.setTimeout(removeIframe, 150);
        };
        win.addEventListener('afterprint', done, { once: true });

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            win.print();
          });
        });
      };

      if (doc.fonts?.ready) {
        doc.fonts.ready.then(runPrint).catch(runPrint);
      } else {
        runPrint();
      }
    };

    iframe.addEventListener('load', onLoad, { once: true });
    iframe.srcdoc = printHtml;
    return true;
  };

  if (!isAuthRestored) return null; // Prevent flicker

  if (licenseExpired) {
    return (
      <LicenseExpiredScreen
        tenantName={tenantName}
        expiresAt={expiresAt}
        onRevalidate={async () => {
          clearLicenseExpired();
        }}
      />
    );
  }

  if (isSetupLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#121212] text-zinc-200">
        <div className="rounded border border-zinc-800 bg-zinc-900/80 px-6 py-4 text-sm">
          A preparar configuração inicial...
        </div>
      </div>
    );
  }

  if (setupStatus && !setupStatus.isSetupComplete) {
    return (
      <SetupWizard
        status={setupStatus}
        onCompleted={async () => {
          logout();
          await refreshSetupStatus();
          await refreshActivationState();
          await fetchUsers();
        }}
      />
    );
  }

  if (setupStatus?.isSetupComplete) {
    if (isActivationLoading) {
      return (
        <div className="flex h-screen items-center justify-center bg-[#121212] text-zinc-200">
          <div className="rounded border border-zinc-800 bg-zinc-900/80 px-6 py-4 text-sm">
            A validar ativação da licença...
          </div>
        </div>
      );
    }

    if (!activationState?.isActivated) {
      return (
        <ActivationScreen
          activationCode={activationState?.activationCode || ''}
          machineId={activationState?.machineId || ''}
          reason={activationState?.reason || null}
          isSubmitting={isActivatingLicense}
          onRefresh={async () => {
            await refreshActivationState();
          }}
          onActivate={async (licenseKey) => {
            if (!window.electronAPI?.activateLicense) {
              throw new Error('Ativação disponível apenas na app Electron.');
            }
            setIsActivatingLicense(true);
            try {
              const result = await window.electronAPI.activateLicense(licenseKey);
              if (!result?.success) {
                throw new Error(result?.error || 'Falha ao ativar licença.');
              }
              await refreshActivationState();
            } finally {
              setIsActivatingLicense(false);
            }
          }}
          onRestartNow={async () => {
            if (!window.electronAPI?.restartApp) {
              window.location.reload();
              return;
            }
            const result = await window.electronAPI.restartApp();
            if (!result?.success) {
              throw new Error(result?.error || 'Falha ao reiniciar aplicação.');
            }
          }}
        />
      );
    }
  }

  if (!isLoggedIn || (setupStatus && !setupStatus.adminPasswordSet)) {
    return (
      <LoginScreen 
        users={users}
        selectedUser={selectedLoginUser}
        onSelectUser={setSelectedLoginUser}
        password={loginPassword}
        setPassword={setLoginPassword}
        onLogin={login}
        error={loginError}
        requiresAdminPasswordSetup={Boolean(setupStatus && !setupStatus.adminPasswordSet)}
        onAdminPasswordConfigured={async () => {
          await refreshSetupStatus();
          await fetchUsers();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#121212] text-zinc-300 font-sans selection:bg-emerald-500/30">
      {!isConfigured && (
        <div className="bg-amber-700/90 text-white text-[10px] font-bold py-1 px-4 text-center z-[9999]">
          Sync cloud desactivado: configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para sincronizar com a nuvem. As vendas funcionam offline.
        </div>
      )}
      
      {/* --- Top Header --- */}
      <Header
        selectedCustomerName={selectedCustomer?.name ?? null}
        selectedTableId={selectedTableId}
        salesMode={salesMode}
        onOpenCustomer={() => setIsCustomerModalOpen(true)}
        onOpenDiscount={() => setIsDiscountModalOpen(true)}
        onOpenQuotation={handleOpenQuotationModal}
        onOpenTable={openTableModal}
        onOpenAdminSidebar={() => setIsAdminSidebarOpen(true)}
        userName={currentUser?.name ?? null}
        onLogout={logout}
      />

      <main className="flex flex-1 overflow-hidden">
        <ProductList
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchSubmit={handleSearchSubmit}
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
            const currentDocType = docType === 'FT' ? 'VD' : docType;
            const nextIndex = (types.indexOf(currentDocType) + 1) % types.length;
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
              showToast('Não existe nada no carrinho de compra', 'error');
            } else {
              setIsCancelModalOpen(true);
            }
          }}
          onOpenPayment={() => {
            if (cart.length <= 0) return;
            setPaymentFinalizeError(null);
            setIsPaymentModalOpen(true);
          }}
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
                      setAllowStockOverrideOnCheckout(true);
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

      <QuotationModal
        isOpen={isQuotationModalOpen}
        onClose={() => setIsQuotationModalOpen(false)}
        quotations={quotationRows}
        isLoading={isQuotationLoading}
        onReload={() => {
          void loadQuotations();
        }}
        onLoadQuotation={handleLoadQuotation}
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
          if (isFinalizingPayment) return;
          setIsPaymentModalOpen(false);
          setPaymentMethod(null);
          setReceivedAmount('');
          setPayments([]);
          setIsMultiplePayment(false);
          setPaymentFinalizeError(null);
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
        paymentMethods={paymentMethods}
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
        isFinalizing={isFinalizingPayment}
        finalizeError={paymentFinalizeError}
        isReceiptPrintEnabled={isReceiptPrintEnabled}
        onToggleReceiptPrint={() => setIsReceiptPrintEnabled((prev) => !prev)}
        formatPrice={formatPrice}
        docType={docType}
      />

      <ReceiptPreview
        isOpen={isReceiptModalOpen}
        isSaleFinalized={isSaleFinalized}
        docType={isSaleFinalized ? finalizedDocType : docType}
        nextVDNumber={nextVDNumber}
        currentReceiptNumber={currentReceiptNumber}
        selectedCustomer={selectedCustomer}
        currentUserName={currentUser?.name || null}
        cart={cart}
        originalSubtotal={originalSubtotal}
        discountNet={Math.max(0, originalSubtotal - subtotal)}
        tax={tax}
        total={total}
        isMultiplePayment={isMultiplePayment}
        paymentMethod={paymentMethod}
        receivedAmount={receivedAmount}
        payments={payments}
        formatDocumentNumber={formatDocumentNumber}
        paymentLabel={paymentLabel}
        isCashPaymentMethod={isCashPaymentMethod}
        companyProfile={companyProfile}
        onPrimaryAction={handleReceiptPrimaryAction}
        onPrint={() => {
          void handleReceiptPrint();
        }}
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
        onGoToManagement={() => {
          void flushDraftNow().finally(() => {
            router.push('/management');
          });
        }}
        onOpenSalesHistory={() => {
          setIsAdminSidebarOpen(false);
          setIsSalesHistoryOpen(true);
        }}
        onOpenEndOfDay={() => {
          setIsAdminSidebarOpen(false);
          setIsEndOfDayOpen(true);
        }}
        onLogout={() => {
          void clearDraftEverywhere();
          localStorage.setItem('isLoggedIn', 'false');
          localStorage.removeItem('currentUser');
          window.dispatchEvent(new Event('pos-auth-changed'));
          setIsLoggedIn(false);
          setCurrentUser(null);
          setIsAdminSidebarOpen(false);
        }}
      />

      <EndOfDayModal
        isOpen={isEndOfDayOpen}
        onClose={() => setIsEndOfDayOpen(false)}
        companyName={companyProfile?.name || 'POSly'}
        onToast={showToast}
      />

      <SalesHistoryModal isOpen={isSalesHistoryOpen} onClose={() => setIsSalesHistoryOpen(false)} />

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
                  <h2 className="text-lg font-bold text-white capitalize tracking-tight">Operações de Caixa: Caixa 1</h2>
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
                  Registar relógio de ponto
                </button>
                <button 
                  className="flex-1 h-14 rounded border border-zinc-800 bg-[#121212] text-white font-medium text-sm leading-tight capitalize transition-all hover:border-zinc-700 hover:bg-zinc-800/70"
                >
                  Transferir vendas ativas
                </button>
                <button 
                  className="flex-1 h-14 rounded border border-zinc-800 bg-[#121212] text-white font-medium text-sm leading-tight capitalize transition-all hover:border-zinc-700 hover:bg-zinc-800/70"
                >
                  Transferência de turno
                </button>
              </div>

              {/* Footer Inputs */}
              <div className="p-4 bg-[#121212] border-t border-zinc-800 grid grid-cols-3 gap-6">
                <div className="flex flex-col gap-1">
                  <label className="text-xs md:text-sm font-bold text-zinc-500 capitalize">Impressora</label>
                  <PosSelect
                    value={cashierPrinter}
                    onChange={setCashierPrinter}
                    size="md"
                    triggerClassName="!bg-zinc-800 !border-zinc-700"
                    options={[
                      { value: 'Impressora do evento', label: 'Impressora do evento' },
                      { value: 'Impressora térmica', label: 'Impressora térmica' },
                    ]}
                  />
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
