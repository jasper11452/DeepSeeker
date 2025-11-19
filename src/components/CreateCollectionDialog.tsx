import { useState } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, linkFolder: boolean) => Promise<void>;
}

export default function CreateCollectionDialog({ isOpen, onClose, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [linkFolder, setLinkFolder] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      await onSubmit(name.trim(), linkFolder);
      setName("");
      setLinkFolder(false);
      onClose();
    }
  };

  const handleCancel = () => {
    setName("");
    setLinkFolder(false);
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={handleCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Create New Collection</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="collection-name">Collection Name</label>
            <input
              type="text"
              id="collection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter collection name"
              autoFocus
            />
          </div>
          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={linkFolder}
                onChange={(e) => setLinkFolder(e.target.checked)}
              />
              <span>Link to a specific folder</span>
            </label>
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={handleCancel} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim()}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
