import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: async () => {
    return ipcRenderer.invoke('dialog:selectFolder');
  },
  getAppPaths: async () => {
    return ipcRenderer.invoke('app:getPaths');
  },
  getMachineId: async () => {
    return ipcRenderer.invoke('system:getMachineId');
  },
  getActivationState: async () => {
    return ipcRenderer.invoke('activation:getState');
  },
  activateLicense: async (licenseKey) => {
    return ipcRenderer.invoke('activation:activate', { licenseKey });
  },
  restartApp: async () => {
    return ipcRenderer.invoke('app:restart');
  },
  toggleMaximize: async () => {
    return ipcRenderer.invoke('window:toggleMaximize');
  },
  isMaximized: async () => {
    return ipcRenderer.invoke('window:isMaximized');
  },
  quitApp: async () => {
    return ipcRenderer.invoke('app:quit');
  },
  listSerialPorts: async () => {
    return ipcRenderer.invoke('serial:listPorts');
  },
  writeCustomerDisplay: async (payload) => {
    return ipcRenderer.invoke('customerDisplay:write', payload);
  },
  listPrinters: async () => {
    return ipcRenderer.invoke('print:listPrinters');
  },
  openCashDrawer: async (options) => {
    return ipcRenderer.invoke('print:openDrawer', {
      printer: options?.printer,
      command: options?.command,
      tryBothPins: options?.tryBothPins,
    });
  },
  printRaw: async (options) => {
    return ipcRenderer.invoke('print:raw', {
      printer: options?.printer,
      command: options?.command,
      bytesBase64: options?.bytesBase64,
    });
  },
  printReceipt: async (html, options) => {
    return ipcRenderer.invoke('print:receipt', {
      html,
      printer: options?.printer,
      copies: options?.copies,
      widthMm: options?.widthMm,
      heightMm: options?.heightMm,
    });
  },
  prepareReceiptPrint: async (html, options) => {
    return ipcRenderer.invoke('print:prepareReceipt', {
      html,
      printer: options?.printer,
      copies: options?.copies,
      widthMm: options?.widthMm,
      heightMm: options?.heightMm,
    });
  },
  commitReceiptPrint: async (options) => {
    return ipcRenderer.invoke('print:commitReceipt', {
      printer: options?.printer,
      copies: options?.copies,
      widthMm: options?.widthMm,
      heightMm: options?.heightMm,
      patch: options?.patch,
    });
  },
});
