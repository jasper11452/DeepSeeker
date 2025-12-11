// Electron API 类型定义
export interface ElectronAPI {
  // 应用信息
  getAppVersion: () => Promise<string>;
  
  // 主题
  getTheme: () => Promise<'light' | 'dark' | 'system'>;
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<boolean>;
  
  // 文件对话框
  showOpenDialog: (options: {
    properties?: ('openFile' | 'openDirectory' | 'multiSelections')[];
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  
  showSaveDialog: (options: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  
  // 文件操作
  showInFinder: (path: string) => Promise<boolean>;
  openFile: (path: string) => Promise<boolean>;
  
  // 事件监听
  onNavigate: (callback: (path: string) => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
  onImportFiles: (callback: (filePaths: string[]) => void) => () => void;
  onExportReport: (callback: () => void) => () => void;
  
  // 平台信息
  platform: NodeJS.Platform;
  isElectron: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
