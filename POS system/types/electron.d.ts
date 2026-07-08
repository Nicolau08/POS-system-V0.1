export {};

declare global {
  type ElectronPrintResult = {
    success: boolean;
    printer?: string;
    error?: string;
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
      printReceipt: (html: string) => Promise<ElectronPrintResult>;
    };
  }
}
