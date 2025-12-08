import { create } from 'zustand';
import { conversationsApi } from '../lib/api';
import { Conversation, Message } from '../types/conversation';

interface ConversationStore {
  conversations: Conversation[];
  activeId: string | null;
  isLoading: boolean;

  create: () => Promise<string>;
  select: (id: string) => void;
  delete: (id: string) => Promise<void>;
  updateTitle: (id: string, title: string) => Promise<void>;
  addMessage: (id: string, msg: Message) => void;
  search: (query: string) => Promise<void>;
  fetchConversations: () => Promise<void>;
}

export const useConversationStore = create<ConversationStore>((set) => ({
  conversations: [],
  activeId: null,
  isLoading: false,

  fetchConversations: async () => {
    set({ isLoading: true });
    try {
      const data = await conversationsApi.list();
      set({ conversations: data });
    } finally {
      set({ isLoading: false });
    }
  },

  create: async () => {
    const newConv = await conversationsApi.create();
    set(state => ({
      conversations: [newConv, ...state.conversations],
      activeId: newConv.id
    }));
    return newConv.id;
  },

  select: (id) => set({ activeId: id }),

  delete: async (id) => {
    await conversationsApi.delete(id);
    set(state => ({
      conversations: state.conversations.filter(c => c.id !== id),
      activeId: state.activeId === id ? null : state.activeId
    }));
  },

  updateTitle: async (id, title) => {
    await conversationsApi.update(id, { title });
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === id ? { ...c, title } : c
      )
    }));
  },

  addMessage: (id, _msg) => {
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === id ? { ...c, message_count: c.message_count + 1, updated_at: new Date().toISOString() } : c
      )
    }));
  },

  search: async (query) => {
    set({ isLoading: true });
    try {
      const data = await conversationsApi.list(query);
      set({ conversations: data });
    } finally {
      set({ isLoading: false });
    }
  }
}));
