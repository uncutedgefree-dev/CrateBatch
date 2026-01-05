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
import { generateTagsBatch } from './services/ai';
import { chunkArray, calculateLibraryStats, findDuplicates, runConcurrent } from './services/utils';
import { RekordboxTrack, ParseStatus, ProcessingStats, CustomPlaylist, AIAnalysis } from './types';

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
  const mainScrollRef = useRef<HTMLElement>(null);
  
  const [processingStats, setProcessingStats] = useState<ProcessingStats>({
    totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, songsProcessed: 0, 
    totalSongs: 0, startTime: 0, currentSpeed: 0, etaSeconds: 0, currentBatchLatency: 0,
    totalDuration: 0
  });

  const [activeFilterName, setActiveFilterName] = useState<string | null>(null);
  const [dashboardFilter, setDashboardFilter] = useState<{ type: string, value: string } | null>(null);
  const [smartFilter] = useState<any>(null);
  const [activeProcessingIds, setActiveProcessingIds] = useState<Set<string>>(new Set());

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
    const textQuery = smartFilter ? smartFilter.keywords.join(" ") : activeSearchQuery;
    if (textQuery.trim()) {
      const tokens = textQuery.toLowerCase().trim().split(/\s+/);
      result = result.filter(track => tokens.every((token: string) => [track.Name, track.Artist, track.Genre, track.Analysis?.vibe].filter(Boolean).join(" ").toLowerCase().includes(token)));
    }
    return result;
  }, [tracks, activeSearchQuery, dashboardFilter, smartFilter]);

  const formatLogLine = (label: string, size: number, durationMs: number, usage: any, runningCost: number, speed: number, error?: string) => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const costStr = error ? `ERR: ${error.slice(0, 15)}` : `+$${usage.cost.toFixed(4)} (Tot: $${runningCost.toFixed(4)})`;
    return `[${time}] ${label.padEnd(12)} | ${size.toString().padEnd(3)} items | ${(durationMs/1000).toFixed(1)}s | ${Math.round(speed)} spm | ${costStr}`;
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
    if (targetTracks.length === 0) return;
    setIsEnriching(true);
    setIsStatsVisible(true);
    setTerminalLog(`[${new Date().toLocaleTimeString()}] Initializing ${mode} job (${targetTracks.length} items)...`);
    
    const startTime = performance.now();
    let jobCost = 0;
    let processedCount = 0;
    let totalIn = 0;
    let totalOut = 0;
    
    setProcessingStats({ 
      totalSongs: targetTracks.length, 
      songsProcessed: 0, 
      startTime,
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDuration: 0,
      currentSpeed: 0,
      etaSeconds: 0,
      currentBatchLatency: 0
    });

    const failedTracks: RekordboxTrack[] = [];

    // Increase batch size to 100 to improve throughput
    const chunks = chunkArray<RekordboxTrack>(targetTracks, 100);
    const totalBatches = chunks.length;

    const tasks = chunks.map((chunk, idx) => async () => {
      const chunkIds = chunk.map(t => t.TrackID);
      setActiveProcessingIds(prev => {
        const next = new Set(prev);
        chunkIds.forEach(id => next.add(id));
        return next;
      });

      const chunkStart = performance.now();
      const { results, usage, error } = await generateTagsBatch(chunk, mode);
      
      const chunkDuration = performance.now() - chunkStart;
      
      if (error || Object.keys(results).length === 0) {
          failedTracks.push(...chunk);
      } else {
        jobCost += usage.cost;
        processedCount += chunk.length;
        totalIn += usage.inputTokens;
        totalOut += usage.outputTokens;
      }
      
      const durationSoFarMin = (performance.now() - startTime) / 60000;
      const currentSpm = processedCount / (durationSoFarMin || 0.001);
      
      const remainingSongs = targetTracks.length - processedCount;
      const etaSec = (remainingSongs / (currentSpm || 1)) * 60;

      setProcessingStats(prev => ({
        ...prev,
        songsProcessed: processedCount,
        totalCost: jobCost,
        totalInputTokens: totalIn,
        totalOutputTokens: totalOut,
        currentSpeed: currentSpm,
        currentBatchLatency: chunkDuration,
        totalDuration: performance.now() - startTime,
        etaSeconds: etaSec
      }));

      const log = formatLogLine(`Batch ${idx+1}/${totalBatches}`, chunk.length, chunkDuration, usage, jobCost, currentSpm, error);
      setTerminalLog(prev => prev + '\n' + log);

      setTracks(prev => prev.map(t => {
        if (!results[t.TrackID]) return t;
        const res = results[t.TrackID];
        
        if (mode === 'missing_genre') {
          return { 
            ...t, 
            Genre: res.genre !== "Unknown" ? res.genre : t.Genre, 
            Analysis: t.Analysis ? { ...t.Analysis, genre: res.genre } : { genre: res.genre, vibe: 'Unknown', situation: 'Unknown', year: '0' } as AIAnalysis 
          };
        }
        if (mode === 'missing_year') {
          return { 
            ...t, 
            Year: (res.year && res.year !== "0") ? res.year : t.Year, 
            Analysis: t.Analysis ? { ...t.Analysis, year: res.year } : { genre: 'Unknown', vibe: 'Unknown', situation: 'Unknown', year: res.year } as AIAnalysis 
          };
        }
        
        return { ...t, Analysis: res };
      }));

      chunk.forEach(t => {
        if (results[t.TrackID]) {
           updateTrackNode(t, results[t.TrackID], mode);
        }
      });

      setActiveProcessingIds(prev => {
        const next = new Set(prev);
        chunkIds.forEach(id => next.delete(id));
        return next;
      });
    });

    // Run 8 concurrent tasks with a small stagger delay (250ms)
    await runConcurrent(tasks, 8, 250);

    // Process failed tracks if any
    if (failedTracks.length > 0) {
        setTerminalLog(prev => prev + `\n[${new Date().toLocaleTimeString()}] Retrying ${failedTracks.length} failed tracks...`);
        const retryChunks = chunkArray<RekordboxTrack>(failedTracks, 50); // Smaller chunks for retry
        const retryTasks = retryChunks.map((chunk, idx) => async () => {
             const chunkIds = chunk.map(t => t.TrackID);
              setActiveProcessingIds(prev => {
                const next = new Set(prev);
                chunkIds.forEach(id => next.add(id));
                return next;
              });

              const chunkStart = performance.now();
              const { results, usage, error } = await generateTagsBatch(chunk, mode);
               const chunkDuration = performance.now() - chunkStart;
               
               if (!error && Object.keys(results).length > 0) {
                    jobCost += usage.cost;
                    processedCount += chunk.length;
                    totalIn += usage.inputTokens;
                    totalOut += usage.outputTokens;
               }

              const durationSoFarMin = (performance.now() - startTime) / 60000;
              const currentSpm = processedCount / (durationSoFarMin || 0.001);

              setProcessingStats(prev => ({
                ...prev,
                songsProcessed: processedCount,
                totalCost: jobCost,
                totalInputTokens: totalIn,
                totalOutputTokens: totalOut,
                currentSpeed: currentSpm,
                currentBatchLatency: chunkDuration,
                totalDuration: performance.now() - startTime,
                etaSeconds: 0
              }));

              const log = formatLogLine(`Retry ${idx+1}/${retryChunks.length}`, chunk.length, chunkDuration, usage, jobCost, currentSpm, error);
              setTerminalLog(prev => prev + '\n' + log);

              setTracks(prev => prev.map(t => {
                if (!results[t.TrackID]) return t;
                const res = results[t.TrackID];
                
                if (mode === 'missing_genre') {
                  return { 
                    ...t, 
                    Genre: res.genre !== "Unknown" ? res.genre : t.Genre, 
                    Analysis: t.Analysis ? { ...t.Analysis, genre: res.genre } : { genre: res.genre, vibe: 'Unknown', situation: 'Unknown', year: '0' } as AIAnalysis 
                  };
                }
                if (mode === 'missing_year') {
                  return { 
                    ...t, 
                    Year: (res.year && res.year !== "0") ? res.year : t.Year, 
                    Analysis: t.Analysis ? { ...t.Analysis, year: res.year } : { genre: 'Unknown', vibe: 'Unknown', situation: 'Unknown', year: res.year } as AIAnalysis 
                  };
                }
                
                return { ...t, Analysis: res };
              }));

              chunk.forEach(t => {
                if (results[t.TrackID]) {
                   updateTrackNode(t, results[t.TrackID], mode);
                }
              });

              setActiveProcessingIds(prev => {
                const next = new Set(prev);
                chunkIds.forEach(id => next.delete(id));
                return next;
              });
        });
        await runConcurrent(retryTasks, 4, 500); // Slower concurrency for retries
    }
    
    setIsEnriching(false);
    const finalDuration = performance.now() - startTime;
    setProcessingStats(prev => ({ ...prev, totalDuration: finalDuration, etaSeconds: 0 }));
    setTerminalLog(prev => prev + `\n\n[${new Date().toLocaleTimeString()}] ✅ Job Complete! Total Cost: $${jobCost.toFixed(4)}`);
  };

  const handleExport = () => {
    const { ids } = findDuplicates(tracks);
    generateSmartPlaylists(fullXmlDataRef.current, tracks, ids, savedPlaylists);
    const xml = exportRekordboxXML(fullXmlDataRef.current);
    const url = URL.createObjectURL(new Blob([xml], { type: 'text/xml' }));
    const a = document.createElement('a'); a.href = url; a.download = 'enriched.xml'; a.click();
  };

  const handleAnalyzeSingle = async (trackId: string) => {
    const track = tracks.find(t => t.TrackID === trackId);
    if (!track) return;
    
    setActiveProcessingIds(prev => new Set(prev).add(trackId));
    const { results } = await generateTagsBatch([track], 'full');
    
    if (results[trackId]) {
      setTracks(prev => prev.map(t => t.TrackID === trackId ? { ...t, Analysis: results[trackId] } : t));
      updateTrackNode(track, results[trackId], 'full');
    }
    
    setActiveProcessingIds(prev => {
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-dj-dark text-white font-sans selection:bg-dj-neon selection:text-black overflow-hidden">
      <header className="flex-none h-16 border-b border-dj-border bg-dj-dark/50 flex items-center justify-between px-6 sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center gap-3 w-64">
          <div className="w-3 h-3 rounded-full bg-dj-neon shadow-[0_0_10px_rgba(0,243,255,0.5)]"></div>
          <h1 className="text-xl font-bold">CRATE<span className="text-dj-neon font-light">BATCH</span></h1>
        </div>
        {status === ParseStatus.SUCCESS && (
          <div className="flex items-center gap-4">
            <input type="text" placeholder="Search..." value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && setActiveSearchQuery(searchInput)} className="bg-dj-panel border border-dj-border rounded-full py-1 px-6 text-sm focus:outline-none focus:border-dj-neon w-80" />
            <button onClick={() => setShowEnrichmentWarning(true)} className="bg-dj-neon/10 text-dj-neon border border-dj-neon px-4 py-1.5 rounded text-sm font-bold uppercase hover:bg-dj-neon hover:text-black transition-all">AI Enrich</button>
            <button onClick={handleExport} className="bg-dj-accent/10 text-dj-accent border border-dj-accent px-4 py-1.5 rounded text-sm font-bold uppercase hover:bg-dj-accent hover:text-white transition-all">Export</button>
            <button onClick={() => { setTracks([]); setStatus(ParseStatus.IDLE); }} className="text-xs px-3 py-1.5 rounded border border-dj-border hover:text-red-500 hover:border-red-500">CLEAR</button>
          </div>
        )}
      </header>
      <main className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar" ref={mainScrollRef as React.RefObject<HTMLDivElement>}>
        <div className="p-6 flex flex-col min-h-full">
          {status === ParseStatus.IDLE && <div className="flex-1 flex flex-col items-center justify-center mt-20"><h2 className="text-2xl font-bold mb-4">Import Collection</h2><FileUploader onFileSelect={handleFileSelect} isLoading={false} /></div>}
          {status === ParseStatus.SUCCESS && (
            <div className="flex flex-col gap-6 animate-fade-in">
               {isStatsVisible && (
                 <div className="sticky top-0 z-[45] mb-2">
                   <ProcessingStatsDisplay 
                     stats={processingStats} 
                     log={terminalLog} 
                     onClose={() => {
                       setIsStatsVisible(false);
                     }} 
                     isProcessing={isEnriching} 
                   />
                 </div>
               )}
               <LibraryDashboard 
                  stats={stats} 
                  savedPlaylists={savedPlaylists}
                  onFilter={(type, value) => { setDashboardFilter({ type, value }); setActiveFilterName(`${type}: ${value}`); }} 
                  isProcessing={isEnriching} 
                  onFixYears={() => {
                    const missing = tracks.filter(t => !t.Year || t.Year === "0" || t.Year === "");
                    processBatch(missing, 'missing_year');
                  }} 
                  onFixGenres={() => {
                    const missing = tracks.filter(t => !t.Genre || t.Genre === "");
                    processBatch(missing, 'missing_genre');
                  }} 
                  onReviewDuplicates={() => setShowDuplicateModal(true)} 
               />
               <div className="flex items-center justify-between"><div className="text-dj-dim text-xs font-mono">Showing {visibleTracks.length} tracks {activeFilterName && `(Filtered: ${activeFilterName})`}</div>{(activeFilterName || activeSearchQuery) && <button onClick={() => setShowPlaylistModal(true)} className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 border border-green-500 rounded-full text-xs font-bold text-green-500 hover:bg-green-500 hover:text-black"><ListPlus className="w-3 h-3" />Save as Playlist</button>}</div>
               <TrackTable tracks={visibleTracks} onAnalyzeTrack={handleAnalyzeSingle} analyzingIds={activeProcessingIds} scrollElement={mainScrollRef.current} />
            </div>
          )}
        </div>
      </main>
      {showDuplicateModal && <DuplicateReviewModal groups={stats.missingData.duplicateGroups} onClose={() => setShowDuplicateModal(false)} />}
      {showEnrichmentWarning && <EnrichmentWarningModal filteredCount={visibleTracks.length} totalCount={tracks.length} onProcessFiltered={() => { setShowEnrichmentWarning(false); processBatch(visibleTracks.filter(t => !t.Analysis), 'full'); }} onProcessAll={() => { setShowEnrichmentWarning(false); processBatch(tracks.filter(t => !t.Analysis), 'full'); }} onCancel={() => setShowEnrichmentWarning(false)} />}
      {showPlaylistModal && <PlaylistNameModal defaultValue={activeFilterName || activeSearchQuery || "New Playlist"} count={visibleTracks.length} onSave={name => { setSavedPlaylists(prev => [...prev, { name, trackIds: visibleTracks.map(t => t.TrackID) }]); setShowPlaylistModal(false); setToastMessage(`Playlist "${name}" saved!`); setTimeout(() => setToastMessage(null), 3000); }} onClose={() => setShowPlaylistModal(false)} />}
      {toastMessage && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-dj-panel border border-dj-neon/50 text-white px-6 py-3 rounded-full shadow-2xl animate-fade-in"><CheckCircle className="w-5 h-5 text-dj-neon" /><span className="font-bold text-sm">{toastMessage}</span></div>}
    </div>
  );
};

export default App;
