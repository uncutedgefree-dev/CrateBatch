import React from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { RekordboxTrack } from '../types';

interface TrackTableProps {
  tracks: RekordboxTrack[];
  onAnalyzeTrack: (trackId: string) => void;
  analyzingIds: Set<string>;
}

// CSS Grid Template for alignment consistency
// Added 60px column for Year
const GRID_TEMPLATE = "60px 3fr 2fr 1.5fr 60px 70px 70px 70px 2.5fr";

// Memoized Row Component
const TrackRow = React.memo<{
  track: RekordboxTrack;
  isAnalyzing: boolean;
  onAnalyze: (id: string) => void;
  style: React.CSSProperties;
}>(({ track, isAnalyzing, onAnalyze, style }) => {
  return (
    <div 
      className="grid border-b border-dj-border/30 hover:bg-white/5 transition-colors duration-150 items-center text-sm absolute top-0 left-0 w-full"
      style={{
        ...style,
        gridTemplateColumns: GRID_TEMPLATE
      }}
    >
      <div className="px-4 text-dj-dim font-mono text-xs truncate">
        {track.TrackID}
      </div>
      <div className="px-4 text-white font-medium truncate" title={track.Name}>
        {track.Name}
      </div>
      <div className="px-4 text-gray-300 truncate" title={track.Artist}>
        {track.Artist}
      </div>
      <div className="px-4 text-gray-300 truncate" title={track.Genre}>
        {track.Genre || '-'}
      </div>
      <div className="px-4 text-gray-400 font-mono text-center">
        {track.Year || '-'}
      </div>
      <div className="px-4 text-dj-neon font-mono text-right">
        {track.AverageBpm}
      </div>
      <div className="px-4 text-center">
        <span className={`
          inline-block px-2 py-0.5 rounded text-xs font-bold border
          ${track.Tonality 
            ? 'border-purple-500/50 text-purple-300 bg-purple-500/10' 
            : 'border-transparent text-gray-600'
          }
        `}>
          {track.Tonality || '-'}
        </span>
      </div>
      <div className="px-4 text-center">
        {track.Energy && (
          <span className={`
            inline-block w-6 h-6 leading-6 rounded-full text-xs font-bold text-black
            ${parseInt(track.Energy) >= 8 ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' :
              parseInt(track.Energy) >= 5 ? 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]' :
              'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)]'}
          `}>
            {track.Energy}
          </span>
        )}
      </div>
      <div className="px-4 h-full flex items-center overflow-hidden">
        {track.Analysis ? (
          <div className="flex flex-nowrap gap-2 overflow-x-auto no-scrollbar w-full items-center">
            <span className="shrink-0 px-2 py-1 rounded bg-dj-neon/10 border border-dj-neon/50 text-dj-neon text-xs font-bold whitespace-nowrap">
              {track.Analysis.vibe}
            </span>
            <span className="shrink-0 px-2 py-1 rounded bg-dj-accent/10 border border-dj-accent/50 text-dj-accent text-xs font-bold whitespace-nowrap">
              {track.Analysis.genre}
            </span>
            <span className="shrink-0 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/50 text-blue-300 text-xs font-bold whitespace-nowrap">
              {track.Analysis.situation}
            </span>
          </div>
        ) : (
          <button
            onClick={() => onAnalyze(track.TrackID)}
            disabled={isAnalyzing}
            className={`
              text-xs px-3 py-1 rounded border transition-all duration-200 whitespace-nowrap
              ${isAnalyzing
                ? 'border-dj-dim text-dj-dim cursor-wait'
                : 'border-dj-border text-gray-400 hover:border-dj-neon hover:text-dj-neon hover:shadow-[0_0_10px_rgba(0,243,255,0.3)]'
              }
            `}
          >
            {isAnalyzing ? "Thinking..." : "Generate Tags"}
          </button>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.isAnalyzing === nextProps.isAnalyzing &&
    prevProps.track.TrackID === nextProps.track.TrackID &&
    prevProps.track.Analysis === nextProps.track.Analysis &&
    prevProps.track.Genre === nextProps.track.Genre &&
    prevProps.track.Year === nextProps.track.Year &&
    prevProps.track.Name === nextProps.track.Name 
  );
});

const TrackTable: React.FC<TrackTableProps> = ({ tracks, onAnalyzeTrack, analyzingIds }) => {
  // Use window virtualizer for full-page scrolling
  const rowVirtualizer = useWindowVirtualizer({
    count: tracks.length,
    estimateSize: () => 56, // Approximate row height in px
    overscan: 20, 
  });

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-dj-dim bg-dj-panel rounded-lg border border-dj-border">
        <p>No tracks to display.</p>
      </div>
    );
  }

  return (
    <div className="w-full bg-dj-panel rounded-lg border border-dj-border shadow-2xl overflow-hidden mb-12">
      {/* Sticky Header - Offset top-16 to sit below main app header */}
      <div 
        className="grid bg-dj-dark/95 backdrop-blur text-xs uppercase text-dj-dim font-mono tracking-wider border-b border-dj-border shadow-md z-40 sticky top-16"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
      >
        <div className="p-4">ID</div>
        <div className="p-4">Track Title</div>
        <div className="p-4">Artist</div>
        <div className="p-4">Genre</div>
        <div className="p-4 text-center">Year</div>
        <div className="p-4 text-right">BPM</div>
        <div className="p-4 text-center">Key</div>
        <div className="p-4 text-center">Energy</div>
        <div className="p-4">AI Analysis</div>
      </div>

      {/* Virtualized Body */}
      <div 
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const track = tracks[virtualRow.index];
          return (
            <TrackRow
              key={track.TrackID} 
              track={track}
              isAnalyzing={analyzingIds.has(track.TrackID)}
              onAnalyze={onAnalyzeTrack}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
              }}
            />
          );
        })}
      </div>
      
      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default TrackTable;