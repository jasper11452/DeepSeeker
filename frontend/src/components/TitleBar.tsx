import { Menu } from 'lucide-react';
import { useUIStore } from '@/lib/store';

export function TitleBar() {
  const { toggleLeftSidebar } = useUIStore();

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-subtle bg-gray-50 dark:bg-dark-secondary">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleLeftSidebar}
          className="w-8 h-8 rounded-lg hover:bg-gray-200 dark:hover:bg-dark-hover flex items-center justify-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-accent-primary to-emerald-500 flex items-center justify-center">
            <span className="text-xs font-bold text-white">A</span>
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">Atlas</span>
        </div>
      </div>
    </header>
  );
}
