import { useState, useEffect } from "react";

export interface SearchFiltersState {
    fileTypes: string[];
}

interface Props {
    onFilterChange: (filters: SearchFiltersState) => void;
}

export default function SearchFilters({ onFilterChange }: Props) {
    const [fileTypes, setFileTypes] = useState<string[]>([]);

    const availableTypes = [
        { id: "md", label: "Markdown" },
        { id: "pdf", label: "PDF" },
        { id: "code", label: "Code" },
        { id: "txt", label: "Text" },
    ];

    const toggleFileType = (typeId: string) => {
        setFileTypes((prev) => {
            const newTypes = prev.includes(typeId)
                ? prev.filter((t) => t !== typeId)
                : [...prev, typeId];
            return newTypes;
        });
    };

    useEffect(() => {
        onFilterChange({ fileTypes });
    }, [fileTypes, onFilterChange]);

    return (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
            {availableTypes.map((type) => (
                <button
                    key={type.id}
                    onClick={() => toggleFileType(type.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap ${fileTypes.includes(type.id)
                            ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200 shadow-[0_0_10px_rgba(99,102,241,0.2)]"
                            : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-300"
                        }`}
                >
                    {type.label}
                </button>
            ))}
        </div>
    );
}
