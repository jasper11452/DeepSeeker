/**
 * DeepSeeker - Electron 主进程
 * AI 研究助手桌面应用
 */

const { app, BrowserWindow, shell, ipcMain, Menu, dialog, nativeTheme } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const log = require('electron-log');
const Store = require('electron-store');

// 配置日志
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// 持久化存储
const store = new Store({
  defaults: {
    windowBounds: { width: 1400, height: 900 },
    theme: 'system'
  }
});

// 全局变量
let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let isQuitting = false;

// 判断是否为开发环境
const isDev = process.env.NODE_ENV === 'development';

// 获取资源路径
function getResourcePath(relativePath) {
  if (isDev) {
    return path.join(__dirname, '..', relativePath);
  }
  return path.join(process.resourcesPath, relativePath);
}

// 创建启动画面
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

// 启动后端服务
async function startBackend() {
  return new Promise((resolve, reject) => {
    const backendPath = getResourcePath('backend');
    const venvPath = path.join(backendPath, '.venv');
    const pythonPath = path.join(venvPath, 'bin', 'python');

    log.info('Starting backend from:', backendPath);

    // 检查 Python 虚拟环境
    const fs = require('fs');
    if (!fs.existsSync(pythonPath)) {
      log.warn('Virtual environment not found, using system Python');
      // 尝试使用 uv run
      backendProcess = spawn('uv', ['run', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'], {
        cwd: backendPath,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
    } else {
      backendProcess = spawn(pythonPath, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'], {
        cwd: backendPath,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
    }

    backendProcess.stdout.on('data', (data) => {
      log.info(`Backend: ${data}`);
      if (data.toString().includes('Uvicorn running') || data.toString().includes('Application startup complete')) {
        resolve();
      }
    });

    backendProcess.stderr.on('data', (data) => {
      log.error(`Backend Error: ${data}`);
      // Uvicorn 的 info 日志也会输出到 stderr
      if (data.toString().includes('Uvicorn running') || data.toString().includes('Application startup complete')) {
        resolve();
      }
    });

    backendProcess.on('error', (err) => {
      log.error('Failed to start backend:', err);
      reject(err);
    });

    backendProcess.on('exit', (code) => {
      log.info(`Backend exited with code ${code}`);
      if (!isQuitting) {
        // 非正常退出，尝试重启
        log.warn('Backend crashed, attempting restart...');
        setTimeout(() => startBackend(), 3000);
      }
    });

    // 超时处理
    setTimeout(() => {
      // 检查后端是否启动
      checkBackendHealth().then(resolve).catch(() => {
        log.warn('Backend health check timeout, continuing anyway...');
        resolve();
      });
    }, 30000);
  });
}

// 检查后端健康状态
async function checkBackendHealth() {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:8000/health', (res) => {
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`Health check failed: ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Health check timeout'));
    });
  });
}

// 等待后端启动
async function waitForBackend(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await checkBackendHealth();
      log.info('Backend is ready');
      return true;
    } catch (e) {
      log.debug(`Waiting for backend... (${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Backend failed to start');
}

// 创建主窗口
function createMainWindow() {
  const { width, height } = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    }
  });

  // 加载前端
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：先启动本地服务器提供静态文件，或直接加载 API
    mainWindow.loadURL('http://127.0.0.1:8000');
  }

  // 窗口事件
  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接处理
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// 创建菜单
function createMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 DeepSeeker' },
        { type: 'separator' },
        {
          label: '偏好设置...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('open-settings')
        },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 DeepSeeker' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出 DeepSeeker' }
      ]
    },
    {
      label: '文件',
      submenu: [
        {
          label: '导入文档...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile', 'multiSelections'],
              filters: [
                { name: '文档', extensions: ['pdf', 'md', 'txt', 'docx', 'pptx', 'xlsx'] },
                { name: '所有文件', extensions: ['*'] }
              ]
            });
            if (!result.canceled) {
              mainWindow?.webContents.send('import-files', result.filePaths);
            }
          }
        },
        { type: 'separator' },
        {
          label: '导出研究报告...',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('export-report')
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '文档库',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('navigate', '/')
        },
        {
          label: 'AI 对话',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('navigate', '/chat')
        },
        {
          label: '知识图谱',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow?.webContents.send('navigate', '/graph')
        },
        {
          label: '洞察面板',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow?.webContents.send('navigate', '/insights')
        },
        {
          label: '主题聚类',
          accelerator: 'CmdOrCtrl+5',
          click: () => mainWindow?.webContents.send('navigate', '/clusters')
        },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '使用文档',
          click: () => shell.openExternal('https://github.com/jasper11452/DeepSeeker#readme')
        },
        {
          label: '报告问题',
          click: () => shell.openExternal('https://github.com/jasper11452/DeepSeeker/issues')
        },
        { type: 'separator' },
        {
          label: '查看日志',
          click: () => shell.showItemInFolder(log.transports.file.getFile().path)
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC 通信处理
function setupIPC() {
  // 获取应用版本
  ipcMain.handle('get-app-version', () => app.getVersion());

  // 获取主题设置
  ipcMain.handle('get-theme', () => store.get('theme'));
  ipcMain.handle('set-theme', (_, theme) => {
    store.set('theme', theme);
    return true;
  });

  // 原生对话框
  ipcMain.handle('show-open-dialog', async (_, options) => {
    return dialog.showOpenDialog(mainWindow, options);
  });

  ipcMain.handle('show-save-dialog', async (_, options) => {
    return dialog.showSaveDialog(mainWindow, options);
  });

  // 在 Finder 中显示文件
  ipcMain.handle('show-in-finder', (_, path) => {
    shell.showItemInFolder(path);
    return true;
  });

  // 用默认应用打开文件
  ipcMain.handle('open-file', (_, path) => {
    shell.openPath(path);
    return true;
  });

  // 监听渲染进程错误
  ipcMain.on('renderer-error', (_, error) => {
    log.error('Renderer Error:', error);
  });
}

// 应用生命周期
app.on('ready', async () => {
  log.info('DeepSeeker starting...');

  createSplashWindow();
  createMenu();
  setupIPC();

  try {
    // 启动后端
    await startBackend();
    await waitForBackend();
    log.info('Backend started successfully');

    // 创建主窗口
    createMainWindow();
  } catch (error) {
    log.error('Failed to start:', error);
    dialog.showErrorBox('启动失败', `无法启动 DeepSeeker: ${error.message}\n\n请检查日志文件获取详细信息。`);
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});

app.on('window-all-closed', () => {
  // macOS 上不退出应用
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;

  // 停止后端进程
  if (backendProcess) {
    log.info('Stopping backend...');
    backendProcess.kill('SIGTERM');
  }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled rejection:', reason);
});
