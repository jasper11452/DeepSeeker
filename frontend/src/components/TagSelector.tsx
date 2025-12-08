import React, { useState } from 'react';
import { Tag as TagType } from '../lib/api';
import { Plus, X } from 'lucide-react';
import { clsx } from 'clsx';

interface TagSelectorProps {
    tags: TagType[];
    selectedTagId: number | null;
    onSelectTag: (tagId: number | null) => void;
    onCreateTag: (name: string) => void;
    onDeleteTag: (id: number) => void;
}

export const TagSelector: React.FC<TagSelectorProps> = ({
    tags,
    selectedTagId,
    onSelectTag,
    onCreateTag,
    onDeleteTag
}) => {
    const [isCreating, setIsCreating] = useState(false);
    const [newTagName, setNewTagName] = useState('');

    const handleCreateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newTagName.trim()) {
            onCreateTag(newTagName);
            setNewTagName('');
            setIsCreating(false);
        }
    };

    const handleDelete = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (confirm('Delete this tag?')) {
            onDeleteTag(id);
        }
    };

    return (
        <div className="py-2">
            <div className="flex items-center justify-between px-3 mb-2">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Tags
                </span>
                <button
                    onClick={() => setIsCreating(true)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-dark-hover rounded transition-colors"
                    title="New Tag"
                >
                    <Plus className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                </button>
            </div>

            {isCreating && (
                <form onSubmit={handleCreateSubmit} className="px-3 mb-2">
                    <input
                        autoFocus
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="Tag name..."
                        className="w-full text-sm px-2 py-1 bg-gray-50 dark:bg-dark-tertiary border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:border-accent-primary"
                        onBlur={() => !newTagName && setIsCreating(false)}
                    />
                </form>
            )}

            <div className="px-3 space-y-1">
                {tags.map(tag => (
                    <div
                        key={tag.id}
                        className={clsx(
                            "flex items-center justify-between group px-2 py-1.5 rounded-md cursor-pointer transition-colors text-sm",
                            selectedTagId === tag.id
                                ? "bg-accent-primary/10 text-accent-primary"
                                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-hover"
                        )}
                        onClick={() => onSelectTag(selectedTagId === tag.id ? null : tag.id)}
                    >
                        <div className="flex items-center gap-2 truncate">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                            <span className="truncate">{tag.name}</span>
                            {tag.document_count !== undefined && (
                                <span className="text-xs opacity-50">({tag.document_count})</span>
                            )}
                        </div>

                        <button
                            onClick={(e) => handleDelete(e, tag.id)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 hover:text-red-500 rounded transition-all"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
