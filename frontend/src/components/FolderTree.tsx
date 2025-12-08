import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderPlus, Trash2, Edit2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Folder as FolderType } from '../lib/api';

interface FolderTreeProps {
    folders: FolderType[];
    activeFolderId: number | null;
    onSelectFolder: (folderId: number | null) => void;
    onCreateFolder: (name: string, parentId?: number) => void;
    onUpdateFolder: (id: number, name: string) => void;
    onDeleteFolder: (id: number) => void;
}

interface FolderItemProps {
    folder: FolderType;
    level: number;
    activeId: number | null;
    onSelect: (id: number) => void;
    folders: FolderType[];
    onCreate: (name: string, parentId?: number) => void;
    onUpdate: (id: number, name: string) => void;
    onDelete: (id: number) => void;
}

const FolderItem: React.FC<FolderItemProps> = ({
    folder,
    level,
    activeId,
    onSelect,
    folders,
    onCreate,
    onUpdate,
    onDelete
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(folder.name);
    const [showMenu, setShowMenu] = useState(false);

    // Find children
    const children = folders.filter(f => f.parent_id === folder.id);
    const hasChildren = children.length > 0;

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
    };

    const handleSelect = () => {
        onSelect(folder.id);
    };

    const startEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(true);
        setShowMenu(false);
    };

    const handleSaveEdit = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            onUpdate(folder.id, editName);
            setIsEditing(false);
        } else if (e.key === 'Escape') {
            setEditName(folder.name);
            setIsEditing(false);
        }
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this folder?')) {
            onDelete(folder.id);
        }
        setShowMenu(false);
    };

    return (
        <div>
            <div
                className={clsx(
                    "flex items-center group px-2 py-1.5 rounded-md cursor-pointer transition-colors relative",
                    activeId === folder.id
                        ? "bg-accent-primary/10 text-accent-primary"
                        : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-hover"
                )}
                style={{ paddingLeft: `${level * 12 + 8}px` }}
                onClick={handleSelect}
                onMouseEnter={() => setShowMenu(true)}
                onMouseLeave={() => setShowMenu(false)}
            >
                <div
                    className={clsx("p-0.5 rounded mr-1 hover:bg-black/5 transition-colors", !hasChildren && "invisible")}
                    onClick={handleToggle}
                >
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </div>

                <Folder
                    className={clsx(
                        "w-4 h-4 mr-2",
                        activeId === folder.id ? "fill-current" : ""
                    )}
                    style={{ color: folder.color }}
                />

                <div className="flex-1 truncate text-sm">
                    {isEditing ? (
                        <input
                            autoFocus
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={handleSaveEdit}
                            onBlur={() => setIsEditing(false)}
                            className="w-full bg-white dark:bg-dark-tertiary px-1 border border-accent-primary rounded focus:outline-none"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        folder.name
                    )}
                </div>

                {/* Action Menu - showed on hover */}
                {!isEditing && (showMenu || activeId === folder.id) && (
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-1 bg-inherit">
                        <button onClick={startEdit} className="p-1 hover:text-accent-primary" title="Rename">
                            <Edit2 className="w-3 h-3" />
                        </button>
                        <button onClick={handleDelete} className="p-1 hover:text-red-500" title="Delete">
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>

            {isOpen && hasChildren && (
                <div>
                    {children.map(child => (
                        <FolderItem
                            key={child.id}
                            folder={child}
                            level={level + 1}
                            activeId={activeId}
                            onSelect={onSelect}
                            folders={folders}
                            onCreate={onCreate}
                            onUpdate={onUpdate}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export const FolderTree: React.FC<FolderTreeProps> = ({
    folders,
    activeFolderId,
    onSelectFolder,
    onCreateFolder,
    onUpdateFolder,
    onDeleteFolder
}) => {
    const [newFolderName, setNewFolderName] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    // Get root folders
    const rootFolders = folders.filter(f => !f.parent_id);

    const handleCreateSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newFolderName.trim()) {
            onCreateFolder(newFolderName);
            setNewFolderName('');
            setIsCreating(false);
        }
    };

    return (
        <div className="py-2">
            <div className="flex items-center justify-between px-3 mb-2">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Folders
                </span>
                <button
                    onClick={() => setIsCreating(true)}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-dark-hover rounded transition-colors"
                    title="New Folder"
                >
                    <FolderPlus className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                </button>
            </div>

            <div
                className={clsx(
                    "flex items-center px-3 py-1.5 mb-1 cursor-pointer transition-colors",
                    activeFolderId === null
                        ? "bg-accent-primary/10 text-accent-primary border-r-2 border-accent-primary"
                        : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-hover"
                )}
                onClick={() => onSelectFolder(null)}
            >
                <Folder className="w-4 h-4 mr-2 opacity-50" />
                <span className="text-sm font-medium">All Documents</span>
            </div>

            {isCreating && (
                <form onSubmit={handleCreateSubmit} className="px-3 mb-2">
                    <input
                        autoFocus
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="Folder name..."
                        className="w-full text-sm px-2 py-1 bg-gray-50 dark:bg-dark-tertiary border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:border-accent-primary"
                        onBlur={() => !newFolderName && setIsCreating(false)}
                    />
                </form>
            )}

            <div className="space-y-0.5">
                {rootFolders.map(folder => (
                    <FolderItem
                        key={folder.id}
                        folder={folder}
                        level={0}
                        activeId={activeFolderId}
                        onSelect={onSelectFolder}
                        folders={folders}
                        onCreate={onCreateFolder}
                        onUpdate={onUpdateFolder}
                        onDelete={onDeleteFolder}
                    />
                ))}
            </div>
        </div>
    );
};
