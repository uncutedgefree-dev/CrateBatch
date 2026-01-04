import React from 'react';
import { AlertTriangle, ListFilter, Layers, XCircle } from 'lucide-react';

interface EnrichmentWarningModalProps {
  filteredCount: number;
  totalCount: number;
  onProcessFiltered: () => void;
  onProcessAll: () => void;
  onCancel: () => void;
}

const EnrichmentWarningModal: React.FC<EnrichmentWarningModalProps> = ({ 
  filteredCount, 
  totalCount, 
  onProcessFiltered, 
  onProcessAll, 
  onCancel 
}) => {
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-dj-panel border border-dj-border w-full max-w-md rounded-xl flex flex-col shadow-2xl overflow-hidden animate-fade-in-up">
        
        {/* Header */}
        <div className="p-6 bg-yellow-500/10 border-b border-yellow-500/20 flex items-start gap-4">
          <div className="p-3 bg-yellow-500/20 rounded-full">
             <AlertTriangle className="w-6 h-6 text-yellow-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Active Filter Detected</h2>
            <p className="text-sm text-dj-dim mt-1">
              You are currently viewing a subset of your library. How would you like to proceed?
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          
          <button 
            onClick={onProcessFiltered}
            className="w-full flex items-center gap-4 p-4 rounded-lg border border-dj-neon/30 bg-dj-neon/5 hover:bg-dj-neon/10 transition-all group text-left"
          >
            <div className="p-2 bg-dj-neon/20 rounded text-dj-neon group-hover:scale-110 transition-transform">
              <ListFilter className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white">Process {filteredCount} Filtered Tracks</div>
              <div className="text-xs text-dj-dim">Only enrich the tracks currently visible.</div>
            </div>
          </button>

          <button 
             onClick={onProcessAll}
             className="w-full flex items-center gap-4 p-4 rounded-lg border border-dj-border bg-dj-dark hover:bg-white/5 transition-all group text-left"
          >
            <div className="p-2 bg-dj-dim/20 rounded text-dj-dim group-hover:text-white transition-colors">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white">Process All {totalCount} Tracks</div>
              <div className="text-xs text-dj-dim">Clear filters and enrich entire library.</div>
            </div>
          </button>

        </div>

        {/* Footer */}
        <div className="p-4 bg-dj-dark border-t border-dj-border flex justify-end">
          <button 
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white flex items-center gap-2 transition-colors"
          >
            <XCircle className="w-4 h-4" /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnrichmentWarningModal;