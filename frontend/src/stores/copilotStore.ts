import { create } from 'zustand';
import { ChunkDetail, RelevantChunk } from '../lib/api';

interface CopilotStore {
    // 当前查看的 chunk 详情（点击引用时显示）
    activeChunkDetail: ChunkDetail | null;
    isLoadingChunk: boolean;

    // 实时推荐的相关知识
    recommendations: RelevantChunk[];
    isLoadingRecommendations: boolean;

    // 用户当前输入（用于实时推荐）
    currentQuery: string;

    // Actions
    setActiveChunkDetail: (detail: ChunkDetail | null) => void;
    setLoadingChunk: (loading: boolean) => void;
    setRecommendations: (chunks: RelevantChunk[]) => void;
    setLoadingRecommendations: (loading: boolean) => void;
    setCurrentQuery: (query: string) => void;
    clearActiveChunk: () => void;
    reset: () => void;
}

export const useCopilotStore = create<CopilotStore>((set) => ({
    activeChunkDetail: null,
    isLoadingChunk: false,
    recommendations: [],
    isLoadingRecommendations: false,
    currentQuery: '',

    setActiveChunkDetail: (detail) => set({ activeChunkDetail: detail }),
    setLoadingChunk: (loading) => set({ isLoadingChunk: loading }),
    setRecommendations: (chunks) => set({ recommendations: chunks }),
    setLoadingRecommendations: (loading) => set({ isLoadingRecommendations: loading }),
    setCurrentQuery: (query) => set({ currentQuery: query }),
    clearActiveChunk: () => set({ activeChunkDetail: null }),
    reset: () => set({
        activeChunkDetail: null,
        isLoadingChunk: false,
        recommendations: [],
        isLoadingRecommendations: false,
        currentQuery: '',
    }),
}));
