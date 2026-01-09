import React, { useState } from 'react';
import { X } from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsModalProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onSave, onClose }) => {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);

  const handleSave = () => {
    onSave(localSettings);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-6 animate-fade-in">
      <div className="bg-dj-panel border border-dj-border w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-dj-dark/50">
          <h2 className="text-xl font-bold font-mono tracking-tight text-white uppercase flex items-center gap-2">
            <span className="w-2 h-2 bg-dj-neon rounded-full animate-pulse"></span>
            Application Settings
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-8 overflow-y-auto custom-scrollbar">
            
            {/* Export Settings Section */}
            <div>
                <h3 className="text-dj-neon text-xs font-bold uppercase tracking-widest mb-4 border-b border-dj-neon/20 pb-2">Export Configuration</h3>
                <div className="space-y-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-gray-400 font-mono uppercase">Export Filename</label>
                        <input 
                            type="text" 
                            value={localSettings.export.filenameFormat}
                            onChange={e => setLocalSettings({...localSettings, export: {...localSettings.export, filenameFormat: e.target.value}})}
                            className="bg-black/40 border border-dj-border p-2 text-sm text-white focus:border-dj-neon focus:outline-none font-mono placeholder-gray-600"
                            placeholder="cratebatch_export.xml"
                        />
                        <span className="text-[10px] text-gray-500">Default filename for exported XMLs.</span>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-gray-400 font-mono uppercase">Playlist Folder Name</label>
                        <input 
                            type="text" 
                            value={localSettings.export.folderName}
                            onChange={e => setLocalSettings({...localSettings, export: {...localSettings.export, folderName: e.target.value}})}
                            className="bg-black/40 border border-dj-border p-2 text-sm text-white focus:border-dj-neon focus:outline-none font-mono placeholder-gray-600"
                            placeholder="AI_GENERATED"
                        />
                         <span className="text-[10px] text-gray-500">Name of the root folder in Rekordbox for generated playlists.</span>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                        <input 
                            type="checkbox" 
                            checked={localSettings.export.backup}
                            onChange={e => setLocalSettings({...localSettings, export: {...localSettings.export, backup: e.target.checked}})}
                            className="accent-dj-neon w-4 h-4 cursor-pointer"
                        />
                        <div className="flex flex-col">
                            <label className="text-sm font-bold text-white uppercase cursor-pointer">Append Date to Filename</label>
                            <span className="text-[10px] text-gray-500">Adds _YYYY-MM-DD to the filename to prevent overwrites.</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Import Settings Section */}
            <div>
                <h3 className="text-dj-neon text-xs font-bold uppercase tracking-widest mb-4 border-b border-dj-neon/20 pb-2">Import Workflow</h3>
                <div className="space-y-4">
                     <div className="flex items-center gap-3">
                        <input 
                            type="checkbox" 
                            checked={localSettings.import.validateOnImport}
                            onChange={e => setLocalSettings({...localSettings, import: {...localSettings.import, validateOnImport: e.target.checked}})}
                            className="accent-dj-neon w-4 h-4 cursor-pointer"
                        />
                        <div className="flex flex-col">
                            <label className="text-sm font-bold text-white uppercase cursor-pointer">Validate on Import</label>
                            <span className="text-[10px] text-gray-500">Automatically check for duplicate IDs and missing data immediately after loading.</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-white/10 flex justify-end gap-3 bg-dj-dark/50">
            <button 
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold uppercase text-gray-400 hover:text-white transition-colors"
            >
                Cancel
            </button>
            <button 
                onClick={handleSave}
                className="px-6 py-2 bg-dj-neon text-black text-xs font-bold uppercase rounded-sm hover:bg-white transition-colors tracking-wider"
            >
                Save Changes
            </button>
        </div>

      </div>
    </div>
  );
};

export default SettingsModal;
