import React, { useState, useMemo, useRef } from 'react';
import { ListPlus, CheckCircle } from 'lucide-react';
import FileUploader from './components/FileUploader';
import TrackTable from './components/TrackTable';
import LibraryDashboard from './components/LibraryDashboard';
import DuplicateReviewModal from './components/DuplicateReviewModal';
import ProcessingStatsDisplay from './components/ProcessingStats';
import EnrichmentWarningModal from './components/EnrichmentWarningModal';
import PlaylistNameModal from './components/PlaylistNameModal';
import { parseRekordboxXML, exportRekordboxXML, updateTrackNode, generateSmartPlaylists } from './services/parser';
import { generateTagsBatch, interpretSearchQuery } from './services/ai';
import { chunkArray, calculateLibraryStats, findDuplicates, runConcurrent } from './services/utils';
import { RekordboxTrack, ParseStatus, ProcessingStats, CustomPlaylist } from './types';

const App: React.FC = () => {
  const [tracks, setTracks] = useState<RekordboxTrack[]>([]);
  const [status, setStatus] = useState<ParseStatus>(ParseStatus.IDLE);
  const [isEnriching, setIsEnriching] = useState(false);
  const [isStatsVisible, setIsStatsVisible] = useState(false);
  const [terminalLog, setTerminalLog] = useState<string>("");
  const [searchInput, setSearchInput] = useState(""); 
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [savedPlaylists, setSavedPlaylists] = useState<CustomPlaylist[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [showEnrichmentWarning, setShowEnrichmentWarning] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const fullXmlDataRef = useRef<any>(null);
  const [processingStats, setProcessingStats] = useState<ProcessingStats>({
    totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, songsProcessed: 0, totalSongs: 0, startTime: 0, currentSpeed: 0, etaSeconds: 0, currentBatchLatency: 0
  });
  const [activeFilterName, setActiveFilterName] = useState<string | null>(null);
  const [dashboardFilter, setDashboardFilter] = useState<{ type: string, value: string } | null>(null);
  const [smartFilter, setSmartFilter] = useState<any>(null);

  const stats = useMemo(() => calculateLibraryStats(tracks), [tracks]);

  const visibleTracks = useMemo(() => {
    let result = tracks;
    if (dashboardFilter) {
      result = result.filter(t => {
        const { type, value } = dashboardFilter;
        if (type === 'genre') return (t.Genre || "").toLowerCase().includes(value.toLowerCase()) || (t.Analysis?.genre || "").toLowerCase().includes(value.toLowerCase());
        if (type === 'vibe') return t.Analysis?.vibe === value;
        if (type === 'year') return (t.Year || t.Analysis?.year || "").startsWith(value);
        if (type === 'key') return t.Tonality === value;
        return true;
      });
    }
    if (smartFilter && smartFilter.isSemantic) {
       result = result.filter(t => {
          if (smartFilter.genres.length > 0 && !smartFilter.genres.some((g: string) => (t.Genre || "").toLowerCase().includes(g.toLowerCase()))) return false;
          if (smartFilter.vibes.length > 0 && !smartFilter.vibes.some((v: string) => t.Analysis?.vibe === v)) return false;
          return true;
       });
    }
    const textQuery = smartFilter ? smartFilter.keywords.join(" ") : activeSearchQuery;
    if (textQuery.trim()) {
      const tokens = textQuery.toLowerCase().trim().split(/\s+/);
      result = result.filter(track => tokens.every(token => [track.Name, track.Artist, track.Genre, track.Analysis?.vibe].filter(Boolean).join(" ").toLowerCase().includes(token)));
    }
    return result;
  }, [tracks, activeSearchQuery, dashboardFilter, smartFilter]);

  const handleSmartSearch = async (queryOverride?: string) => {
    const query = queryOverride ?? searchInput;
    if (!query.trim()) return;
    setActiveSearchQuery(query);
    try {
        const criteria = await interpretSearchQuery(query);
        if (criteria.isSemantic) setSmartFilter(criteria);
    } catch (err) {}
  };

  const formatLogLine = (label: string, size: number, durationMs: number, usage: any, runningCost: number, speed: number, error?: string) => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const costStr = error ? `ERROR: ${error.slice(0, 15)}...` : `+$${usage.cost.toFixed(4)} (Tot: $${runningCost.toFixed(4)})`;
    return `[${time}] ${label.padEnd(12)} | ${size.toString().padEnd(3)} items | ${(durationMs/1000).toFixed(2)}s | ${Math.round(speed)} spm | ${costStr}`;
  };

  const handleFileSelect = async (file: File) => {
    setStatus(ParseStatus.PARSING);
    if (window.electron && (file as any).path) {
       const { success, data } = await window.electron.readFile((file as any).path);
       if (success && data) {
         const result = await parseRekordboxXML(data);
         setTracks(result.tracks);
         fullXmlDataRef.current = result.fullData; 
         setStatus(ParseStatus.SUCCESS);
       }
    }
  };

  const processBatch = async (targetTracks: RekordboxTrack[], mode: 'full' | 'missing_genre' | 'missing_year') => {
    setIsEnriching(true);
    setIsStatsVisible(true);
    setTerminalLog(`[${new Date().toLocaleTimeString()}] Initializing ${mode} job (${targetTracks.length} items)...`);
    const startTime = performance.now();
    let jobCost = 0;
    const chunks = chunkArray<RekordboxTrack>(targetTracks, 200);
    const tasks = chunks.map((chunk, idx) => async () => {
      const chunkStart = performance.now();
      const { results, usage, error } = await generateTagsBatch(chunk, mode);
      jobCost += usage.cost;
      const log = formatLogLine(`Batch ${idx+1}/${chunks.length}`, chunk.length, performance.now() - chunkStart, usage, jobCost, (idx + 1) * 200 / ((performance.now() - startTime) / 60000), error);
      setTerminalLog(prev => prev + '\n' + log);
      setTracks(prev => prev.map(t => results[t.TrackID] ? { ...t, Analysis: results[t.TrackID] } : t));
      chunk.forEach(t => results[t.TrackID] && updateTrackNode(t, results[t.TrackID], mode));
    });
    await runConcurrent(tasks, 2);
    setIsEnriching(false);
    setProcessingStats(prev => ({ ...prev, totalCost: jobCost }));
    setTerminalLog(prev => prev + `\n\n[${new Date().toLocaleTimeString()}] ✅ Job Complete!`);
  };

  const handleExport = () => {
    const { ids } = findDuplicates(tracks);
    generateSmartPlaylists(fullXmlDataRef.current, tracks, ids, savedPlaylists);
    const xml = exportRekordboxXML(fullXmlDataRef.current);
    const url = URL.createObjectURL(new Blob([xml], { type: 'text/xml' }));
    const a = document.createElement('a'); a.href = url; a.download = 'enriched.xml'; a.click();
  };

  return (
    <div className="flex flex-col min-h-screen bg-dj-dark text-white font-sans selection:bg-dj-neon selection:text-black">
      <header className="flex-none h-16 border-b border-dj-border bg-dj-dark/50 flex items-center justify-between px-6 sticky top-0 z-50">
        <div className="flex items-center gap-3 w-64">
          <div className="w-3 h-3 rounded-full bg-dj-neon shadow-[0_0_10px_rgba(0,243,255,0.5)]"></div>
          <h1 className="text-xl font-bold">REKORDBOX <span className="text-dj-neon font-light">ANALYZER</span></h1>
        </div>
        {status === ParseStatus.SUCCESS && (
          <div className="flex items-center gap-4">
            <input type="text" placeholder="Search..." value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSmartSearch()} className="bg-dj-panel border border-dj-border rounded-full py-1 px-6 text-sm focus:outline-none focus:border-dj-neon w-80" />
            <button onClick={() => setShowEnrichmentWarning(true)} className="bg-dj-neon/10 text-dj-neon border border-dj-neon px-4 py-1.5 rounded text-sm font-bold uppercase hover:bg-dj-neon hover:text-black transition-all">AI Enrich</button>
            <button onClick={handleExport} className="bg-dj-accent/10 text-dj-accent border border-dj-accent px-4 py-1.5 rounded text-sm font-bold uppercase hover:bg-dj-accent hover:text-white transition-all">Export</button>
            <button onClick={() => { setTracks([]); setStatus(ParseStatus.IDLE); }} className="text-xs px-3 py-1.5 rounded border border-dj-border hover:text-red-500 hover:border-red-500">CLEAR</button>
          </div>
        )}
      </header>
      <main className="flex-1 p-6">
        {status === ParseStatus.IDLE && <div className="flex flex-col items-center justify-center mt-20"><h2 className="text-2xl font-bold mb-4">Import Collection</h2><FileUploader onFileSelect={handleFileSelect} isLoading={false} /></div>}
        {status === ParseStatus.SUCCESS && (
          <div className="flex flex-col gap-6">
             {isStatsVisible && <ProcessingStatsDisplay stats={processingStats} log={terminalLog} onClose={() => setIsStatsVisible(false)} isProcessing={isEnriching} />}
             <LibraryDashboard 
                stats={stats} 
                savedPlaylists={savedPlaylists}
                onFilter={(type, value) => { setDashboardFilter({ type, value }); setActiveFilterName(`${type}: ${value}`); }} 
                isProcessing={isEnriching} 
                onFixYears={() => processBatch(tracks.filter(t => !t.Year), 'missing_year')} 
                onFixGenres={() => processBatch(tracks.filter(t => !t.Genre), 'missing_genre')} 
                onReviewDuplicates={() => setShowDuplicateModal(true)} 
             />
             <div className="flex items-center justify-between"><div className="text-dj-dim text-xs">Showing {visibleTracks.length} tracks {activeFilterName && `(Filtered: ${activeFilterName})`}</div>{(activeFilterName || activeSearchQuery) && <button onClick={() => setShowPlaylistModal(true)} className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 border border-green-500 rounded-full text-xs font-bold text-green-500 hover:bg-green-500 hover:text-black"><ListPlus className="w-3 h-3" />Save as Playlist</button>}</div>
             <TrackTable tracks={visibleTracks} onAnalyzeTrack={() => {}} analyzingIds={new Set()} />
          </div>
        )}
      </main>
      {showDuplicateModal && <DuplicateReviewModal groups={stats.missingData.duplicateGroups} onClose={() => setShowDuplicateModal(false)} />}
      {showEnrichmentWarning && <EnrichmentWarningModal filteredCount={visibleTracks.length} totalCount={tracks.length} onProcessFiltered={() => { setShowEnrichmentWarning(false); processBatch(visibleTracks.filter(t => !t.Analysis), 'full'); }} onProcessAll={() => { setShowEnrichmentWarning(false); processBatch(tracks.filter(t => !t.Analysis), 'full'); }} onCancel={() => setShowEnrichmentWarning(false)} />}
      {showPlaylistModal && <PlaylistNameModal defaultValue={activeFilterName || activeSearchQuery || "New Playlist"} count={visibleTracks.length} onSave={name => { setSavedPlaylists(prev => [...prev, { name, trackIds: visibleTracks.map(t => t.TrackID) }]); setShowPlaylistModal(false); setToastMessage(`Playlist "${name}" saved!`); setTimeout(() => setToastMessage(null), 3000); }} onClose={() => setShowPlaylistModal(false)} />}
      {toastMessage && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-dj-panel border border-dj-neon/50 text-white px-6 py-3 rounded-full shadow-2xl animate-fade-in"><CheckCircle className="w-5 h-5 text-dj-neon" /><span className="font-bold text-sm">{toastMessage}</span></div>}
    </div>
  );
};

export default App;
