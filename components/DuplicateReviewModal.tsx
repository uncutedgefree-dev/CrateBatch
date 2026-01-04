import React, { useState, useEffect } from 'react';
import { DuplicateGroup } from '../types';
import { X, CheckCircle, Zap, ListMusic } from 'lucide-react';

interface DuplicateReviewModalProps {
  groups: DuplicateGroup[];
  onClose: () => void;
}

const DuplicateReviewModal: React.FC<DuplicateReviewModalProps> = ({ groups, onClose }) => {
  const [selectedKeepIds, setSelectedKeepIds] = useState<Record<string, string>>({});

  // Smart Selection Logic: Runs once on mount
  useEffect(() => {
    const initialSelections: Record<string, string> = {};
    groups.forEach(group => {
      // Find the "Best" track to keep
      // Priority 1: Most Cue Points (implies metadata work done)
      // Priority 2: Highest Bitrate (implies quality)
      const bestTrack = group.tracks.reduce((prev, current) => {
        const prevCues = prev.CueCount || 0;
        const currCues = current.CueCount || 0;
        
        if (currCues > prevCues) return current;
        if (currCues < prevCues) return prev;
        
        // Tie-breaker: Bitrate
        const prevBit = parseInt(prev.BitRate || "0");
        const currBit = parseInt(current.BitRate || "0");
        if (currBit > prevBit) return current;
        
        return prev;
      }, group.tracks[0]);

      initialSelections[group.fingerprint] = bestTrack.TrackID;
    });
    setSelectedKeepIds(initialSelections);
  }, [groups]);

  const handleSelect = (fingerprint: string, trackId: string) => {
    setSelectedKeepIds(prev => ({ ...prev, [fingerprint]: trackId }));
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-dj-panel border border-dj-border w-full max-w-6xl max-h-[90vh] rounded-xl flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-dj-border flex justify-between items-center bg-dj-dark/50">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <span className="text-red-500">Duplicate</span> Inspector
            </h2>
            <p className="text-dj-dim text-sm mt-1">
              Found {groups.length} conflicts. Smart-selected based on <span className="text-dj-neon font-bold">Cue Points</span> & <span className="text-dj-accent font-bold">Bitrate</span>.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {groups.map((group, idx) => (
            <div key={idx} className="bg-dj-dark border border-dj-border rounded-lg overflow-hidden animate-fade-in">
              <div className="px-4 py-2 bg-white/5 border-b border-dj-border/50 flex justify-between items-center">
                <span className="text-xs font-mono text-dj-dim uppercase tracking-wider">
                  Conflict Group #{idx + 1}
                </span>
                <span className="text-xs font-mono text-dj-neon truncate max-w-md" title={group.fingerprint}>
                  {group.tracks[0].Artist} - {group.tracks[0].Name}
                </span>
              </div>
              
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-dj-border/30 text-xs text-dj-dim uppercase">
                    <th className="p-4 w-16 text-center">Action</th>
                    <th className="p-4">Track Details</th>
                    <th className="p-4 w-32">Quality</th>
                    <th className="p-4 w-32 text-center">Cues</th>
                    <th className="p-4 w-24 text-center">Energy</th>
                    <th className="p-4 w-24 text-right">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dj-border/10">
                  {group.tracks.map((track) => {
                    const isSelected = selectedKeepIds[group.fingerprint] === track.TrackID;
                    const cueCount = track.CueCount || 0;
                    const bitrate = parseInt(track.BitRate || "0");
                    const energy = parseInt(track.Energy || "0");

                    return (
                      <tr 
                        key={track.TrackID} 
                        onClick={() => handleSelect(group.fingerprint, track.TrackID)}
                        className={`
                          cursor-pointer transition-colors
                          ${isSelected ? 'bg-green-500/5 hover:bg-green-500/10' : 'hover:bg-white/5'}
                        `}
                      >
                        <td className="p-4 text-center">
                          <div className={`
                            w-5 h-5 rounded-full border mx-auto flex items-center justify-center transition-all
                            ${isSelected ? 'bg-green-500 border-green-500' : 'border-gray-500'}
                          `}>
                            {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                          </div>
                        </td>
                        
                        <td className="p-4">
                          <div className={`font-medium ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                            {track.Name}
                          </div>
                          <div className="text-dj-dim text-xs">{track.Artist}</div>
                          <div className="text-xs text-gray-600 font-mono mt-1">{track.TrackID}</div>
                        </td>

                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className={`font-mono font-bold ${bitrate >= 320 ? 'text-dj-neon' : 'text-yellow-500'}`}>
                              {track.BitRate}kbps
                            </span>
                            <span className="text-xs text-gray-500 uppercase">{track.Kind}</span>
                          </div>
                        </td>

                        <td className="p-4 text-center">
                          <div className={`
                            inline-flex items-center gap-1 px-2 py-1 rounded-md font-mono font-bold
                            ${cueCount > 0 
                              ? 'bg-dj-neon/20 text-dj-neon border border-dj-neon/30' 
                              : 'text-gray-600 bg-white/5'
                            }
                          `}>
                            <ListMusic className="w-3 h-3" />
                            {cueCount}
                          </div>
                        </td>

                        <td className="p-4 text-center">
                          {energy > 0 ? (
                             <span className={`
                              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold text-black
                              ${energy >= 8 ? 'bg-red-500' : energy >= 5 ? 'bg-yellow-400' : 'bg-blue-400'}
                             `}>
                               <Zap className="w-3 h-3 fill-black" /> {energy}
                             </span>
                          ) : (
                            <span className="text-gray-600">-</span>
                          )}
                        </td>

                        <td className="p-4 text-right font-mono text-gray-400">
                          {track.Size ? `${(parseInt(track.Size)/1024/1024).toFixed(1)}MB` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
          
          {groups.length === 0 && (
             <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <CheckCircle className="w-16 h-16 mb-4 opacity-20" />
                <p>No duplicate conflicts found.</p>
             </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-dj-border bg-dj-dark/80 backdrop-blur text-center text-xs text-dj-dim flex justify-between items-center px-8">
           <div className="text-left">
             <p className="text-white">Review Selection</p>
             <p>Selected tracks will be kept. Others will be marked in the duplicate report.</p>
           </div>
           <button 
             onClick={onClose}
             className="px-6 py-2 bg-dj-neon text-black font-bold rounded hover:bg-white hover:shadow-[0_0_15px_rgba(255,255,255,0.4)] transition-all"
           >
             Finish Review
           </button>
        </div>
      </div>
    </div>
  );
};

export default DuplicateReviewModal;