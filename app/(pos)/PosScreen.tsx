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
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Activity,
  Sliders
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PosToast from '@/components/PosToast';
import { isConfigured } from '@/lib/supabase';
import { getPosApiBase } from '@/lib/apiBase';
import { POS_DRAFT_SCHEMA_VERSION, clearPosDraft, type PosDraftSnapshot } from '@/lib/posDraftStorage';
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
import { EndOfDayModal } from '@/app/pos/components/EndOfDayModal';
import { CashMovementModal } from '@/app/pos/components/CashMovementModal';
import { ensureCashSession } from '@/lib/cashSession';
import { formatPaymentMethodLabel } from '@/lib/paymentMethodLabel';
import { SalesHistoryModal } from '@/app/pos/components/SalesHistoryModal';
import { QuotationModal } from '@/app/pos/components/QuotationModal';
import { StockZeroModal } from '@/app/pos/components/StockZeroModal';
import { MinStockAlertModal } from '@/app/pos/components/MinStockAlertModal';
import { DiscountModal } from '@/app/pos/components/DiscountModal';
import { QuantityModal } from '@/app/pos/components/QuantityModal';
import { ItemNotesModal } from '@/app/pos/components/ItemNotesModal';
import { CancelOrderModal } from '@/app/pos/components/CancelOrderModal';
import { LoginScreen } from '@/app/pos/components/LoginScreen';
import { useCart } from '@/hooks/useCart';
import { useCustomerDisplay } from '@/hooks/useCustomerDisplay';
import { usePosDraftPersistence } from '@/hooks/usePosDraftPersistence';
import { loadPosSettings, savePosSettings, syncReceiptPrinterToServer } from '@/lib/posSettings';
import { openCashDrawerIfNeeded } from '@/lib/cashDrawerClient';
import { resolveThermalWidthMm } from '@/lib/thermalPrintPage';
import { submitKitchenOrder } from '@/lib/kitchenOrder';
import { useProducts } from '@/hooks/useProducts';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import {
  createOrder,
  deleteCustomer,
  fetchCustomers as posFetchCustomers,
  fetchProducts as posFetchProducts,
  fetchCategories as posFetchCategories,
  fetchSetupStatus as posFetchSetupStatus,
  fetchLoginUsers as posFetchUsers,
  fetchPaymentMethods as posFetchPaymentMethods,
  acknowledgeLicenseFileOnServer,
  redeemReactivationTokenOnServer,
  resetLocalLicenseOnServer,
  initializeFromSerial,
  lookupSerialStores,
  fetchCompanyProfile,
  PosApiError,
  saveCustomer,
  syncNextVDNumber as posSyncNextVDNumber,
  type SetupStatusPayload,
} from '@/lib/services/posService';
import {
  applyCatalogCacheToPosHandlers,
  buildFamilyColorsFromCategories,
  CATALOG_CHANGED_EVENT,
  notifyCatalogChanged,
} from '@/lib/catalogLocalSync';
import { isSupplierPartyRecord, readPartyMetaById, type PartyMeta } from '@/lib/partyMeta';
import {
  clearPosCatalogCache,
  clearPosSessionCache,
  getCachedActivationState,
  getCachedLocationsTables,
  getCachedLoginUsers,
  getCachedSetupStatus,
  getPosCatalogCache,
  setCachedActivationState,
  setCachedCategories,
  setCachedLoginUsers,
  setCachedSetupStatus,
  setPosCatalogCache,
  getCachedPosWorkspace,
  setCachedPosWorkspace,
} from '@/lib/posSessionCache';
import LicenseExpiredScreen from '@/components/LicenseExpiredScreen';
import { useLicenseGuard } from '@/components/LicenseGuardProvider';
import { isReactivationTokenInput } from '@/lib/licensing/reactivationToken.js';
import { tryParseSerialFormat } from '@/lib/licensing/serialNumber.js';
import { TableFloorPanel } from '@/app/pos/components/TableFloorPanel';
import { PosStatusFooter } from '@/app/pos/components/PosStatusFooter';
import { useCommerceProfile } from '@/lib/useCommerceProfile';
import { releaseTableLock } from '@/lib/tableLocks';
import { readPosFloorContext, writePosFloorContext } from '@/lib/posFloorContext';
import { loadStationClientSettings } from '@/lib/stationClientSettings';
import {
  fetchSharedTableOrders,
  saveSharedTableOrder,
} from '@/lib/sharedTableOrders';
import { useSharedTableOrdersSync } from '@/hooks/useSharedTableOrdersSync';
import { useTableFloor } from '@/hooks/useTableFloor';
import { useFamiliesDragScroll } from '@/hooks/useFamiliesDragScroll';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useCartStockOps } from '@/hooks/useCartStockOps';
import { formatDocumentNumber, useReceiptPrint } from '@/hooks/useReceiptPrint';
import { useDiscountForm } from '@/hooks/useDiscountForm';
import { useQuotations } from '@/hooks/useQuotations';
import { useTableOrderSession } from '@/hooks/useTableOrderSession';
import SetupWizard from '@/components/SetupWizard';
import ActivationScreen from '@/components/ActivationScreen';
import {
  DEFAULT_TABLE_IDS,
  FALLBACK_PAYMENT_METHODS,
  handleSupabaseError,
  isPosUiBootstrapped,
  markPosUiBootstrapped,
  normalizeUnknownError,
  type ActivationStatePayload,
  type RouteProps,
} from './posScreen.helpers';

