import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RekordboxTrack } from '../types';

interface TrackTableProps {
  tracks: RekordboxTrack[];
  onAnalyzeTrack: (trackId: string) => void;
  analyzingIds: Set<string>;
  scrollElement: HTMLElement | null;
}

const GRID_TEMPLATE = "60px 3fr 2fr 1.5fr 60px 70px 70px 70px 2.5fr";

const TrackRow = React.memo<{
  track: RekordboxTrack;
  isAnalyzing: boolean;
  onAnalyze: (id: string) => void;
  style: React.CSSProperties;
}>(({ track, isAnalyzing, onAnalyze, style }) => {
  return (
    <div 
      className={`grid border-b border-dj-border/30 hover:bg-white/5 transition-colors duration-150 items-center text-sm absolute top-0 left-0 w-full bg-dj-panel ${isAnalyzing ? 'scanline-effect bg-dj-neon/5' : ''}`}
      style={{ ...style, gridTemplateColumns: GRID_TEMPLATE }}
    >
      <div className="px-4 text-dj-dim font-mono text-xs truncate">{track.TrackID}</div>
      <div className={`px-4 font-medium truncate ${isAnalyzing ? 'text-dj-neon' : 'text-white'}`} title={track.Name}>{track.Name}</div>
      <div className="px-4 text-gray-300 truncate" title={track.Artist}>{track.Artist}</div>
      <div className="px-4 text-gray-300 truncate">{track.Genre || '-'}</div>
      <div className="px-4 text-gray-400 font-mono text-center">{track.Year || '-'}</div>
      <div className="px-4 text-dj-neon font-mono text-right">{track.AverageBpm}</div>
      <div className="px-4 text-center">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${track.Tonality ? 'border-purple-500/50 text-purple-300 bg-purple-500/10' : 'border-transparent text-gray-600'}`}>{track.Tonality || '-'}</span>
      </div>
      <div className="px-4 text-center">
        {track.Energy && <span className={`inline-block w-6 h-6 leading-6 rounded-full text-xs font-bold text-black ${parseInt(track.Energy) >= 8 ? 'bg-red-500' : parseInt(track.Energy) >= 5 ? 'bg-yellow-400' : 'bg-blue-400'}`}>{track.Energy}</span>}
      </div>
      <div className="px-4 h-full flex items-center overflow-hidden">
        {track.Analysis ? (
          <div className="flex flex-nowrap gap-2 overflow-x-auto no-scrollbar w-full items-center">
            <span className="shrink-0 px-2 py-1 rounded bg-dj-neon/10 border border-dj-neon/50 text-dj-neon text-[10px] font-bold whitespace-nowrap">{track.Analysis.vibe}</span>
            <span className="shrink-0 px-2 py-1 rounded bg-dj-accent/10 border border-dj-accent/50 text-dj-accent text-[10px] font-bold whitespace-nowrap">{track.Analysis.genre}</span>
            <span className="shrink-0 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/50 text-blue-300 text-[10px] font-bold whitespace-nowrap">{track.Analysis.situation}</span>
          </div>
        ) : (
          <button 
            onClick={() => onAnalyze(track.TrackID)} 
            disabled={isAnalyzing} 
            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded border transition-all ${isAnalyzing ? 'border-dj-neon text-dj-neon animate-pulse-neon cursor-wait' : 'border-dj-border text-gray-400 hover:border-dj-neon hover:text-dj-neon hover:shadow-[0_0_10px_rgba(0,243,255,0.3)]'}`}
          >
            {isAnalyzing ? "Processing..." : "Tag"}
          </button>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.isAnalyzing === next.isAnalyzing && 
         prev.track.TrackID === next.track.TrackID && 
         prev.track.Analysis === next.track.Analysis && 
         prev.track.Genre === next.track.Genre && 
         prev.track.Year === next.track.Year;
});

const TrackTable: React.FC<TrackTableProps> = ({ tracks, onAnalyzeTrack, analyzingIds, scrollElement }) => {
  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 56,
    overscan: 20, 
  });

  return (
    <div className="w-full bg-dj-panel rounded-lg border border-dj-border shadow-2xl overflow-hidden mb-12 min-h-[500px]">
      <div className="grid bg-dj-dark text-[10px] uppercase text-dj-dim font-mono tracking-widest border-b border-dj-border shadow-md z-40 sticky top-0" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
        <div className="p-4">ID</div><div className="p-4">Title</div><div className="p-4">Artist</div><div className="p-4">Genre</div><div className="p-4 text-center">Year</div><div className="p-4 text-right">BPM</div><div className="p-4 text-center">Key</div><div className="p-4 text-center">NRG</div><div className="p-4">AI Analysis</div>
      </div>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <TrackRow
            key={tracks[virtualRow.index].TrackID} 
            track={tracks[virtualRow.index]}
            isAnalyzing={analyzingIds.has(tracks[virtualRow.index].TrackID)}
            onAnalyze={onAnalyzeTrack}
            style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
          />
        ))}
      </div>
    </div>
  );
};

export default TrackTable;
