import { useEffect } from 'react';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface ShortcutConfig {
  key: string;
  action: () => void;
  description: string;
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    const registerShortcuts = async () => {
      for (const shortcut of shortcuts) {
        try {
          await register(shortcut.key, shortcut.action);
          console.log(`Registered shortcut: ${shortcut.key} - ${shortcut.description}`);
        } catch (error) {
          console.error(`Failed to register shortcut ${shortcut.key}:`, error);
        }
      }
    };

    registerShortcuts();

    // Cleanup on unmount
    return () => {
      const cleanup = async () => {
        for (const shortcut of shortcuts) {
          try {
            await unregister(shortcut.key);
          } catch (error) {
            console.error(`Failed to unregister shortcut ${shortcut.key}:`, error);
          }
        }
      };
      cleanup();
    };
  }, [shortcuts]);
}

// Global shortcuts for the app
export function useGlobalShortcuts(actions: {
  onSearch?: () => void;
  onNewCollection?: () => void;
  onSettings?: () => void;
  onToggleTheme?: () => void;
}) {
  useEffect(() => {
    const registerGlobalShortcuts = async () => {
      const appWindow = getCurrentWindow();

      // Cmd/Ctrl + K: Focus search
      if (actions.onSearch) {
        try {
          await register('CommandOrControl+K', () => {
            actions.onSearch?.();
          });
        } catch (err) {
          console.error('Failed to register CommandOrControl+K:', err);
        }
      }

      // Cmd/Ctrl + N: New collection
      if (actions.onNewCollection) {
        try {
          await register('CommandOrControl+N', () => {
            actions.onNewCollection?.();
          });
        } catch (err) {
          console.error('Failed to register CommandOrControl+N:', err);
        }
      }

      // Cmd/Ctrl + ,: Open settings
      if (actions.onSettings) {
        try {
          await register('CommandOrControl+Comma', () => {
            actions.onSettings?.();
          });
        } catch (err) {
          console.error('Failed to register CommandOrControl+Comma:', err);
        }
      }

      // Cmd/Ctrl + Shift + T: Toggle theme
      if (actions.onToggleTheme) {
        try {
          await register('CommandOrControl+Shift+T', () => {
            actions.onToggleTheme?.();
          });
        } catch (err) {
          console.error('Failed to register CommandOrControl+Shift+T:', err);
        }
      }

      // Cmd/Ctrl + W: Close window (let default behavior work)
      // Cmd/Ctrl + Q: Quit app (let default behavior work)
    };

    registerGlobalShortcuts();

    return () => {
      const cleanup = async () => {
        try {
          await unregister('CommandOrControl+K');
          await unregister('CommandOrControl+N');
          await unregister('CommandOrControl+Comma');
          await unregister('CommandOrControl+Shift+T');
        } catch (err) {
          console.error('Failed to cleanup shortcuts:', err);
        }
      };
      cleanup();
    };
  }, [actions]);
}
