import { Routes, Route } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import { DocumentLibraryView } from './views/DocumentLibraryView';
import { DocumentDetailView } from './views/DocumentDetailView';
import { ChatView } from './views/ChatView';
import { GraphView } from './views/GraphView';
// 研究助手视图
import { ResearchInsightsView } from './views/ResearchInsightsView';
import { ResearchOverviewView } from './views/ResearchOverviewView';
import { ClustersView } from './views/ClustersView';
import { TrendsView } from './views/TrendsView';
import { ReportsView } from './views/ReportsView';
import { GapsView } from './views/GapsView';

import { SettingsModal } from './components/SettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { useUIStore, useThemeStore } from '@/lib/store';
import { useEffect } from 'react';

import { useLocation } from 'react-router-dom';
import { ToastContainer } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCopilotStore } from './stores/copilotStore';

function App() {
  const { settingsOpen, closeSettings, commandPaletteOpen, closeCommandPalette } = useUIStore();
  const { theme } = useThemeStore();
  const location = useLocation();
  const resetCopilot = useCopilotStore((state) => state.reset);

  // Reset copilot state on route change
  useEffect(() => {
    resetCopilot();
  }, [location.pathname, resetCopilot]);

  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = () => {
      root.classList.remove('light', 'dark');

      let effectiveTheme = theme;
      if (theme === 'system') {
        // Note: Browser's prefers-color-scheme may not sync with OS settings
        // in certain browser configurations or automated environments
        effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
      }

      root.classList.add(effectiveTheme);
      root.style.colorScheme = effectiveTheme;
    };

    applyTheme();

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  // Handle command palette and settings shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        useUIStore.getState().openCommandPalette();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        useUIStore.getState().openSettings();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle Electron navigation events
  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI?.onNavigate) {
      // @ts-ignore
      const unsubscribe = window.electronAPI.onNavigate((path: string) => {
        window.location.href = path;
      });
      return unsubscribe;
    }
  }, []);

  // Handle Electron settings event
  useEffect(() => {
    // @ts-ignore
    if (window.electronAPI?.onOpenSettings) {
      // @ts-ignore
      const unsubscribe = window.electronAPI.onOpenSettings(() => {
        useUIStore.getState().openSettings();
      });
      return unsubscribe;
    }
  }, []);

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          {/* 基础功能 */}
          <Route index element={<DocumentLibraryView />} />
          <Route path="document/:id" element={<DocumentDetailView />} />
          <Route path="chat/:conversationId?" element={<ChatView />} />
          <Route path="graph" element={<GraphView />} />
          {/* 研究助手功能 */}
          <Route path="insights" element={<ResearchInsightsView />} />
          <Route path="research" element={<ResearchOverviewView />} />
          <Route path="clusters" element={<ClustersView />} />
          <Route path="trends" element={<TrendsView />} />
          <Route path="reports" element={<ReportsView />} />
          <Route path="gaps" element={<GapsView />} />
        </Route>
      </Routes>

      {settingsOpen && <SettingsModal onClose={closeSettings} />}
      {commandPaletteOpen && <CommandPalette onClose={closeCommandPalette} />}
      <ToastContainer />
    </ErrorBoundary>
  );
}

export default App;
