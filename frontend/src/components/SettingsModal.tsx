import { useState } from 'react';
import {
  X,
  Settings,
  Palette,
  Zap,
  Lock,
  Layers,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';
import { healthApi } from '@/lib/api';

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsTab = 'general' | 'appearance' | 'performance' | 'privacy' | 'assistant' | 'about';

interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function ToggleSwitch({ enabled, onChange }: ToggleSwitchProps) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors',
        enabled ? 'bg-accent-primary' : 'bg-gray-200 dark:bg-dark-tertiary'
      )}
    >
      <div
        className={cn(
          'absolute top-[3px] w-[18px] h-[18px] bg-white rounded-full transition-transform',
          enabled ? 'left-[23px]' : 'left-[3px]'
        )}
      />
    </button>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance'); // Default to appearance for quick testing access, or revert to 'general'
  const { theme, setTheme } = useThemeStore();

  // Settings state
  const [settings, setSettings] = useState({
    autoDetectPerformance: true,
    performanceMode: 'balanced',
    contextAwareness: false,
    clipboardRead: false,
    databaseEncryption: true,
    proactiveAssist: true,
    recommendationFrequency: 2,
  });

  // Health check
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: healthApi.check,
  });

  const tabs = [
    { id: 'general', label: '通用', icon: <Settings className="w-4 h-4" /> },
    { id: 'appearance', label: '外观', icon: <Palette className="w-4 h-4" /> },
    { id: 'performance', label: '性能', icon: <Zap className="w-4 h-4" /> },
    { id: 'privacy', label: '隐私', icon: <Lock className="w-4 h-4" /> },
    { id: 'assistant', label: '智能助手', icon: <Layers className="w-4 h-4" /> },
    { id: 'about', label: '关于', icon: <Info className="w-4 h-4" /> },
  ] as const;

  const updateSetting = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-[720px] max-h-[80vh] bg-white dark:bg-dark-elevated border border-default rounded-2xl shadow-lg overflow-hidden flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-subtle">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">设置</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-dark-tertiary hover:bg-gray-200 dark:hover:bg-dark-hover text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center justify-center transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <nav className="w-[200px] p-4 border-r border-subtle bg-gray-50 dark:bg-dark-secondary">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all mb-1',
                  activeTab === tab.id
                    ? 'bg-accent-glow text-accent-secondary'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-dark-hover'
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {/* General */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">启动选项</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">开机自动启动</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">登录时自动启动 DeepSeeker</div>
                      </div>
                      <ToggleSwitch enabled={false} onChange={() => { }} />
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">启动时最小化</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">启动时最小化到系统托盘</div>
                      </div>
                      <ToggleSwitch enabled={false} onChange={() => { }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Appearance */}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">主题</h3>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setTheme('light')}
                      className={cn(
                        'flex-1 p-4 rounded-xl border transition-all',
                        theme === 'light'
                          ? 'border-accent-primary bg-accent-glow'
                          : 'border-default hover:border-gray-300 dark:hover:border-gray-600'
                      )}
                    >
                      <div className="w-full h-20 rounded-lg bg-gray-100 mb-3" />
                      <div className="text-sm text-gray-900 dark:text-white">浅色</div>
                    </button>
                    <button
                      onClick={() => setTheme('dark')}
                      className={cn(
                        'flex-1 p-4 rounded-xl border transition-all',
                        theme === 'dark'
                          ? 'border-accent-primary bg-accent-glow'
                          : 'border-default hover:border-gray-300 dark:hover:border-gray-600'
                      )}
                    >
                      <div className="w-full h-20 rounded-lg bg-dark-primary mb-3 border border-subtle" />
                      <div className="text-sm text-gray-900 dark:text-white">深色</div>
                    </button>
                    <button
                      onClick={() => setTheme('system')}
                      className={cn(
                        'flex-1 p-4 rounded-xl border transition-all',
                        theme === 'system'
                          ? 'border-accent-primary bg-accent-glow'
                          : 'border-default hover:border-gray-300 dark:hover:border-gray-600'
                      )}
                    >
                      <div className="w-full h-20 rounded-lg bg-gradient-to-br from-gray-100 to-dark-primary mb-3 border border-subtle" />
                      <div className="text-sm text-gray-900 dark:text-white">跟随系统</div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Performance */}
            {activeTab === 'performance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">性能模式</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">自动检测</div>
                        <div className="text-xs text-gray-500">根据设备性能自动选择最佳模式</div>
                      </div>
                      <ToggleSwitch
                        enabled={settings.autoDetectPerformance}
                        onChange={(v) => updateSetting('autoDetectPerformance', v)}
                      />
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">手动模式</div>
                        <div className="text-xs text-gray-500">性能 / 均衡 / 节能</div>
                      </div>
                      <select
                        value={settings.performanceMode}
                        onChange={(e) => updateSetting('performanceMode', e.target.value)}
                        className="px-3 py-2 bg-gray-50 dark:bg-dark-tertiary border border-default rounded-lg text-sm text-gray-900 dark:text-white outline-none focus:border-accent-primary"
                      >
                        <option value="performance">性能模式</option>
                        <option value="balanced">均衡模式</option>
                        <option value="power-save">节能模式</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Privacy */}
            {activeTab === 'privacy' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">隐私与安全</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">上下文感知</div>
                        <div className="text-xs text-gray-500">允许 DeepSeeker 感知当前窗口和编辑内容</div>
                      </div>
                      <ToggleSwitch
                        enabled={settings.contextAwareness}
                        onChange={(v) => updateSetting('contextAwareness', v)}
                      />
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">剪贴板读取</div>
                        <div className="text-xs text-gray-500">允许 DeepSeeker 读取剪贴板内容提供相关建议</div>
                      </div>
                      <ToggleSwitch
                        enabled={settings.clipboardRead}
                        onChange={(v) => updateSetting('clipboardRead', v)}
                      />
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">数据库加密</div>
                        <div className="text-xs text-gray-500">使用 SQLCipher 加密本地数据库</div>
                      </div>
                      <ToggleSwitch
                        enabled={settings.databaseEncryption}
                        onChange={(v) => updateSetting('databaseEncryption', v)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Assistant */}
            {activeTab === 'assistant' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">智能助手</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">主动辅助</div>
                        <div className="text-xs text-gray-500">允许 DeepSeeker 主动提供建议和关联信息</div>
                      </div>
                      <ToggleSwitch
                        enabled={settings.proactiveAssist}
                        onChange={(v) => updateSetting('proactiveAssist', v)}
                      />
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-subtle">
                      <div>
                        <div className="text-sm text-gray-900 dark:text-white">推荐频率</div>
                        <div className="text-xs text-gray-500">控制主动推荐的出现频率</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="4"
                          value={settings.recommendationFrequency}
                          onChange={(e) => updateSetting('recommendationFrequency', parseInt(e.target.value))}
                          className="w-[120px] h-1 bg-gray-200 dark:bg-dark-tertiary rounded appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-accent-primary [&::-webkit-slider-thumb]:rounded-full"
                        />
                        <span className="text-xs text-gray-400 min-w-[40px]">
                          {['极少', '低', '中', '高'][settings.recommendationFrequency - 1]}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* About */}
            {activeTab === 'about' && (
              <div className="space-y-6">
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-accent-primary to-emerald-500 flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">A</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">DeepSeeker</h3>
                  <p className="text-sm text-gray-500">智能个人知识管理应用</p>
                  <p className="text-xs text-gray-600 mt-2">版本 0.1.0 (MVP)</p>
                </div>

                <div className="bg-gray-50 dark:bg-dark-tertiary rounded-xl p-4">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">系统状态</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">后端服务</span>
                      <span className={cn(
                        health?.status === 'healthy' ? 'text-emerald-500' : 'text-red-500'
                      )}>
                        {health?.status === 'healthy' ? '正常运行' : '连接失败'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">LLM 服务</span>
                      <span className={cn(
                        health?.llm_service === 'connected' ? 'text-emerald-500' : 'text-amber-500'
                      )}>
                        {health?.llm_service === 'connected' ? '已连接' : '未连接'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-center text-xs text-gray-500 dark:text-gray-600">
                  <p>基于 LM Studio 本地模型</p>
                  <p className="mt-1">所有数据均存储在本地</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}