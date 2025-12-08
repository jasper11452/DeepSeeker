
import { Outlet } from 'react-router-dom';
import { LeftSidebar } from '../components/LeftSidebar';
import { RightSidebar } from '../components/RightSidebar';
import { TitleBar } from '../components/TitleBar';

export function MainLayout() {
  return (
    <div className="h-screen flex flex-col bg-white dark:bg-dark-primary text-gray-900 dark:text-white overflow-hidden">
      <TitleBar />

      <div className="flex-1 flex overflow-hidden">
        <LeftSidebar />
        <main className="flex-1 flex flex-col relative min-w-0 bg-white dark:bg-dark-primary">
          <Outlet />
        </main>
        <RightSidebar />
      </div>
    </div>
  );
}