export default function POSPage({ params, searchParams }: RouteProps) {
  // Next 16 passes route props as Promises in app router.
  // Explicitly unwrapping avoids sync dynamic API warnings in dev overlays.
  use(params);
  use(searchParams);
  const router = useRouter();
  const { licenseExpired, tenantName, expiresAt, refreshLicenseStatus } =
    useLicenseGuard();
  const { features: commerceFeatures, commerceType } = useCommerceProfile();
  const [products, setProducts] = useState<Product[]>(() => getPosCatalogCache()?.products ?? []);
  const [customers, setCustomers] = useState<Customer[]>(() => getPosCatalogCache()?.customers ?? []);
  const [familyColors, setFamilyColors] = useState<Record<string, string>>(
    () => getPosCatalogCache()?.familyColors ?? {}
  );
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>(
    () => getPosCatalogCache()?.paymentMethods ?? []
  );
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(
    () => getPosCatalogCache()?.companyProfile ?? null
  );
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

  // Item notes (cozinha) Modal State
  const [isItemNotesModalOpen, setIsItemNotesModalOpen] = useState(false);
  const [notesEditingItem, setNotesEditingItem] = useState<CartItem | null>(null);
  const [tempItemNotes, setTempItemNotes] = useState('');

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
  const [isFinalizingPayment, setIsFinalizingPayment] = useState(false);
  const [paymentFinalizeError, setPaymentFinalizeError] = useState<string | null>(null);
  const [allowStockOverrideOnCheckout, setAllowStockOverrideOnCheckout] = useState(false);

  const [globalDiscount, setGlobalDiscount] = useState<{type: 'value' | 'percentage', amount: number} | null>(null);

  // Customer Modal State
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isSaleFinalized, setIsSaleFinalized] = useState(false);
  const [users, setUsers] = useState<PosUser[]>(() => getCachedLoginUsers() ?? []);
  const [setupStatus, setSetupStatus] = useState<SetupStatusPayload | null>(
    () => getCachedSetupStatus()
  );
  const [isSetupLoading, setIsSetupLoading] = useState(() => !isPosUiBootstrapped() && !getCachedSetupStatus());
  const [setupRevalidating, setSetupRevalidating] = useState(false);
  const [activationState, setActivationState] = useState<ActivationStatePayload | null>(
    () => getCachedActivationState()
  );
  const [isActivationLoading, setIsActivationLoading] = useState(
    () => !isPosUiBootstrapped() && !getCachedActivationState()
  );
  const [isActivatingLicense, setIsActivatingLicense] = useState(false);
  const [isRevalidatingLicense, setIsRevalidatingLicense] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '' });
  const [customerSearch, setCustomerSearch] = useState('');
  const [partyMetaById, setPartyMetaById] = useState<Record<string, PartyMeta>>({});
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
  const [isCashMovementOpen, setIsCashMovementOpen] = useState(false);

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
  const { can, denyMessage } = usePermissions(currentUser?.accessLevel);
  const [nextVDNumber, setNextVDNumber] = useState(1);
  const [currentReceiptNumber, setCurrentReceiptNumber] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
    id: number;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [salesMode, setSalesMode] = useState<'customer' | 'table'>(
    () => getCachedPosWorkspace()?.salesMode ?? 'customer'
  );
  const [docType, setDocType] = useState<'VD' | 'TK' | 'FP' | 'FT'>(
    () => getCachedPosWorkspace()?.docType ?? 'VD'
  );
  const [finalizedDocType, setFinalizedDocType] = useState<'VD' | 'TK' | 'FP' | 'FT'>('VD');
  const [loadedQuotationSource, setLoadedQuotationSource] = useState<{ sourceId: string; sourceType: 'order' | 'sale' } | null>(null);
  const [tableOrders, setTableOrders] = useState<{[key: string]: { cart: CartItem[], globalDiscount: {type: 'value' | 'percentage', amount: number} | null, selectedCustomer: Customer | null, docType: 'VD' | 'TK' | 'FP' | 'FT' }}>({});
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableLabels, setTableLabels] = useState<Record<string, string>>({});
  const [posTableIds, setPosTableIds] = useState<string[]>(
    () => getCachedLocationsTables()?.tableIds ?? DEFAULT_TABLE_IDS
  );
  const [posTablesSummary, setPosTablesSummary] = useState(
    () => getCachedLocationsTables()?.tablesSummary ?? '1:20'
  );
  const [allowTableCustomNames, setAllowTableCustomNames] = useState(
    () => getCachedLocationsTables()?.allowCustomNames ?? false
  );
  const tableOrderUpdatedAtRef = useRef<Record<string, string>>({});
  const floorCurrentOrder = useMemo(
    () => ({ cart, globalDiscount, selectedCustomer, docType }),
    [cart, globalDiscount, selectedCustomer, docType],
  );
  const { isTableFloorOpen, setIsTableFloorOpen, activeLocationId, floorLocations, selectLocation, refreshLocations, resumeFloorAfterLogin } = useTableFloor({
    tablesEnabled: commerceFeatures.tables,
    selectedTableId,
    currentOrder: floorCurrentOrder,
    setTableOrders,
    setPosTableIds,
    setPosTablesSummary,
    setAllowTableCustomNames,
    tableOrderUpdatedAtRef,
  });
  const floorRestoreDoneRef = useRef(false);
  const tableNumberLabels = useMemo(() => {
    const location = floorLocations.find((row) => String(row.id) === String(activeLocationId));
    if (!location) return {} as Record<string, string>;
    return Object.fromEntries(
      location.tables.map((table) => [String(table.name), String(table.displayName || table.name)]),
    );
  }, [activeLocationId, floorLocations]);
  const currentDate = useMemo(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  }, []);
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);
  const clearDraftEverywhereRef = useRef<() => void>(() => {});

  // Stock Modal State
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [minStockAlert, setMinStockAlert] = useState<{ name: string; quantity: number } | null>(null);

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

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ message, type, id: Date.now() });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 6000);
  };

  const requireAccess = useCallback(
    (key: string, label: string) => {
      if (can(key)) return true;
      showToast(denyMessage(label), 'error');
      return false;
    },
    [can, denyMessage],
  );

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' MT';
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
      return formatPaymentMethodLabel(method?.name ?? methodCode, String(methodCode));
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
  // --- Calculations ---
  const { originalTotal, originalSubtotal, totalDiscount, total, subtotal, tax } = useCart(cart, globalDiscount);
  useCustomerDisplay({
    cart,
    total,
    isPaymentOpen: isPaymentModalOpen,
    isSaleFinalized,
  });

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

  const {
    familiesScrollRef,
    familiesDragStateRef,
    handleFamiliesPointerDown,
    handleFamiliesPointerMove,
    handleFamiliesPointerRelease,
  } = useFamiliesDragScroll();

  const { addToCart, executeAddToCart, removeFromCart, updateQuantity, clearCart } = useCartStockOps({
    cart,
    setCart,
    products,
    setProducts,
    selectedCartItemId,
    setSelectedCartItemId,
    setSelectedCategory,
    setPendingProduct,
    setIsStockModalOpen,
    setMinStockAlert,
    setGlobalDiscount,
    setPaymentMethod,
    setReceivedAmount,
    setPayments,
    setIsMultiplePayment,
    setMultiplePaymentAmount,
    setAllowStockOverrideOnCheckout,
    setPaymentFinalizeError,
    setIsFinalizingPayment,
    checkoutIdempotencyKeyRef,
    setSelectedCustomer,
    setCustomerName,
    setCurrentReceiptNumber,
    setDocType,
    setFinalizedDocType,
    setLoadedQuotationSource,
    selectedTableId,
    setTableOrders,
    clearDraftEverywhereRef,
    showToast,
  });

  const { handleSearchSubmit } = useBarcodeScanner({
    isLoggedIn,
    products,
    searchQuery,
    setSearchQuery,
    addToCart,
    showToast,
  });

  const {
    isDiscountModalOpen,
    setIsDiscountModalOpen,
    discountType,
    setDiscountType,
    discountAmount,
    setDiscountAmount,
    discountTarget,
    setDiscountTarget,
    applyDiscount,
    previewDiscount,
  } = useDiscountForm({
    cart,
    setCart,
    setGlobalDiscount,
    selectedCartItemId,
    originalTotal,
  });

  const {
    isQuotationModalOpen,
    setIsQuotationModalOpen,
    quotationRows,
    isQuotationLoading,
    loadQuotations,
    handleLoadQuotation,
    handleOpenQuotationModal,
  } = useQuotations({
    cart,
    products,
    customers,
    setCart,
    setProducts,
    setSelectedCartItemId,
    setSelectedCustomer,
    setCustomerName,
    setGlobalDiscount,
    setDocType,
    setFinalizedDocType,
    setIsSaleFinalized,
    setCurrentReceiptNumber,
    setPaymentMethod,
    setReceivedAmount,
    setPayments,
    setIsMultiplePayment,
    setMultiplePaymentAmount,
    setLoadedQuotationSource,
    showToast,
  });

  const { handleTableSelect } = useTableOrderSession({
    cart,
    globalDiscount,
    selectedCustomer,
    docType,
    selectedTableId,
    tableOrders,
    tableOrderUpdatedAtRef,
    setTableOrders,
    setSalesMode,
    setSelectedTableId,
    setTableLabels,
    setCart,
    setGlobalDiscount,
    setSelectedCustomer,
    setDocType,
    setIsTableFloorOpen,
    showToast,
  });

  const resetForNewSale = useCallback(() => {
    if (selectedTableId) {
      void releaseTableLock(selectedTableId);
    }
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
  }, [
    clearCart,
    selectedTableId,
    setCustomerName,
    setCurrentReceiptNumber,
    setGlobalDiscount,
    setIsMultiplePayment,
    setIsReceiptModalOpen,
    setIsSaleFinalized,
    setMultiplePaymentAmount,
    setPaymentMethod,
    setPayments,
    setReceivedAmount,
    setSelectedCustomer,
    setTableNumber,
  ]);

  const {
    receiptPreparedRef,
    buildThermalReceiptHtml,
    handleReceiptPrint,
    handleReceiptPrimaryAction,
  } = useReceiptPrint({
    cart,
    isSaleFinalized,
    finalizedDocType,
    currentReceiptNumber,
    nextVDNumber,
    selectedCustomer,
    currentUser,
    companyProfile,
    paymentMethod,
    receivedAmount,
    payments,
    isMultiplePayment,
    total,
    subtotal,
    tax,
    totalDiscount,
    originalSubtotal,
    isPaymentModalOpen,
    isReceiptPrintEnabled,
    isCashPaymentMethod,
    paymentLabel,
    estimateCheckoutDocType,
    showToast,
    setIsReceiptModalOpen,
    onResetForNewSale: resetForNewSale,
  });

  const fetchUsers = useCallback(async (options?: { bypassLicenseBlock?: boolean }) => {
    if (licenseExpired && !options?.bypassLicenseBlock) return;
    try {
      const data = await posFetchUsers();

      if (data && data.length > 0) {
        const list = data as PosUser[];
        setUsers(list);
        setCachedLoginUsers(list);
        setSelectedLoginUser((previous) =>
          list.find((user) => user.id === previous?.id) ?? list[0]
        );
      } else {
        setUsers([]);
        setCachedLoginUsers([]);
        setSelectedLoginUser(null);
      }
    } catch (error) {
      if (
        error instanceof PosApiError &&
        error.status === 403 &&
        /licen[cç]a\s+expirada/i.test(error.message)
      ) {
        return;
      }
      const cached = getCachedLoginUsers();
      if (cached && cached.length > 0) {
        setUsers(cached);
        setSelectedLoginUser((previous) =>
          cached.find((user) => user.id === previous?.id) ?? cached[0]
        );
        return;
      }
      handleSupabaseError(error, 'fetchUsers');
      setUsers([]);
      setSelectedLoginUser(null);
    }
  }, [licenseExpired, setSelectedLoginUser]);

  const refreshSetupStatus = useCallback(async (options?: { skipRegistrySync?: boolean }) => {
    try {
      const status = await posFetchSetupStatus({
        skipRegistrySync: options?.skipRegistrySync ?? isPosUiBootstrapped(),
      });
      setSetupStatus(status);
      setCachedSetupStatus(status);
      if (status?.isSetupComplete) {
        markPosUiBootstrapped();
      }
      return status;
    } catch {
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
      setCachedActivationState(fallback);
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
      setCachedActivationState(normalized);
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
      setCachedActivationState(failed);
      return failed;
    } finally {
      setIsActivationLoading(false);
    }
  }, []);

  const handleElectronLicenseActivate = useCallback(
    async (licenseKey: string) => {
      setIsActivatingLicense(true);
      try {
        const serial = tryParseSerialFormat(licenseKey);
        if (serial) {
          // Não bloquear por lookup.redeemed: após desvincular na consola o activate
          // é a fonte de verdade. O flag redeemed gerava falso "Licença em uso".
          const lookup = await lookupSerialStores(serial);
          const stores = Array.isArray(lookup?.stores) ? lookup.stores : [];
          const tenantId = String(stores[0]?.tenant_id ?? '').trim();
          if (!tenantId) {
            throw new Error(
              lookup?.redeemed
                ? 'Esta licença parece ligada noutro sítio. Confirme o desvínculo na consola e tente de novo.'
                : 'Nenhuma loja encontrada para este número de série.',
            );
          }
          await initializeFromSerial({ serial, tenantId });
          try {
            await acknowledgeLicenseFileOnServer();
          } catch {
            // A escrita do ficheiro já activa a BD; ack é melhor esforço.
          }
        } else if (isReactivationTokenInput(licenseKey)) {
          const redeemData = await redeemReactivationTokenOnServer(licenseKey);
          const notify = redeemData?.ack?.issuerNotify;
          if (notify && notify.skipped === false && notify.ok === false && notify.error) {
            showToast(
              `Licença reativada; consola/Supabase: ${notify.error}`,
              'info',
            );
          }
        } else {
          if (!window.electronAPI?.activateLicense) {
            throw new Error('Ativação disponível apenas na app Electron.');
          }
          const result = await window.electronAPI.activateLicense(licenseKey);
          if (!result?.success) {
            throw new Error(result?.error || 'Falha ao ativar licença.');
          }
          try {
            const ackData = await acknowledgeLicenseFileOnServer();
            const notify = ackData?.issuerNotify;
            if (notify && notify.skipped === false && notify.ok === false && notify.error) {
              showToast(
                `Licença registada localmente; consola/Supabase: ${notify.error}`,
                'info',
              );
            }
          } catch (ackErr) {
            const msg =
              ackErr instanceof PosApiError
                ? ackErr.message
                : ackErr instanceof Error
                  ? ackErr.message
                  : 'Falha ao registar licença na API local.';
            throw new Error(
              `${msg} Se a API ainda estava a iniciar, aguarde uns segundos e use «Revalidar».`,
            );
          }
        }
        await refreshActivationState();
        await refreshSetupStatus();
        await refreshLicenseStatus({ syncRegistry: true });
        await fetchUsers({ bypassLicenseBlock: true });
      } finally {
        setIsActivatingLicense(false);
      }
    },
    [fetchUsers, licenseExpired, refreshActivationState, refreshLicenseStatus, refreshSetupStatus, showToast],
  );

  const handleRevalidateSetup = useCallback(async () => {
    setSetupRevalidating(true);
    try {
      const status = await refreshSetupStatus();
      if (!status) {
        showToast('Não foi possível obter o estado da configuração. Verifique se a API está a correr.', 'error');
        return;
      }
      if (!status.isSetupComplete) {
        showToast(
          'A configuração ainda não está marcada como concluída. Confirme tenant, base de dados e licença acima; reinicie a API se acabou de atualizar o código.',
          'info'
        );
      } else {
        showToast('Configuração revalidada com sucesso.', 'success');
      }
      await refreshActivationState();
      await fetchUsers();
    } catch {
      showToast('Erro ao revalidar a configuração.', 'error');
    } finally {
      setSetupRevalidating(false);
    }
  }, [refreshSetupStatus, refreshActivationState, fetchUsers, showToast]);

  useEffect(() => {
    void refreshSetupStatus({ skipRegistrySync: isPosUiBootstrapped() });
  }, [refreshSetupStatus]);

  useEffect(() => {
    void refreshActivationState().then((state) => {
      if (state?.isActivated) {
        markPosUiBootstrapped();
      }
    });
  }, [refreshActivationState]);

  // --- Effects ---
  useEffect(() => {
    if (!isAuthRestored || !isLoggedIn) return;
    let cancelled = false;

    void (async () => {
      try {
        const nextSequence = await posSyncNextVDNumber();
        if (cancelled) return;
        setNextVDNumber(Number(nextSequence) > 0 ? Number(nextSequence) : 1);
      } catch (error) {
        if (cancelled) return;
        // Sem sessão / 401: não poluir a consola — fica 1 até haver login válido.
        const status = Number((error as { status?: number })?.status ?? 0);
        const message = String((error as { message?: string })?.message ?? '');
        if (status === 401 || /unauthorized/i.test(message)) {
          setNextVDNumber(1);
          return;
        }
        handleSupabaseError(error, 'syncNextVDNumber');
        setNextVDNumber(1);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthRestored, isLoggedIn]);

  useEffect(() => {
    if (!isAuthRestored || licenseExpired) return;
    void fetchUsers();
  }, [isAuthRestored, licenseExpired, fetchUsers]);

  useEffect(() => {
    if (!isAuthRestored || !isLoggedIn) return;

    // Offline-first: aplicar cache local imediatamente (ex.: veio do Gerenciamento).
    applyCatalogCacheToPosHandlers({
      setProducts,
      setFamilyColors,
      setCustomers,
    });

    const fetchData = async () => {
      try {
        const [productsData, customersData, companyData, categoriesData, paymentMethodsData] =
          await Promise.all([
            posFetchProducts(),
            posFetchCustomers(),
            fetchCompanyProfile().catch(() => null),
            posFetchCategories().catch(() => []),
            posFetchPaymentMethods().catch(() => []),
          ]);

        const nextProducts = productsData || [];
        const nextCategories = Array.isArray(categoriesData) ? categoriesData : [];
        const colorMap = buildFamilyColorsFromCategories(nextCategories, nextProducts);

        setProducts(nextProducts);
        setFamilyColors(colorMap);
        setCustomers(customersData || []);
        setCompanyProfile(companyData);
        const normalizedMethods = Array.isArray(paymentMethodsData) && paymentMethodsData.length
          ? paymentMethodsData
          : FALLBACK_PAYMENT_METHODS;
        setPaymentMethods(normalizedMethods);
        if (nextCategories.length) {
          setCachedCategories(nextCategories);
        }
        setPosCatalogCache({
          products: nextProducts,
          customers: customersData || [],
          familyColors: colorMap,
          paymentMethods: normalizedMethods,
          companyProfile: companyData,
        });
        notifyCatalogChanged();
        const firstEnabledMethod = normalizedMethods.find((method) => method.enabled);
        if (firstEnabledMethod?.code) {
          setMultiplePaymentMethod(firstEnabledMethod.code);
        }
      } catch (error) {
        console.warn(
          'Erro ao carregar dados:',
          error instanceof Error ? error.message : String(error),
        );
        // Mantém cache local se a rede falhar — não limpar grelha.
        applyCatalogCacheToPosHandlers({
          setProducts,
          setFamilyColors,
          setCustomers,
        });
        if (!getPosCatalogCache()?.products?.length) {
          setProducts([]);
          setFamilyColors({});
          setCustomers([]);
          setCompanyProfile(null);
          setPaymentMethods(FALLBACK_PAYMENT_METHODS);
          clearPosCatalogCache();
        }
      }
    };

    void fetchData();

    const params = new URLSearchParams(window.location.search);
    if (params.get('sidebar') === 'open') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [isAuthRestored, isLoggedIn]);

  useEffect(() => {
    const refreshCompany = () => {
      void fetchCompanyProfile()
        .then(setCompanyProfile)
        .catch(() => setCompanyProfile(null));
    };
    window.addEventListener('company-profile-changed', refreshCompany);
    return () => window.removeEventListener('company-profile-changed', refreshCompany);
  }, []);

  // Gerenciamento publicou catálogo local → grelha actualiza sem esperar novo fetch.
  useEffect(() => {
    const onCatalogChanged = () => {
      applyCatalogCacheToPosHandlers({
        setProducts,
        setFamilyColors,
        setCustomers,
      });
    };
    window.addEventListener(CATALOG_CHANGED_EVENT, onCatalogChanged);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, onCatalogChanged);
  }, []);

  // Ao voltar do Gerenciamento / foco da janela: cache primeiro, reconcile em background.
  useEffect(() => {
    if (!isLoggedIn || !isAuthRestored) return;

    const refreshFromLocalApi = () => {
      applyCatalogCacheToPosHandlers({
        setProducts,
        setFamilyColors,
        setCustomers,
      });
      void (async () => {
        try {
          const [productsData, categoriesData] = await Promise.all([
            posFetchProducts(),
            posFetchCategories().catch(() => []),
          ]);
          const nextProducts = productsData || [];
          const nextCategories = Array.isArray(categoriesData) ? categoriesData : [];
          const colorMap = buildFamilyColorsFromCategories(nextCategories, nextProducts);
          setProducts(nextProducts);
          setFamilyColors(colorMap);
          if (nextCategories.length) setCachedCategories(nextCategories);
          const prev = getPosCatalogCache();
          setPosCatalogCache({
            products: nextProducts,
            customers: prev?.customers ?? [],
            familyColors: colorMap,
            paymentMethods: prev?.paymentMethods ?? [],
            companyProfile: prev?.companyProfile ?? null,
          });
        } catch {
          // ignore — mantém o que já está no ecrã/cache
        }
      })();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshFromLocalApi();
    };
    const onFocus = () => refreshFromLocalApi();

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isLoggedIn, isAuthRestored]);

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
    const resumeFloor = readPosFloorContext().resumeFloor;
    const draftTableId = d.selectedTableId ?? null;
    const nextCart = Array.isArray(d.cart) ? d.cart : [];
    const draftOrders =
      d.tableOrders && typeof d.tableOrders === 'object' ? { ...d.tableOrders } : {};

    // Logout → login: não reabrir a mesa no ecrã de produtos (evita flash).
    if (resumeFloor) {
      if (draftTableId && (nextCart.length > 0 || draftOrders[draftTableId])) {
        draftOrders[draftTableId] = draftOrders[draftTableId] ?? {
          cart: nextCart,
          globalDiscount: d.globalDiscount ?? null,
          selectedCustomer: d.selectedCustomer ?? null,
          docType: (d.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT',
        };
      }
      setTableOrders(draftOrders);
      setCart([]);
      setSelectedCustomer(null);
      setCustomerName('');
      setTableNumber('');
      setGlobalDiscount(null);
      setDocType((d.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT');
      setSalesMode('customer');
      setCachedPosWorkspace({
        docType: (d.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT',
        salesMode: 'customer',
      });
      setSelectedTableId(null);
      setSelectedCartItemId(null);
      setIsTableFloorOpen(true);
      void fetchSharedTableOrders().then((orders) => {
        if (!orders) return;
        setTableOrders((prev) => {
          const next = { ...prev };
          for (const [key, order] of Object.entries(orders)) {
            next[key] = {
              cart: Array.isArray(order.cart) ? order.cart : [],
              globalDiscount: order.globalDiscount ?? null,
              selectedCustomer: order.selectedCustomer ?? null,
              docType: (order.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT',
            };
          }
          return next;
        });
      });
      return;
    }

    setCart(nextCart);
    setSelectedCustomer(d.selectedCustomer ?? null);
    setCustomerName(typeof d.customerName === 'string' ? d.customerName : '');
    setTableNumber(typeof d.tableNumber === 'string' ? d.tableNumber : '');
    setGlobalDiscount(d.globalDiscount ?? null);
    setDocType((d.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT');
    setSalesMode(d.salesMode === 'table' ? 'table' : 'customer');
    setCachedPosWorkspace({
      docType: (d.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT',
      salesMode: d.salesMode === 'table' ? 'table' : 'customer',
    });
    setSelectedTableId(draftTableId);
    setTableOrders(draftOrders);
    const sid = typeof d.selectedCartItemId === 'string' ? d.selectedCartItemId : null;
    setSelectedCartItemId(sid && nextCart.some((item) => item.id === sid) ? sid : null);
    void fetchSharedTableOrders().then((orders) => {
      if (!orders) return;
      setTableOrders((prev) => {
        const next = { ...prev };
        for (const [key, order] of Object.entries(orders)) {
          if (key === draftTableId) continue;
          next[key] = {
            cart: Array.isArray(order.cart) ? order.cart : [],
            globalDiscount: order.globalDiscount ?? null,
            selectedCustomer: order.selectedCustomer ?? null,
            docType: (order.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT',
          };
        }
        return next;
      });
    });
  }, [setIsTableFloorOpen]);

  const { flushDraftNow, clearDraftEverywhere } = usePosDraftPersistence({
    enabled: Boolean(isLoggedIn && isAuthRestored),
    userId: currentUser?.id,
    paused: isSaleFinalized,
    buildSnapshot: buildPosDraftSnapshot,
    applyDraft: applyPosDraft,
  });

  useSharedTableOrdersSync({
    enabled: Boolean(isLoggedIn && isAuthRestored && commerceFeatures.tables),
    selectedTableId,
    salesMode,
    cart,
    globalDiscount,
    selectedCustomer,
    docType,
    setTableOrders,
    tableOrderUpdatedAtRef,
    applyActiveTableOrder: (order) => {
      setCart(order.cart);
      setGlobalDiscount(order.globalDiscount);
      setSelectedCustomer(order.selectedCustomer);
      setDocType(order.docType || 'VD');
    },
    onConflict: (message) => showToast(message, 'error'),
  });

  clearDraftEverywhereRef.current = () => {
    void clearDraftEverywhere();
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    // Enquanto a sessão está activa, memoriza local/mesa — sem mexer em resumeFloor.
    writePosFloorContext({
      locationId: activeLocationId,
      tableId: selectedTableId,
    });
  }, [activeLocationId, isLoggedIn, selectedTableId]);

  /**
   * Logout sem flash: grava o pedido de resume, limpa o rascunho ainda autenticado,
   * sai já para o login; grava/liberta a mesa em background.
   */
  const logoutFromPos = useCallback(() => {
    const ctx = readPosFloorContext();
    let locationId = activeLocationId || ctx.locationId;
    const leavingTableId = selectedTableId;
    const wasOnFloorOrTable = Boolean(leavingTableId || isTableFloorOpen);
    const orderSnapshot = {
      cart,
      globalDiscount,
      selectedCustomer,
      docType,
    };
    const expectedUpdatedAt = leavingTableId
      ? (tableOrderUpdatedAtRef.current[leavingTableId] ?? null)
      : null;
    const userId = currentUser?.id;

    if (leavingTableId) {
      const owner = floorLocations.find((location) =>
        location.tables.some((table) => String(table.name) === String(leavingTableId)),
      );
      if (owner) locationId = String(owner.id);
    }

    const resumeFloor = wasOnFloorOrTable;
    writePosFloorContext({
      locationId,
      // Mantém tableId para descobrir o local no próximo login se locationId falhar.
      tableId: leavingTableId || ctx.tableId,
      resumeFloor,
    });

    // Limpar rascunho local ainda com sessão (evita reabrir a mesa no próximo login).
    if (userId) {
      clearPosDraft(userId);
    }

    setIsAdminSidebarOpen(false);
    clearPosSessionCache();
    logout();

    // Atrás do ecrã de login (mesmo batch): próximo login já não pinta a mesa aberta.
    if (leavingTableId || resumeFloor) {
      setSelectedTableId(null);
      setSalesMode('customer');
      setCart([]);
      setGlobalDiscount(null);
      setSelectedCustomer(null);
      setSelectedCartItemId(null);
    }
    if (resumeFloor) {
      setIsTableFloorOpen(true);
    }

    // Background: pedido fica na mesa ocupada.
    if (leavingTableId) {
      void (async () => {
        const saveResult = await saveSharedTableOrder(leavingTableId, {
          ...orderSnapshot,
          expectedUpdatedAt,
        });
        if (saveResult.ok) {
          tableOrderUpdatedAtRef.current[leavingTableId] = saveResult.updatedAt;
        }
        await releaseTableLock(leavingTableId);
      })();
    }
  }, [
    activeLocationId,
    cart,
    currentUser?.id,
    docType,
    floorLocations,
    globalDiscount,
    isTableFloorOpen,
    logout,
    selectedCustomer,
    selectedTableId,
    setIsTableFloorOpen,
  ]);

  // Após login: grelha do local da mesa (sem flash / sem depender do rascunho).
  useEffect(() => {
    if (!isLoggedIn || !isAuthRestored || !commerceFeatures.tables) {
      if (!isLoggedIn) floorRestoreDoneRef.current = false;
      return;
    }
    if (floorRestoreDoneRef.current) return;
    floorRestoreDoneRef.current = true;

    const ctx = readPosFloorContext();
    if (!ctx.resumeFloor) {
      void refreshLocations();
      return;
    }

    // Estado limpo já no 1.º paint autenticado.
    setSelectedTableId(null);
    setSalesMode('customer');
    setCart([]);
    setGlobalDiscount(null);
    setSelectedCustomer(null);
    setSelectedCartItemId(null);
    setIsTableFloorOpen(true);

    void resumeFloorAfterLogin().then((didResume) => {
      if (!didResume) void refreshLocations();
    });
  }, [
    commerceFeatures.tables,
    isAuthRestored,
    isLoggedIn,
    refreshLocations,
    resumeFloorAfterLogin,
    setIsTableFloorOpen,
  ]);

  useEffect(() => {
    if (!isLoggedIn || !isAuthRestored) return;
    // Aplica perfil da licença: retalho/farmácia = venda directa; restauração = mesas.
    if (!commerceFeatures.tables) {
      setSalesMode('customer');
      setSelectedTableId(null);
    }
    try {
      const settings = loadPosSettings();
      if (settings.askTable !== commerceFeatures.askTableDefault) {
        savePosSettings({ ...settings, askTable: commerceFeatures.askTableDefault });
      } else {
        void syncReceiptPrinterToServer(settings);
      }
    } catch {
      /* ignore */
    }
  }, [isLoggedIn, isAuthRestored, commerceFeatures.tables, commerceFeatures.askTableDefault, commerceType]);

  useEffect(() => {
    if (!isLoggedIn || !isAuthRestored) return;
    setCachedPosWorkspace({ docType, salesMode });
  }, [docType, salesMode, isLoggedIn, isAuthRestored]);

  useEffect(() => {
    if (!isLoggedIn || !isAuthRestored || !currentUser?.id) return;
    void ensureCashSession()
      .then((snapshot) => {
        if (snapshot?.dayCarryOver?.pending) {
          showToast(
            snapshot.dayCarryOver.message ||
              'Caixa de ontem não esvaziado — retire o valor para abrir o dia de hoje.',
            'error',
          );
          setIsCashMovementOpen(true);
        }
      })
      .catch(() => undefined);
  }, [isLoggedIn, isAuthRestored, currentUser?.id]);

  const handleFinalizePayment = async () => {
    if (isFinalizingPayment) return;

    const stationRole = loadStationClientSettings().stationRole;
    if (stationRole === 'consulta') {
      setPaymentFinalizeError('Posto de consulta não pode fechar vendas.');
      showToast('Posto de consulta não pode fechar vendas.', 'error');
      return;
    }
    if (stationRole === 'garcom' && docType !== 'FP') {
      setPaymentFinalizeError('Garçom não fecha pagamento — use um posto Caixa.');
      showToast('Garçom não fecha pagamento — use um posto Caixa.', 'error');
      return;
    }

    const saleDate = new Date();
    const saleTimestamp = saleDate.toISOString();
    const isVDDocument = docType === 'VD';
    setPaymentFinalizeError(null);

    const finalPayments = isMultiplePayment ? payments : (paymentMethod ? [{ method: paymentMethod, amount: isCashPaymentMethod(paymentMethod) && receivedAmount !== '' ? parseFloat(receivedAmount) : total }] : []);
    const isAccountReceivable = finalPayments.some((entry) => {
      const normalized = String(entry.method ?? '').toLowerCase().replace(/-/g, ' ');
      return normalized.includes('conta') && normalized.includes('corrente');
    });
    if (isAccountReceivable && !selectedCustomer && !customerName.trim()) {
      setIsAddingCustomer(false);
      setIsCustomerModalOpen(true);
      setPaymentFinalizeError('Selecione um cliente ou digite o nome para conta corrente');
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
      let checkoutCustomer = selectedCustomer;
      const typedCustomerName = customerName.trim();

      if (!checkoutCustomer && typedCustomerName) {
        const normalizedName = typedCustomerName.toLocaleLowerCase('pt');
        checkoutCustomer =
          customers.find(
            (customer) =>
              !isSupplierPartyRecord(customer, partyMetaById) &&
              customer.name.trim().toLocaleLowerCase('pt') === normalizedName,
          ) ?? null;

        if (!checkoutCustomer) {
          const updatedCustomers = await saveCustomer({
            editingCustomerId: null,
            newCustomer: {
              name: typedCustomerName,
              // O cadastro completo pode ser feito depois; o nome basta no checkout rápido.
              phone: '000000000',
              email: '',
              address: '',
            },
          });
          setCustomers(updatedCustomers);
          checkoutCustomer =
            updatedCustomers.find(
              (customer) =>
                customer.name.trim().toLocaleLowerCase('pt') === normalizedName,
            ) ?? null;
        }

        if (!checkoutCustomer) {
          throw new Error('Não foi possível criar o cliente digitado.');
        }
        setSelectedCustomer(checkoutCustomer);
      }

      const idempotencyKey =
        checkoutIdempotencyKeyRef.current ||
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`);
      checkoutIdempotencyKeyRef.current = idempotencyKey;

      const result = await createOrder({
        cart,
        globalDiscount,
        selectedCustomerId: checkoutCustomer?.cloud_id || checkoutCustomer?.id || null,
        selectedCustomerName: checkoutCustomer?.name || typedCustomerName || null,
        selectedUserId: currentUser?.id || null,
        selectedUserName: currentUser?.name || null,
        selectedTableId: selectedTableId || null,
        locationId: activeLocationId || null,
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
        allowNegativeStockOverride:
          isProforma
            ? false
            : allowStockOverrideOnCheckout || Boolean(loadPosSettings().allowNegativeStock),
        stockOverrideReason:
          !isProforma &&
          (allowStockOverrideOnCheckout || Boolean(loadPosSettings().allowNegativeStock))
            ? allowStockOverrideOnCheckout
              ? 'Override confirmado no POS durante checkout.'
              : 'Stock negativo permitido nas configurações do POS.'
            : null,
      }, {
        idempotencyKey,
      });

      checkoutIdempotencyKeyRef.current = null;
      setPaymentFinalizeError(null);

      // Tickets de produção / KDS (Imp Cozinha / Imp Balcão) — só restauração.
      if (!isProforma && commerceFeatures.printCenters) {
        const productionItems = cart.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          category_id: item.category_id ?? null,
          category: item.category ?? null,
          notes: item.notes ?? null,
        }));
        const productionMeta = {
          tableKey: selectedTableId ?? null,
          tableLabel: selectedTableId
            ? tableLabels[selectedTableId]
              ? `${tableNumberLabels[selectedTableId] || selectedTableId} (${tableLabels[selectedTableId]})`
              : String(tableNumberLabels[selectedTableId] || selectedTableId)
            : null,
          docLabel: `${saleDocType} ${String(result.usedDocumentNumber ?? '')}`.trim(),
          timeLabel: new Date().toLocaleString('pt-MZ'),
          printAlso: true,
          source: 'pos_desktop',
        };
        void submitKitchenOrder(productionItems, productionMeta).then((prod) => {
          if (prod.tickets.length > 0) {
            showToast(
              prod.tickets.length === 1
                ? 'Pedido enviado à cozinha (KDS).'
                : `Pedido enviado a ${prod.tickets.length} estações KDS.`,
              'success',
            );
          } else if (prod.printed > 0) {
            showToast(
              prod.printed === 1
                ? 'Pedido enviado ao centro de impressão.'
                : `Pedido enviado a ${prod.printed} centros de impressão.`,
              'success',
            );
          }
          if (prod.errors.length) {
            showToast(prod.errors[0], 'info');
          }
        });
      }

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

        let committed = false;
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
          if (productsData || customersData) {
            const prev = getPosCatalogCache();
            setPosCatalogCache({
              products: productsData?.length ? productsData : prev?.products ?? [],
              customers: Array.isArray(customersData) ? customersData : prev?.customers ?? [],
              familyColors: prev?.familyColors ?? {},
              paymentMethods: prev?.paymentMethods ?? [],
              companyProfile: prev?.companyProfile ?? null,
            });
          }
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
        setPaymentFinalizeError('Stock insuficiente. Solicite autorização para venda sem stock ou ajuste o carrinho.');
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

  // A marcação cliente/fornecedor é editada noutro ecrã: reler ao abrir a lista.
  useEffect(() => {
    setPartyMetaById(readPartyMetaById());
  }, [isCustomerModalOpen]);

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

  const customerParties = customers.filter(
    (customer) => !isSupplierPartyRecord(customer, partyMetaById),
  );
  const filteredCustomers = customerParties.filter(c =>
    (c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.phone.includes(customerSearch))
  );

  const { productFamilies, visibleProducts } = useProducts(products, searchQuery, selectedCategory);

  if (!isAuthRestored) return null; // Prevent flicker

  const hasElectronActivation =
    typeof window !== 'undefined' && typeof window.electronAPI?.getActivationState === 'function';

  // Licença / setup / ativação: sem ecrãs «A validar…» no arranque — segue para login ou UI.

  if (licenseExpired) {
    return (
      <LicenseExpiredScreen
        tenantName={tenantName}
        expiresAt={expiresAt}
        isRevalidating={isRevalidatingLicense}
        isActivating={isActivatingLicense}
        hasElectronActivation={hasElectronActivation}
        onRevalidate={async () => {
          setIsRevalidatingLicense(true);
          try {
            await refreshLicenseStatus({ syncRegistry: true });
          } finally {
            setIsRevalidatingLicense(false);
          }
        }}
        onActivate={
          hasElectronActivation ? handleElectronLicenseActivate : undefined
        }
      />
    );
  }

  if (setupStatus && !setupStatus.isSetupComplete) {
    // Posto remoto herda setup/licença do servidor — não corre wizard local.
    let isStationClient = false;
    try {
      const raw = localStorage.getItem('pos:station-settings');
      if (raw) {
        const st = JSON.parse(raw) as { stationMode?: string; serverApiBaseUrl?: string };
        isStationClient =
          st.stationMode === 'client' && Boolean(String(st.serverApiBaseUrl ?? '').trim());
      }
    } catch {
      isStationClient = false;
    }
    if (!isStationClient) {
      return (
        <SetupWizard
          status={setupStatus}
          onCompleted={async () => {
            logout();
            await acknowledgeLicenseFileOnServer();
            await handleRevalidateSetup();
            await refreshSetupStatus();
            await refreshActivationState();
            await fetchUsers({ bypassLicenseBlock: true });
          }}
        />
      );
    }
  }

  if (hasElectronActivation && activationState && !activationState.isActivated) {
    let isStationClient = false;
    try {
      const raw = localStorage.getItem('pos:station-settings');
      if (raw) {
        const st = JSON.parse(raw) as { stationMode?: string; serverApiBaseUrl?: string };
        isStationClient =
          st.stationMode === 'client' && Boolean(String(st.serverApiBaseUrl ?? '').trim());
      }
    } catch {
      isStationClient = false;
    }
    if (!isStationClient) {
      return (
        <ActivationScreen
          activationCode={activationState?.activationCode || ''}
          machineId={activationState?.machineId || ''}
          reason={activationState?.reason || null}
          isSubmitting={isActivatingLicense}
          onRefresh={async () => {
            await refreshActivationState();
          }}
          onActivate={handleElectronLicenseActivate}
          onClearLocalLicense={async () => {
            if (!window.electronAPI?.clearLocalLicense) {
              throw new Error('Limpar licença só está disponível na app Electron.');
            }
            try {
              await resetLocalLicenseOnServer();
            } catch {
              // Electron IPC ainda faz fallback (apaga ficheiro).
            }
            const result = await window.electronAPI.clearLocalLicense();
            if (!result?.success) {
              throw new Error(result?.error || 'Falha ao limpar licença local.');
            }
            await refreshActivationState();
            await refreshSetupStatus({ skipRegistrySync: true });
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
          await refreshSetupStatus({ skipRegistrySync: true });
          await fetchUsers({ bypassLicenseBlock: true });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-pos-bg text-zinc-300 font-sans selection:bg-[rgba(0, 1, 251,0.45)]">
      {!isConfigured && (
        <div className="bg-amber-700/90 text-white text-[10px] font-bold py-1 px-4 text-center z-[9999]">
          Sync cloud desactivado: configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para sincronizar com a nuvem. As vendas funcionam offline.
        </div>
      )}
      
      {/* --- Top Header --- */}
      <Header
        showTables={commerceFeatures.tables}
        tablesFloorOpen={isTableFloorOpen}
        locations={floorLocations}
        activeLocationId={activeLocationId}
        selectedTableId={selectedTableId}
        onSelectLocation={selectLocation}
        onOpenAdminSidebar={() => setIsAdminSidebarOpen(true)}
        userName={currentUser?.name ?? null}
        onLogout={logoutFromPos}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {commerceFeatures.tables && isTableFloorOpen ? (
              <TableFloorPanel
                tableIds={posTableIds}
                tablesSummary={posTablesSummary}
                allowCustomNames={allowTableCustomNames}
                selectedTableId={selectedTableId}
                salesMode={salesMode}
                tableOrders={tableOrders}
                tableLabels={tableLabels}
                tableNumberLabels={tableNumberLabels}
                formatPrice={formatPrice}
                onSelect={handleTableSelect}
                onClose={() => setIsTableFloorOpen(false)}
              />
            ) : (
              <ProductList
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSearchSubmit={handleSearchSubmit}
                productFamilies={productFamilies}
                familyColors={familyColors}
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
            )}
          </div>
          {/* Na grelha de mesas o ecrã fica só com as mesas; o carrinho volta ao abrir uma mesa. */}
          {!(commerceFeatures.tables && isTableFloorOpen) ? (
            <Cart
              selectedCartItemId={selectedCartItemId}
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
              customers={customerParties}
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
              onChangeQuantity={(item, quantity) => {
                void updateQuantity(item.id, quantity);
              }}
              onOpenLineDiscount={(item) => {
                if (!requireAccess('vendas.aplicar_desconto', 'Aplicar desconto')) return;
                setSelectedCartItemId(item.id);
                setDiscountTarget('selected');
                setIsDiscountModalOpen(true);
              }}
              allowItemNotes={Boolean(commerceFeatures.printCenters)}
              onEditItemNotes={(item) => {
                setNotesEditingItem(item);
                setTempItemNotes(String(item.notes ?? ''));
                setIsItemNotesModalOpen(true);
              }}
              onRemoveItem={(id) => {
                if (!requireAccess('vendas.cancelar_item', 'Cancelar item')) return;
                removeFromCart(id);
              }}
              onClearSelection={() => setSelectedCartItemId(null)}
              originalSubtotal={originalSubtotal}
              totalDiscount={totalDiscount}
              tax={tax}
              total={total}
              canCancelOrder={can('vendas.cancelar_pedido')}
              onCancelOrder={() => {
                if (cart.length === 0) {
                  showToast('Não existe nada no carrinho de compra', 'error');
                  return;
                }
                if (!requireAccess('vendas.cancelar_pedido', 'Cancelar pedido')) return;
                setIsCancelModalOpen(true);
              }}
              onOpenPayment={() => {
                if (cart.length <= 0) return;
                setPaymentFinalizeError(null);
                setIsPaymentModalOpen(true);
              }}
              onOpenCustomer={() => setIsCustomerModalOpen(true)}
              onOpenDiscount={() => {
                if (!requireAccess('vendas.aplicar_desconto', 'Aplicar desconto')) return;
                setIsDiscountModalOpen(true);
              }}
              onOpenQuotation={handleOpenQuotationModal}
              onOpenBill={() => {
                if (cart.length === 0) return;
                setIsReceiptModalOpen(true);
              }}
              onOpenCashDrawer={() => {
                if (!requireAccess('vendas.abrir_gaveta_dinheiro', 'Abrir a gaveta do dinheiro')) return;
                void (async () => {
                  if (!window.electronAPI?.openCashDrawer) {
                    showToast('Abertura de gaveta disponível na app desktop (Electron).', 'info');
                    return;
                  }
                  const settings = loadPosSettings();
                  const printer = String(settings.printJobs?.receipt?.printer || '').trim();
                  if (!printer) {
                    showToast('Configure a impressora de recibos em Opções de impressão.', 'error');
                    return;
                  }
                  try {
                    const result = await window.electronAPI.openCashDrawer({
                      printer,
                      command: settings.printDrawerCommand || '1B700019FA',
                      tryBothPins: true,
                    });
                    if (!result?.success) {
                      showToast(result?.error || 'Falha ao abrir gaveta.', 'error');
                    }
                  } catch (error) {
                    showToast(error instanceof Error ? error.message : 'Falha ao abrir gaveta.', 'error');
                  }
                })();
              }}
            />
          ) : null}
        </div>
        <PosStatusFooter />
      </main>

      <StockZeroModal
        isOpen={isStockModalOpen && !!pendingProduct}
        productName={pendingProduct?.name ?? ''}
        onCancel={() => {
          setIsStockModalOpen(false);
          setPendingProduct(null);
        }}
        onConfirm={() => {
          if (!pendingProduct) return;
          if (!requireAccess('vendas.venda_estoque_zero', 'Venda de quantidade de stock zero')) {
            return;
          }
          executeAddToCart(pendingProduct);
          setAllowStockOverrideOnCheckout(true);
          setIsStockModalOpen(false);
          setPendingProduct(null);
        }}
      />

      <MinStockAlertModal
        alert={minStockAlert}
        onClose={() => setMinStockAlert(null)}
      />

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

      <DiscountModal
        isOpen={isDiscountModalOpen}
        onClose={() => setIsDiscountModalOpen(false)}
        discountType={discountType}
        setDiscountType={setDiscountType}
        discountTarget={discountTarget}
        setDiscountTarget={setDiscountTarget}
        discountAmount={discountAmount}
        setDiscountAmount={setDiscountAmount}
        selectedCartItemId={selectedCartItemId}
        previewDiscount={previewDiscount}
        formatPrice={formatPrice}
        onApply={applyDiscount}
        canApply={!!discountAmount && (discountTarget === 'all' || !!selectedCartItemId)}
      />

      <QuantityModal
        isOpen={isQuantityModalOpen && !!editingItem}
        itemName={editingItem?.name ?? ''}
        tempQuantity={tempQuantity}
        setTempQuantity={setTempQuantity}
        onClose={() => setIsQuantityModalOpen(false)}
        onConfirm={() => {
          if (!editingItem) return;
          const q = parseFloat(tempQuantity);
          if (!isNaN(q)) {
            updateQuantity(editingItem.id, q);
          }
          setIsQuantityModalOpen(false);
        }}
      />

      <ItemNotesModal
        isOpen={isItemNotesModalOpen && !!notesEditingItem}
        itemName={notesEditingItem?.name ?? ''}
        notes={tempItemNotes}
        setNotes={setTempItemNotes}
        onClose={() => {
          setIsItemNotesModalOpen(false);
          setNotesEditingItem(null);
        }}
        onConfirm={() => {
          if (!notesEditingItem) return;
          const notes = tempItemNotes.trim().slice(0, 500) || null;
          setCart((prev) =>
            prev.map((row) => (row.id === notesEditingItem.id ? { ...row, notes } : row))
          );
          setIsItemNotesModalOpen(false);
          setNotesEditingItem(null);
        }}
      />

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
        tableNumber={
          tableNumber ||
          (selectedTableId ? tableNumberLabels[selectedTableId] || selectedTableId : '')
        }
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

      <CancelOrderModal
        isOpen={isCancelModalOpen}
        onCancel={() => setIsCancelModalOpen(false)}
        onConfirm={() => {
          clearCart(false);
          setIsCancelModalOpen(false);
        }}
      />

      <AdminPanel
        isOpen={isAdminSidebarOpen}
        onClose={() => setIsAdminSidebarOpen(false)}
        currentUserName={currentUser?.name || null}
        currentDate={currentDate}
        accessLevel={currentUser?.accessLevel}
        onAccessDenied={(message) => showToast(message, 'error')}
        onGoToManagement={() => {
          if (!requireAccess('gerenciamento.acesso', 'Gerenciamento')) return;
          void flushDraftNow().finally(() => {
            router.push('/management');
          });
        }}
        onOpenSalesHistory={() => {
          if (!requireAccess('vendas.ver_historico_vendas', 'Ver histórico de vendas')) return;
          setIsAdminSidebarOpen(false);
          setIsSalesHistoryOpen(true);
        }}
        onOpenEndOfDay={() => {
          if (!requireAccess('gerenciamento.fechamento_diario', 'Fim do dia')) return;
          setIsAdminSidebarOpen(false);
          setIsEndOfDayOpen(true);
        }}
        onOpenCashMovement={() => {
          if (!requireAccess('vendas.abrir_caixa', 'Movimento de caixa')) return;
          setIsAdminSidebarOpen(false);
          setIsCashMovementOpen(true);
        }}
        onLogout={logoutFromPos}
      />

      <EndOfDayModal
        isOpen={isEndOfDayOpen}
        onClose={() => setIsEndOfDayOpen(false)}
        companyName={companyProfile?.name || 'POSly'}
        operatorName={currentUser?.name || null}
        onToast={showToast}
      />

      <CashMovementModal
        isOpen={isCashMovementOpen}
        onClose={() => setIsCashMovementOpen(false)}
        operatorName={currentUser?.name || null}
        onToast={showToast}
      />

      <SalesHistoryModal isOpen={isSalesHistoryOpen} onClose={() => setIsSalesHistoryOpen(false)} />

      <PosToast toast={toast} placement="center" />
    </div>
  );
}
