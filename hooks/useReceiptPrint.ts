'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  CartItem,
  CompanyProfile,
  Customer,
  PaymentEntry,
  PaymentMethod,
  User as PosUser,
} from '@/app/pos/types';
import { loadPosSettings } from '@/lib/posSettings';
import { buildReceiptHeader, safeReceiptLogoSrc } from '@/lib/receiptCompanyHeader';
import { getPosTaxPercentLabel } from '@/lib/taxConfig';
import { buildThermalPrintPageCss, resolveThermalWidthMm } from '@/lib/thermalPrintPage';

const getDocumentYear = (date = new Date()) => date.getFullYear();

export const formatDocumentNumber = (
  sequence: number,
  date = new Date(),
  docType: 'VD' | 'TK' | 'FP' | 'FT' = 'VD',
) => `${docType}/${getDocumentYear(date)}/${String(sequence).padStart(4, '0')}`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type UseReceiptPrintOpts = {
  cart: CartItem[];
  isSaleFinalized: boolean;
  finalizedDocType: 'VD' | 'TK' | 'FP' | 'FT';
  currentReceiptNumber: string | null;
  nextVDNumber: number;
  selectedCustomer: Customer | null;
  currentUser: PosUser | null;
  companyProfile: CompanyProfile | null;
  paymentMethod: PaymentMethod | null;
  receivedAmount: string;
  payments: PaymentEntry[];
  isMultiplePayment: boolean;
  total: number;
  subtotal: number;
  tax: number;
  totalDiscount: number;
  originalSubtotal: number;
  isPaymentModalOpen: boolean;
  isReceiptPrintEnabled: boolean;
  isCashPaymentMethod: (methodCode: PaymentMethod | null) => boolean;
  paymentLabel: (methodCode: PaymentMethod | null) => string;
  estimateCheckoutDocType: () => 'VD' | 'TK' | 'FP' | 'FT';
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  setIsReceiptModalOpen: Dispatch<SetStateAction<boolean>>;
  onResetForNewSale: () => void;
};

