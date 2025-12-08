import { useQuery } from '@tanstack/react-query';
import { conversationsApi } from '../lib/api';

export const useConversation = (id: string | undefined) => {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => id ? conversationsApi.get(id) : null,
    enabled: !!id,
  });
};
