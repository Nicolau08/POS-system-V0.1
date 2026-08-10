export {};

declare global {
  type ElectronPrintResult = {
    success: boolean;
    printer?: string;
    error?: string;
  };

  type ElectronPrinterInfo = {
    name: string;
    displayName?: string;
    isDefault?: boolean;
    status?: number;
  };

  interface Window {
    electronAPI?: {
      selectFolder: () => Promise<string | null>;
      getAppPaths: () => Promise<{
        userDataPath: string;
        databasePath: string;
        configPath: string;
        licensePath: string;
        databaseExists: boolean;
        configExists: boolean;
        licenseExists: boolean;
      }>;
      getRuntimeInfo: () => Promise<{
        success: boolean;
        packaged: boolean;
        platform?: string;
        version?: string;
        error?: string;
      }>;
      getMachineId: () => Promise<{
        success: boolean;
        machineId?: string;
        error?: string;
      }>;
      getActivationState: () => Promise<{
        success: boolean;
        isActivated: boolean;
        machineId: string;
        activationCode: string;
        reason?: string;
        licensePath?: string;
      }>;
      activateLicense: (licenseKey: string) => Promise<{
        success: boolean;
        error?: string;
        licensePath?: string;
      }>;
      restartApp: () => Promise<{
        success: boolean;
        error?: string;
      }>;
      toggleMaximize: () => Promise<{
        success: boolean;
        maximized: boolean;
        error?: string;
      }>;
      isMaximized: () => Promise<{
        success: boolean;
        maximized: boolean;
        error?: string;
      }>;
      quitApp: () => Promise<{
        success: boolean;
        error?: string;
      }>;
      listSerialPorts: () => Promise<{
        success: boolean;
        ports: Array<{ path: string; label?: string; manufacturer?: string }>;
        error?: string;
      }>;
      writeCustomerDisplay: (payload: {
        line1: string;
        line2: string;
        port: string;
        baudRate?: number;
        dataBits?: number;
        parity?: string;
        stopBits?: number;
        flowControl?: string;
        chars?: number;
      }) => Promise<{
        success: boolean;
        softOnly?: boolean;
        line1?: string;
        line2?: string;
        error?: string;
      }>;
      listPrinters: () => Promise<{
        success: boolean;
        printers: ElectronPrinterInfo[];
        error?: string;
      }>;
      openCashDrawer: (options?: {
        printer?: string;
        command?: string;
        tryBothPins?: boolean;
      }) => Promise<{
        success: boolean;
        printer?: string;
        commandHex?: string;
        error?: string;
      }>;
      printRaw: (options?: {
        printer?: string;
        command?: string;
        bytesBase64?: string;
      }) => Promise<{
        success: boolean;
        printer?: string;
        error?: string;
      }>;
      printReceipt: (
        html: string,
        options?: { printer?: string; copies?: number; widthMm?: number; heightMm?: number },
      ) => Promise<ElectronPrintResult>;
      printNetwork: (options: {
        host: string;
        port?: number;
        bytesBase64: string;
      }) => Promise<ElectronPrintResult & { host?: string; port?: number }>;
      prepareReceiptPrint: (
        html: string,
        options?: { printer?: string; copies?: number; widthMm?: number; heightMm?: number },
      ) => Promise<ElectronPrintResult & { prepared?: boolean }>;
      commitReceiptPrint: (options?: {
        printer?: string;
        copies?: number;
        widthMm?: number;
        heightMm?: number;
        patch?: { docLine?: string };
      }) => Promise<ElectronPrintResult & { needFullPrint?: boolean }>;
      saveStationRuntimeConfig: (config: {
        mode?: string;
        serverApiBaseUrl?: string;
        stationCode?: string;
        lanAccessEnabled?: boolean;
        discoveryEnabled?: boolean;
      }) => Promise<{ success: boolean; error?: string }>;
      getStationRuntimeConfig: () => Promise<{
        success: boolean;
        mode?: string;
        serverApiBaseUrl?: string;
        stationCode?: string;
        lanAccessEnabled?: boolean;
        discoveryEnabled?: boolean;
        error?: string;
      }>;
      scanLanStations: () => Promise<{
        success: boolean;
        servers?: Array<{
          url: string;
          store_name?: string;
          tenant_id?: string;
          port?: number;
        }>;
        error?: string;
      }>;
      getUpdateStatus?: () => Promise<{
        status?: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';
        version?: string | null;
        percent?: number;
        transferred?: number;
        total?: number;
        error?: string | null;
        dismissed?: boolean;
      }>;
      downloadUpdate?: () => Promise<{ ok: boolean; error?: string }>;
      installUpdate?: () => Promise<{ ok: boolean; error?: string }>;
      dismissUpdate?: () => Promise<{ ok: boolean }>;
      onUpdateStatus?: (
        callback: (payload: {
          status?: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';
          version?: string | null;
          percent?: number;
          transferred?: number;
          total?: number;
          error?: string | null;
          dismissed?: boolean;
        }) => void,
      ) => () => void;
    };
  }
}
