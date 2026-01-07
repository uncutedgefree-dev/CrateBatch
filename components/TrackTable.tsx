import React, { useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RekordboxTrack } from '../types';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface TrackTableProps {
  tracks: RekordboxTrack[];
  onAnalyzeTrack: (trackId: string) => void;
  analyzingIds: Set<string>;
  scrollElement: HTMLElement | null;
}

type SortField = 'index' | 'TrackID' | 'Name' | 'Artist' | 'Genre' | 'Year' | 'AverageBpm' | 'Tonality' | 'Energy';
type SortOrder = 'asc' | 'desc';

// Updated grid template to include index column
const GRID_TEMPLATE = "50px 60px 3fr 2fr 1.5fr 60px 70px 70px 70px 2.5fr";

const TrackRow = React.memo<{
  track: RekordboxTrack;
  index: number;
  isAnalyzing: boolean;
  onAnalyze: (id: string) => void;
  style: React.CSSProperties;
}>(({ track, index, isAnalyzing, onAnalyze, style }) => {
  return (
    <div 
      className={`grid border-b border-dj-border/30 hover:bg-white/5 transition-colors duration-150 items-center text-sm absolute top-0 left-0 w-full bg-dj-panel ${isAnalyzing ? 'scanline-effect bg-dj-neon/5' : ''}`}
      style={{ ...style, gridTemplateColumns: GRID_TEMPLATE }}
    >
      <div className="px-4 text-dj-dim font-mono text-xs text-right">{index + 1}</div>
      <div className="px-4 text-dj-dim font-mono text-xs truncate">{track.TrackID}</div>
      <div className={`px-4 font-medium truncate ${isAnalyzing ? 'text-dj-neon' : 'text-white'}`} title={track.Name}>{track.Name}</div>
      <div className="px-4 text-gray-300 truncate" title={track.Artist}>{track.Artist}</div>
      <div className="px-4 text-gray-300 truncate">{track.Genre || '-'}</div>
      <div className="px-4 text-gray-400 font-mono text-center">{track.Year || '-'}</div>
      <div className="px-4 text-dj-neon font-mono text-right">{track.AverageBpm}</div>
      <div className="px-4 text-center">
        <span className={`inline-block px-2 py-0.5 rounded-sm text-xs font-bold border ${track.Tonality ? 'border-purple-500/50 text-purple-300 bg-purple-500/10' : 'border-transparent text-gray-600'}`}>{track.Tonality || '-'}</span>
      </div>
      <div className="px-4 text-center">
        {track.Energy && <span className={`inline-block w-6 h-6 leading-6 rounded-full text-xs font-bold font-mono text-black ${parseInt(track.Energy) >= 8 ? 'bg-red-500' : parseInt(track.Energy) >= 5 ? 'bg-yellow-400' : 'bg-blue-400'}`}>{track.Energy}</span>}
      </div>
      <div className="px-4 h-full flex items-center overflow-hidden">
        {track.Analysis ? (
          <div className="flex flex-nowrap gap-2 overflow-x-auto no-scrollbar w-full items-center">
            <span className="shrink-0 px-2 py-1 rounded-sm bg-dj-neon/10 border border-dj-neon/50 text-dj-neon text-[10px] font-bold font-mono whitespace-nowrap uppercase tracking-wider">{track.Analysis.vibe}</span>
            <span className="shrink-0 px-2 py-1 rounded-sm bg-dj-accent/10 border border-dj-accent/50 text-dj-accent text-[10px] font-bold font-mono whitespace-nowrap uppercase tracking-wider">{track.Analysis.genre}</span>
            <span className="shrink-0 px-2 py-1 rounded-sm bg-blue-500/10 border border-blue-500/50 text-blue-300 text-[10px] font-bold font-mono whitespace-nowrap uppercase tracking-wider">{track.Analysis.situation}</span>
          </div>
        ) : (
          <button 
            onClick={() => onAnalyze(track.TrackID)} 
            disabled={isAnalyzing} 
            className={`text-[10px] font-bold font-mono uppercase tracking-widest px-3 py-1 rounded-sm border transition-all ${isAnalyzing ? 'border-dj-neon text-dj-neon animate-pulse-neon cursor-wait' : 'border-dj-border text-gray-500 hover:border-dj-neon hover:text-dj-neon hover:bg-dj-neon/5'}`}
          >
            {isAnalyzing ? "PROC" : "TAG"}
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
         prev.track.Year === next.track.Year &&
         prev.index === next.index;
});

const TrackTable: React.FC<TrackTableProps> = ({ tracks, onAnalyzeTrack, analyzingIds, scrollElement }) => {
  const [sortField, setSortField] = useState<SortField>('index');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedTracks = React.useMemo(() => {
    if (sortField === 'index') {
        return sortOrder === 'asc' ? tracks : [...tracks].reverse();
    }

    return [...tracks].sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      // Handle numeric fields
      if (sortField === 'AverageBpm' || sortField === 'Year' || sortField === 'Energy') {
        valA = parseFloat(valA || '0');
        valB = parseFloat(valB || '0');
      } 
      // Handle string fields (case-insensitive)
      else if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tracks, sortField, sortOrder]);

  const rowVirtualizer = useVirtualizer({
    count: sortedTracks.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 56,
    overscan: 20, 
  });

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
  };

  const HeaderCell = ({ field, label, align = 'left' }: { field: SortField, label: string, align?: string }) => (
    <div 
        className={`p-4 cursor-pointer hover:text-white transition-colors select-none text-${align} flex items-center ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}
        onClick={() => handleSort(field)}
    >
        {label} {renderSortIcon(field)}
    </div>
  );

  return (
    <div className="w-full bg-dj-panel rounded-sm border border-dj-border shadow-2xl overflow-hidden mb-12 min-h-[500px]">
      <div className="grid bg-dj-dark text-[10px] uppercase text-dj-dim font-mono tracking-widest border-b border-dj-border shadow-md z-40 sticky top-0" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
        <HeaderCell field="index" label="#" align="right" />
        <HeaderCell field="TrackID" label="ID" />
        <HeaderCell field="Name" label="Title" />
        <HeaderCell field="Artist" label="Artist" />
        <HeaderCell field="Genre" label="Genre" />
        <HeaderCell field="Year" label="Year" align="center" />
        <HeaderCell field="AverageBpm" label="BPM" align="right" />
        <HeaderCell field="Tonality" label="Key" align="center" />
        <HeaderCell field="Energy" label="NRG" align="center" />
        <div className="p-4">AI Analysis</div>
      </div>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const track = sortedTracks[virtualRow.index];
          // We need to pass the ORIGINAL index for display if sorting by something else? 
          // Or just the current row number? Usually row number is expected.
          // Let's pass (virtualRow.index + 1) effectively.
          return (
            <TrackRow
                key={track.TrackID} 
                track={track}
                index={virtualRow.index}
                isAnalyzing={analyzingIds.has(track.TrackID)}
                onAnalyze={onAnalyzeTrack}
                style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default TrackTable;
