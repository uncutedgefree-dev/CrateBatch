import React, { useState, useEffect, useRef } from 'react';
import { Save, X } from 'lucide-react';

interface PlaylistNameModalProps {
  defaultValue: string;
  count: number;
  onSave: (name: string) => void;
  onClose: () => void;
}

const PlaylistNameModal: React.FC<PlaylistNameModalProps> = ({ defaultValue, count, onSave, onClose }) => {
  const [name, setName] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-dj-panel border border-dj-border w-full max-w-md rounded-xl shadow-2xl overflow-hidden scale-100 animate-fade-in-up">
        <div className="p-6 border-b border-dj-border flex justify-between items-center bg-dj-dark/50">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Save className="w-5 h-5 text-dj-neon" />
            Save Playlist
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-6">
            <label className="block text-xs text-dj-dim uppercase font-bold mb-2">
              Playlist Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-dj-dark border border-dj-border rounded p-3 text-white focus:border-dj-neon focus:ring-1 focus:ring-dj-neon/50 outline-none transition-all font-mono"
              placeholder="e.g. 90s Techno Peak Hour"
            />
            <p className="text-xs text-dj-dim mt-2">
              This will create a new playlist in <span className="text-dj-neon">AI_GENERATED / SAVED_SEARCHES</span> containing <span className="text-white font-bold">{count}</span> tracks.
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-6 py-2 rounded text-sm font-bold bg-dj-neon text-black hover:bg-white hover:shadow-[0_0_15px_rgba(0,243,255,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Save Playlist
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PlaylistNameModal;