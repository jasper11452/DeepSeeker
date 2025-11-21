import { useState } from 'react';

interface Shortcut {
  key: string;
  description: string;
  category: string;
}

const shortcuts: Shortcut[] = [
  { key: '⌘/Ctrl + K', description: '聚焦搜索框', category: '搜索' },
  { key: '⌘/Ctrl + N', description: '新建集合', category: '集合' },
  { key: '⌘/Ctrl + ,', description: '打开设置', category: '应用' },
  { key: '⌘/Ctrl + Shift + T', description: '切换主题', category: '应用' },
  { key: 'Esc', description: '关闭对话框', category: '导航' },
  { key: '↑↓', description: '导航搜索结果', category: '搜索' },
  { key: 'Enter', description: '打开选中结果', category: '搜索' },
];

export function ShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false);

  const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, Shortcut[]>);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
        title="键盘快捷键"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-700/50 sticky top-0 bg-slate-900 z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">键盘快捷键</h2>
                  <p className="text-sm text-slate-400">快速操作指南</p>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {Object.entries(groupedShortcuts).map(([category, items]) => (
                <div key={category}>
                  <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-3">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {items.map((shortcut, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between py-2 px-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <span className="text-sm text-slate-300">{shortcut.description}</span>
                        <kbd className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-xs font-mono text-slate-300">
                          {shortcut.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-6 border-t border-slate-700/50 bg-slate-800/50">
              <p className="text-xs text-slate-400 text-center">
                提示: 在 macOS 上使用 ⌘ (Command), 在 Windows/Linux 上使用 Ctrl
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
