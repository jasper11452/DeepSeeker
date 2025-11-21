import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  currentVersion?: string;
  latestVersion?: string;
  error?: string;
}

export function UpdateChecker() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    checking: false,
    available: false,
    downloading: false,
  });

  useEffect(() => {
    // Check for updates on mount
    checkForUpdates();
  }, []);

  const checkForUpdates = async () => {
    try {
      setUpdateStatus({ checking: true, available: false, downloading: false });

      const update = await check();

      if (update?.available) {
        setUpdateStatus({
          checking: false,
          available: true,
          downloading: false,
          currentVersion: update.currentVersion,
          latestVersion: update.version,
        });
      } else {
        setUpdateStatus({
          checking: false,
          available: false,
          downloading: false,
        });
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setUpdateStatus({
        checking: false,
        available: false,
        downloading: false,
        error: String(error),
      });
    }
  };

  const downloadAndInstall = async () => {
    try {
      setUpdateStatus((prev) => ({ ...prev, downloading: true }));

      const update = await check();

      if (update?.available) {
        await update.downloadAndInstall();

        // Relaunch the app after update
        await relaunch();
      }
    } catch (error) {
      console.error('Failed to download and install update:', error);
      setUpdateStatus((prev) => ({
        ...prev,
        downloading: false,
        error: String(error),
      }));
    }
  };

  if (updateStatus.checking) {
    return (
      <div className="fixed bottom-4 right-4 bg-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-lg p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
          <span className="text-sm text-slate-300">检查更新中...</span>
        </div>
      </div>
    );
  }

  if (updateStatus.available && !updateStatus.downloading) {
    return (
      <div className="fixed bottom-4 right-4 bg-gradient-to-br from-indigo-900/90 to-purple-900/90 backdrop-blur-sm border border-indigo-500/50 rounded-lg p-4 shadow-xl max-w-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-white mb-1">新版本可用!</h4>
            <p className="text-xs text-slate-300 mb-3">
              {updateStatus.currentVersion} → {updateStatus.latestVersion}
            </p>
            <div className="flex gap-2">
              <button
                onClick={downloadAndInstall}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-md transition-colors"
              >
                立即更新
              </button>
              <button
                onClick={() => setUpdateStatus({ checking: false, available: false, downloading: false })}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-md transition-colors"
              >
                稍后
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (updateStatus.downloading) {
    return (
      <div className="fixed bottom-4 right-4 bg-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-lg p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
          <span className="text-sm text-slate-300">下载并安装更新中...</span>
        </div>
      </div>
    );
  }

  if (updateStatus.error) {
    return (
      <div className="fixed bottom-4 right-4 bg-red-900/90 backdrop-blur-sm border border-red-500/50 rounded-lg p-4 shadow-lg max-w-sm">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm text-white font-medium mb-1">更新检查失败</p>
            <p className="text-xs text-red-200/80">{updateStatus.error}</p>
          </div>
          <button
            onClick={() => setUpdateStatus({ checking: false, available: false, downloading: false })}
            className="text-red-400 hover:text-red-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return null;
}
