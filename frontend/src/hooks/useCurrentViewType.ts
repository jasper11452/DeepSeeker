import { useLocation } from 'react-router-dom';

export type ViewType = 'library' | 'document' | 'chat';

export const useCurrentViewType = (): ViewType => {
  const location = useLocation();
  if (location.pathname.startsWith('/chat')) return 'chat';
  if (location.pathname.startsWith('/document')) return 'document';
  return 'library';
};
