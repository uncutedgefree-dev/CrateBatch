import React, { useState, useMemo, useRef } from 'react';
import { Search, Filter, X, Sparkles, ListPlus, CheckCircle } from 'lucide-react';
import FileUploader from './components/FileUploader';
import TrackTable from './components/TrackTable';
import LibraryDashboard from './components/LibraryDashboard';
import DuplicateReviewModal from './components/DuplicateReviewModal';
import ProcessingStatsDisplay from './components/ProcessingStats';
import EnrichmentWarningModal from './components/EnrichmentWarningModal';
import PlaylistNameModal from './components/PlaylistNameModal';
import { parseRekordboxXML, exportRekordboxXML, updateTrackNode, generateSmartPlaylists } from './services/parser';
import { generateTags, generateTagsBatch, interpretSearchQuery } from './services/ai';
import { chunkArray, calculateLibraryStats, findDuplicates, runConcurrent } from './services/utils';
import { RekordboxTrack, ParseStatus, ProcessingStats, SmartFilterCriteria, CustomPlaylist } from './types';

const App: React.FC = () => {
  const [tracks, setTracks] = useState<RekordboxTrack[]>([]);
  const [status, setStatus] = useState<ParseStatus>(ParseStatus.IDLE);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Processing State
  const [isEnriching, setIsEnriching] = useState(false);
  const [isStatsVisible, setIsStatsVisible] = useState(false);
  const [terminalLog, setTerminalLog] = useState<string>("");

  // Search & Filter State
  const [searchInput, setSearchInput] = useState(""); 
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [isSearchingAI, setIsSearchingAI] = useState(false);
  
  // Saved Playlists
  const [savedPlaylists, setSavedPlaylists] = useState<CustomPlaylist[]>([]);
  
  // UI State for Modals & Toasts
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [showEnrichmentWarning, setShowEnrichmentWarning] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // Master State
  const fullXmlDataRef = useRef<any>(null);

  // Progress & Stats tracking
  const [processingStats, setProcessingStats] = useState<ProcessingStats>({
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    songsProcessed: 0,
    totalSongs: 0,
    startTime: 0,
    currentSpeed: 0,
    etaSeconds: 0,
    currentBatchLatency: 0
  });

  // Filtering options
  const [activeFilterName, setActiveFilterName] = useState<string | null>(null);
  const [filteredIds, setFilteredIds] = useState<Set<string> | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  
  // Dashboard Specific Filtering
  const [dashboardFilter, setDashboardFilter] = useState<{ type: string, value: string } | null>(null);
  
  // AI Smart Filter Criteria
  const [smartFilter, setSmartFilter] = useState<SmartFilterCriteria | null>(null);

  const stats = useMemo(() => calculateLibraryStats(tracks), [tracks]);

  // Smart Filter Logic
  const visibleTracks = useMemo(() => {
    let result = tracks;

    if (filteredIds) result = result.filter(t => filteredIds.has(t.TrackID));

    if (dashboardFilter) {
      result = result.filter(t => {
        const { type, value } = dashboardFilter;
        if (type === 'genre') {
           return t.Genre?.toLowerCase().includes(value.toLowerCase()) || 
                  t.Analysis?.genre?.toLowerCase().includes(value.toLowerCase());
        }
        if (type === 'vibe') return t.Analysis?.vibe === value;
        if (type === 'year') {
           const y = t.Year || t.Analysis?.year;
           return y && y.startsWith(value);
        }
        if (type === 'key') return t.Tonality === value;
        return true;
      });
    }

    if (smartFilter && smartFilter.isSemantic) {
       result = result.filter(t => {
          let match = true;
          if (smartFilter.genres.length > 0) {
             const trackGenre = (t.Genre || t.Analysis?.genre || "").toLowerCase();
             const hasGenre = smartFilter.genres.some(g => trackGenre.includes(g.toLowerCase()));
             if (!hasGenre) match = false;
          }
          if (match && smartFilter.vibes.length > 0) {
             const trackVibe = (t.Analysis?.vibe || "").toLowerCase();
             const hasVibe = smartFilter.vibes.some(v => trackVibe === v.toLowerCase());
             if (!hasVibe) match = false;
          }
          if (match && smartFilter.situations.length > 0) {
             const trackSituation = (t.Analysis?.situation || "").toLowerCase();
             const hasSituation = smartFilter.situations.some(s => trackSituation === s.toLowerCase());
             if (!hasSituation) match = false;
          }
          if (match && (smartFilter.minBpm || smartFilter.maxBpm)) {
             const bpm = parseFloat(t.AverageBpm);
             if (smartFilter.minBpm && bpm < smartFilter.minBpm) match = false;
             if (smartFilter.maxBpm && bpm > smartFilter.maxBpm) match = false;
          }
          if (match && (smartFilter.minYear || smartFilter.maxYear)) {
             const y = parseInt(t.Year || t.Analysis?.year || "0");
             if (y > 0) {
                 if (smartFilter.minYear && y < smartFilter.minYear) match = false;
                 if (smartFilter.maxYear && y > smartFilter.maxYear) match = false;
             }
          }
          if (match && (smartFilter.minEnergy || smartFilter.maxEnergy)) {
             const e = parseInt(t.Energy || "0");
             if (e > 0) {
                 if (smartFilter.minEnergy && e < smartFilter.minEnergy) match = false;
                 if (smartFilter.maxEnergy && e > smartFilter.maxEnergy) match = false;
             }
          }
          return match;
       });
    }

    const textQuery = smartFilter ? smartFilter.keywords.join(" ") : activeSearchQuery;
    if (textQuery.trim()) {
      const tokens = textQuery.toLowerCase().trim().split(/\s+/);
      result = result.filter(track => {
        const searchTerms = [
          track.Name, track.Artist, track.Genre, track.Year, track.Comments,
          track.Analysis?.vibe, track.Analysis?.genre, track.Analysis?.situation, track.Analysis?.year, track.Tonality
        ].filter(Boolean).join(" ").toLowerCase();
        return tokens.every(token => searchTerms.includes(token));
      });
    }
    return result;
  }, [tracks, filteredIds, activeSearchQuery, dashboardFilter, smartFilter]);

  const handleDashboardFilter = (type: 'genre' | 'vibe' | 'year' | 'key', value: string) => {
    setDashboardFilter({ type, value });
    setActiveFilterName(`${type}: ${value}`);
    setFilteredIds(null); 
    setSmartFilter(null);
  };

  const handleSmartSearch = async (queryOverride?: string) => {
    const query = queryOverride ?? searchInput;
    if (!query.trim()) {
        setSmartFilter(null);
        setActiveSearchQuery("");
        return;
    }
    setActiveSearchQuery(query);
    setIsSearchingAI(true);
    try {
        const criteria = await interpretSearchQuery(query);
        if (criteria.isSemantic) setSmartFilter(criteria);
    } catch (err) {} finally { setIsSearchingAI(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSmartSearch(searchInput);
  };

  const formatLogLine = (
    label: string, size: number, durationMs: number, usage: any, runningCost: number, runningTokens: number, speed: number, error?: string
  ) => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const speedStr = `${Math.round(speed)} spm`;
    const costStr = error ? `ERROR: ${error.slice(0, 20)}...` : `+$${usage.cost.toFixed(4)} (Tot: $${runningCost.toFixed(4)})`;
    const tokStr = error ? "" : `In: ${(usage.inputTokens / 1000).toFixed(1)}k / Out: ${(usage.outputTokens / 1000).toFixed(1)}k`;
    return `[${time}] ${label.padEnd(12)} | ${size.toString().padEnd(3)} items | ${(durationMs/1000).toFixed(2)}s | ${speedStr.padEnd(8)} | ${costStr.padEnd(26)} | ${tokStr}`;
  };

  const handleFileSelect = async (file: File) => {
    setStatus(ParseStatus.PARSING);
    if (window.electron && (file as any).path) {
       try {
         const { success, data } = await window.electron.readFile((file as any).path);
         if (success && data) {
           const result = await parseRekordboxXML(data);
           setTracks(result.tracks);
           fullXmlDataRef.current = result.fullData; 
           setStatus(ParseStatus.SUCCESS);
         }
       } catch (err) { setStatus(ParseStatus.ERROR); }
       return;
    }
  };

  const reset = () => {
    setTracks([]);
    setStatus(ParseStatus.IDLE);
    setIsStatsVisible(false);
    setTerminalLog("");
  };

  const processBatch = async (
    targetTracks: RekordboxTrack[], 
    mode: 'full' | 'missing_genre' | 'missing_year'
  ) => {
    if (targetTracks.length === 0) return;
    setIsEnriching(true);
    setIsStatsVisible(true);
    setTerminalLog(`[${new Date().toLocaleTimeString()}] Initializing ${mode} job (${targetTracks.length} items)...`);
    
    const startTime = performance.now();
    let jobCumulativeCost = 0;
    let jobCumulativeTokens = 0;
    let completedBatchesCount = 0;
    
    const chunks = chunkArray<RekordboxTrack>(targetTracks, 200);
    const retryQueue: RekordboxTrack[] = [];

    const tasks = chunks.map((chunk) => async () => {
      const chunkStartTime = performance.now();
      try {
        const { results: resultsMap, usage, error } = await generateTagsBatch(chunk, mode);
        
        if (error || Object.keys(resultsMap).length === 0) {
            retryQueue.push(...chunk);
        }

        completedBatchesCount++;
        jobCumulativeCost += usage.cost;
        jobCumulativeTokens += (usage.inputTokens + usage.outputTokens);

        const now = performance.now();
        const durationMs = now - startTime;
        const songsPerMin = (completedBatchesCount * 200 / (durationMs / 60000)) || 0;

        const logLine = formatLogLine(
            `Batch ${completedBatchesCount}/${chunks.length}`, chunk.length, now - chunkStartTime, usage, jobCumulativeCost, jobCumulativeTokens, songsPerMin, error
        );
        setTerminalLog(prev => prev + '\n' + logLine);

        setTracks(prev => prev.map(t => resultsMap[t.TrackID] ? { ...t, Analysis: resultsMap[t.TrackID] } : t));
      } catch (e) {
        retryQueue.push(...chunk);
      }
    });

    await runConcurrent(tasks, 2);
    setIsEnriching(false);
    setTerminalLog(prev => prev + `\n\n[${new Date().toLocaleTimeString()}] ✅ Job Complete! Total Cost: $${jobCumulativeCost.toFixed(4)}`);
  };

  const handleInitiateEnrichment = () => {
    const tracksToProcess = visibleTracks.filter(t => !t.Analysis);
    if (tracksToProcess.length === 0) return;
    processBatch(tracksToProcess, 'full');
  };

  return (
    <div className="flex flex-col min-h-screen bg-dj-dark text-white font-sans selection:bg-dj-neon selection:text-black">
      <header className="flex-none h-16 border-b border-dj-border bg-dj-dark/50 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-50">
        <div className="flex items-center gap-3 w-64 flex-shrink-0">
          <div className="w-3 h-3 rounded-full bg-dj-neon shadow-[0_0_10px_rgba(0,243,255,0.5)]"></div>
          <h1 className="text-xl font-bold tracking-tight">REKORDBOX <span className="text-dj-neon font-light">ANALYZER</span></h1>
        </div>
        
        {status === ParseStatus.SUCCESS && (
          <div className="flex items-center gap-4">
            <input
                type="text"
                placeholder="Search tracks..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="bg-dj-panel border border-dj-border rounded-full py-1 px-6 text-sm focus:outline-none focus:border-dj-neon w-80"
            />
            <button onClick={handleInitiateEnrichment} className="bg-dj-neon/10 text-dj-neon border border-dj-neon px-4 py-1.5 rounded text-sm font-bold uppercase hover:bg-dj-neon hover:text-black transition-all">AI Enrich</button>
            <button onClick={reset} className="text-xs px-3 py-1.5 rounded border border-dj-border hover:text-red-500 hover:border-red-500">CLEAR</button>
          </div>
        )}
      </header>

      <main className="flex-1 p-6">
        {status === ParseStatus.IDLE && (
          <div className="flex flex-col items-center justify-center mt-20">
             <h2 className="text-2xl font-bold mb-4">Import Collection</h2>
             <FileUploader onFileSelect={handleFileSelect} isLoading={false} />
          </div>
        )}

        {status === ParseStatus.SUCCESS && (
          <div className="flex flex-col gap-6">
             {isStatsVisible && <ProcessingStatsDisplay stats={processingStats} log={terminalLog} onClose={() => setIsStatsVisible(false)} isProcessing={isEnriching} />}
             <LibraryDashboard stats={stats} onFilter={handleDashboardFilter} isProcessing={isEnriching} />
             <TrackTable tracks={visibleTracks} onAnalyzeTrack={() => {}} analyzingIds={analyzingIds} />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;