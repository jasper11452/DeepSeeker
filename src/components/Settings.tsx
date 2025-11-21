import { useState, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

interface AppConfig {
    model_path: string | null;
    indexing_rules: string[];
    theme: string;
    auto_reindex: boolean;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export default function Settings({ isOpen, onClose }: Props) {
    const [modelPath, setModelPath] = useState("");
    const [indexingRules, setIndexingRules] = useState<string[]>([]);
    const [newRule, setNewRule] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Load settings from backend when component mounts or dialog opens
    useEffect(() => {
        if (isOpen) {
            loadSettings();
        }
    }, [isOpen]);

    const loadSettings = async () => {
        try {
            setLoading(true);
            const config = await invoke<AppConfig>("get_app_settings");
            setModelPath(config.model_path || "");
            setIndexingRules(config.indexing_rules || []);
        } catch (error) {
            console.error("Failed to load settings:", error);
            showMessage("error", "Failed to load settings");
        } finally {
            setLoading(false);
        }
    };

    const saveSettings = async () => {
        try {
            setSaving(true);
            const config: AppConfig = {
                model_path: modelPath || null,
                indexing_rules: indexingRules,
                theme: "dark", // Keep current theme
                auto_reindex: true,
            };
            await invoke("save_app_settings", { config });
            showMessage("success", "Settings saved successfully");
        } catch (error) {
            console.error("Failed to save settings:", error);
            showMessage("error", "Failed to save settings");
        } finally {
            setSaving(false);
        }
    };

    const showMessage = (type: 'success' | 'error', text: string) => {
        setSaveMessage({ type, text });
        setTimeout(() => setSaveMessage(null), 3000);
    };

    const handleSelectModelPath = async () => {
        const selected = await openDialog({
            directory: true,
            multiple: false,
            title: "Select Model Directory",
        });

        if (selected) {
            setModelPath(selected as string);
        }
    };

    const handleAddRule = (e: React.FormEvent) => {
        e.preventDefault();
        if (newRule.trim()) {
            setIndexingRules([...indexingRules, newRule.trim()]);
            setNewRule("");
        }
    };

    const removeRule = (index: number) => {
        setIndexingRules(indexingRules.filter((_, i) => i !== index));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b border-white/5">
                    <h2 className="text-xl font-bold text-white">Settings</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {loading && (
                    <div className="p-6 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                )}

                {!loading && (
                    <div className="p-6 space-y-8">
                    {/* Model Path Section */}
                    <div>
                        <h3 className="text-sm font-medium text-indigo-300 uppercase tracking-wider mb-3">AI Model Configuration</h3>
                        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                            <label className="block text-sm text-slate-400 mb-2">Embedding Model Path</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={modelPath}
                                    readOnly
                                    placeholder="Default system path"
                                    className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none"
                                />
                                <button
                                    onClick={handleSelectModelPath}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors"
                                >
                                    Browse
                                </button>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">
                                Location of the BAAI/bge-m3 ONNX model files. Leave empty to use default.
                            </p>
                        </div>
                    </div>

                    {/* Indexing Rules Section */}
                    <div>
                        <h3 className="text-sm font-medium text-indigo-300 uppercase tracking-wider mb-3">Indexing Rules</h3>
                        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                            <label className="block text-sm text-slate-400 mb-2">Ignore Patterns (Glob)</label>

                            <form onSubmit={handleAddRule} className="flex gap-2 mb-4">
                                <input
                                    type="text"
                                    value={newRule}
                                    onChange={(e) => setNewRule(e.target.value)}
                                    placeholder="e.g. **/node_modules/**"
                                    className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500/50"
                                />
                                <button
                                    type="submit"
                                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
                                >
                                    Add
                                </button>
                            </form>

                            <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                                {indexingRules.length === 0 && (
                                    <p className="text-xs text-slate-600 italic text-center py-2">No custom rules defined</p>
                                )}
                                {indexingRules.map((rule, index) => (
                                    <div key={index} className="flex justify-between items-center bg-black/20 px-3 py-2 rounded-lg border border-white/5 group">
                                        <span className="text-sm text-slate-300 font-mono">{rule}</span>
                                        <button
                                            onClick={() => removeRule(index)}
                                            className="text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                )}

                <div className="p-6 border-t border-white/5 bg-black/20 flex items-center justify-between">
                    {/* Save Message */}
                    {saveMessage && (
                        <div className={`flex items-center gap-2 text-sm ${
                            saveMessage.type === 'success' ? 'text-green-400' : 'text-rose-400'
                        }`}>
                            {saveMessage.type === 'success' ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            )}
                            <span>{saveMessage.text}</span>
                        </div>
                    )}
                    {!saveMessage && <div></div>}

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                        <button
                            onClick={saveSettings}
                            disabled={saving || loading}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                        >
                            {saving ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                    <span>Saving...</span>
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                    </svg>
                                    <span>Save</span>
                                </>
                            )}
                        </button>
                        <button
                            onClick={onClose}
                            disabled={saving}
                            className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
