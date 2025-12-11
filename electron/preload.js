/**
 * DeepSeeker - Electron 预加载脚本
 * 安全地暴露 API 给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

// 捕获渲染进程错误并发送到主进程
window.addEventListener('error', (event) => {
    ipcRenderer.send('renderer-error', {
        message: event.message,
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error ? event.error.stack : null
    });
});

window.addEventListener('unhandledrejection', (event) => {
    ipcRenderer.send('renderer-error', {
        message: 'Unhandled Rejection: ' + event.reason,
        source: '',
        lineno: 0,
        colno: 0,
        error: null
    });
});

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 主题
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  
  // 文件对话框
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  
  // 文件操作
  showInFinder: (path) => ipcRenderer.invoke('show-in-finder', path),
  openFile: (path) => ipcRenderer.invoke('open-file', path),
  
  // 事件监听
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (_, path) => callback(path));
    return () => ipcRenderer.removeAllListeners('navigate');
  },
  
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', () => callback());
    return () => ipcRenderer.removeAllListeners('open-settings');
  },
  
  onImportFiles: (callback) => {
    ipcRenderer.on('import-files', (_, filePaths) => callback(filePaths));
    return () => ipcRenderer.removeAllListeners('import-files');
  },
  
  onExportReport: (callback) => {
    ipcRenderer.on('export-report', () => callback());
    return () => ipcRenderer.removeAllListeners('export-report');
  },
  
  // 平台检测
  platform: process.platform,
  isElectron: true
});

// 控制台日志
console.log('DeepSeeker preload script loaded');