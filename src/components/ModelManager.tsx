import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

export default function ModelManager() {
    const [hasModel, setHasModel] = useState<boolean | null>(null);
    const [isChecking, setIsChecking] = useState(false);

    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        setIsChecking(true);
        try {
            const status = await invoke('check_model_status');
            setHasModel(status as boolean);
        } catch (e) {
            console.error("Failed to check model status:", e);
        } finally {
            setIsChecking(false);
        }
    };

    const openModelLink = async () => {
        await open('https://huggingface.co/BAAI/bge-m3/tree/main');
    };

    if (hasModel === null) return null;

    if (hasModel) {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 rounded-full text-xs border border-emerald-500/20 backdrop-blur-md shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-[pulse_2s_infinite]" />
                <span className="font-medium tracking-wide">NEURAL ENGINE ACTIVE</span>
            </div>
        );
    }

    return (
        <div className="mt-4 p-5 bg-rose-500/5 border border-rose-500/20 rounded-xl backdrop-blur-md relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-rose-500/10 rounded-lg">
                        <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h3 className="text-rose-200 font-semibold tracking-wide text-sm">AI Model Missing</h3>
                </div>

                <p className="text-xs text-rose-200/70 mb-4 leading-relaxed">
                    To enable semantic search capabilities, you need to download the BAAI/bge-m3 model files manually.
                </p>

                <div className="text-[10px] font-mono text-rose-200/50 mb-4 bg-black/20 p-3 rounded-lg border border-white/5">
                    <div className="mb-1">Target Directory:</div>
                    <div className="text-rose-200/80 select-all">~/.deepseeker/models/bge-m3/</div>
                    <div className="mt-2 mb-1">Required Files:</div>
                    <ul className="list-disc list-inside text-rose-200/80">
                        <li>model.onnx</li>
                        <li>tokenizer.json</li>
                    </ul>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={openModelLink}
                        className="flex-1 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium rounded-lg transition-all duration-200 border border-rose-500/20 hover:border-rose-500/30 flex items-center justify-center gap-2"
                    >
                        <span>Download Files</span>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </button>
                    <button
                        onClick={checkStatus}
                        disabled={isChecking}
                        className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/80 text-xs font-medium rounded-lg transition-all duration-200 border border-white/10 hover:border-white/20"
                    >
                        {isChecking ? 'Checking...' : 'Check Again'}
                    </button>
                </div>
            </div>
        </div>
    );
}