export function useReceiptPrint(opts: UseReceiptPrintOpts) {
  const {
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
    onResetForNewSale,
  } = opts;

  const receiptPreparedRef = useRef(false);
  const receiptPrepareGenRef = useRef(0);

  const formatReceiptAmount = (value: number) => {
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}MT`;
  };

  const buildPrintReceiptMarkup = useCallback(
    (options?: {
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
          ? isCashPaymentMethod(paymentMethod)
            ? parseFloat(receivedAmount || `${total}`)
            : total
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
          : payments
              .map(
                (p) => `
          <div class="print-row payment-row">
            <span>${escapeHtml(paymentLabel(p.method))}</span>
            <span>${formatReceiptAmount(p.amount)}</span>
          </div>
        `,
              )
              .join('');

      const hasChange =
        (!isMultiplePayment && isCashPaymentMethod(paymentMethod) && receivedAmount !== '') ||
        (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) > total);

      const shouldShowPaidRow = !saleFinalized
        ? false
        : !isMultiplePayment
          ? isCashPaymentMethod(paymentMethod) &&
            receivedAmount !== '' &&
            parseFloat(receivedAmount || '0') > total
          : payments.reduce((acc, p) => acc + p.amount, 0) > total;

      const changeAmount = !isMultiplePayment
        ? parseFloat(receivedAmount || '0') - total
        : payments.reduce((acc, p) => acc + p.amount, 0) - total;

      const itemRows = cart
        .map(
          (item) => `
      <div class="print-item-row">
        <span class="qty">${item.quantity.toFixed(2)}</span>
        <span class="desc">${escapeHtml(item.name)}</span>
        <span class="unit">${formatReceiptAmount(item.price)}</span>
        <span class="line-total">${formatReceiptAmount(item.price * item.quantity)}</span>
      </div>
    `,
        )
        .join('');

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

        ${
          saleFinalized
            ? `
          <div class="print-block">
            <div class="print-row print-pay-header">
              <span>Método de Pagamento</span>
              <span>Valor</span>
            </div>
            <div class="print-divider"></div>
            ${paymentRows}
            ${
              shouldShowPaidRow
                ? `
              <div class="print-divider payment-divider"></div>
              <div class="print-row payment-row">
                <span>Pagou</span>
                <span>${formatReceiptAmount(totalPaid)}</span>
              </div>
            `
                : ''
            }
            ${
              hasChange
                ? `
              <div class="print-row print-change">
                <span>Troco</span>
                <span>${formatReceiptAmount(changeAmount)}</span>
              </div>
            `
                : ''
            }
          </div>
        `
            : ''
        }

        <div class="print-footer">
          <div>IVA Incluso</div>
          <div>Processada por Computador</div>
          <div>Obrigado pela preferência!</div>
          <div class="foot-note">Sistema desenvolvido por: Nicolau Nino</div>
        </div>
        ${extraFooterHtml}
      </div>
    `;
    },
    [
      cart,
      companyProfile,
      currentReceiptNumber,
      currentUser?.name,
      finalizedDocType,
      isCashPaymentMethod,
      isMultiplePayment,
      isSaleFinalized,
      nextVDNumber,
      originalSubtotal,
      paymentLabel,
      paymentMethod,
      payments,
      receivedAmount,
      selectedCustomer,
      subtotal,
      tax,
      total,
      totalDiscount,
    ],
  );

  const buildThermalReceiptHtml = useCallback(
    (options?: {
      saleFinalized?: boolean;
      docTypeOverride?: 'VD' | 'TK' | 'FP' | 'FT';
      receiptNumber?: string | null;
    }) => {
      const saleFinalized = options?.saleFinalized ?? isSaleFinalized;
      const printMarkup = buildPrintReceiptMarkup(options);
      const estimatedHeightMm = Math.max(
        34,
        66 +
          cart.length * 9 +
          (saleFinalized ? (payments.length > 0 ? payments.length * 7 : 14) + 20 : 0),
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
    },
    [buildPrintReceiptMarkup, cart.length, isSaleFinalized, payments.length],
  );

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
    selectedCustomer,
    companyProfile,
    nextVDNumber,
    currentUser?.name,
    estimateCheckoutDocType,
    buildThermalReceiptHtml,
  ]);

  const handleReceiptPrimaryAction = useCallback(() => {
    if (isSaleFinalized) {
      onResetForNewSale();
      return;
    }
    setIsReceiptModalOpen(false);
  }, [isSaleFinalized, onResetForNewSale, setIsReceiptModalOpen]);

  const handleReceiptPrint = useCallback(
    async (options?: {
      saleFinalized?: boolean;
      docTypeOverride?: 'VD' | 'TK' | 'FP' | 'FT';
      receiptNumber?: string | null;
      silentOnly?: boolean;
      skipToast?: boolean;
    }) => {
      const { printHtml, printSettings, widthMm, heightMm } = buildThermalReceiptHtml(options);

      if (window.electronAPI?.printReceipt) {
        const printOptions = {
          printer: printSettings.printJobs?.receipt?.printer || undefined,
          copies: printSettings.printCopies,
          widthMm,
          heightMm,
        };
        if (options?.silentOnly) {
          if (!options.skipToast) {
            const printerLabel = printSettings.printJobs?.receipt?.printer || 'a impressora';
            showToast(`Recibo enviado para ${printerLabel}.`, 'success');
          }
          void window.electronAPI
            .printReceipt(printHtml, printOptions)
            .then((result) => {
              if (result && result.success === false && result.error) {
                showToast(`Impressão falhou (${result.error}).`, 'info');
              }
            })
            .catch(() => {
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
              'info',
            );
          }
        } catch {
          showToast('Falha na impressão silenciosa. A abrir fallback manual...', 'info');
        }
      } else if (options?.silentOnly) {
        return false;
      }

      const iframe = document.createElement('iframe');
      iframe.setAttribute(
        'style',
        'position:fixed;right:0;bottom:0;width:0;height:0;border:0;margin:0;padding:0;opacity:0;pointer-events:none;',
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
    },
    [buildThermalReceiptHtml, showToast],
  );

  return {
    receiptPreparedRef,
    buildPrintReceiptMarkup,
    buildThermalReceiptHtml,
    handleReceiptPrint,
    handleReceiptPrimaryAction,
  };
}
