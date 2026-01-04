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

    // 1. Explicit ID Filter
    if (filteredIds) {
      result = result.filter(t => filteredIds.has(t.TrackID));
    }

    // 2. Dashboard Interactive Filter
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

    // 3. AI Smart Filter (Structured)
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

    // 4. Fallback/Standard Text Search 
    const textQuery = smartFilter ? smartFilter.keywords.join(" ") : activeSearchQuery;
    
    if (textQuery.trim()) {
      const tokens = textQuery.toLowerCase().trim().split(/\s+/);
      
      result = result.filter(track => {
        const searchTerms = [
          track.Name,
          track.Artist,
          track.Genre,
          track.Year,
          track.Comments,
          track.Analysis?.vibe,
          track.Analysis?.genre,
          track.Analysis?.situation,
          track.Analysis?.year,
          track.Tonality
        ].filter(Boolean).join(" ").toLowerCase();

        return tokens.every(token => {
          if (token.match(/^\d0s$/)) {
             const digit = token[0];
             let yearPrefix = digit === '0' ? "200" : `19${digit}`;
             const trackYear = track.Year || track.Analysis?.year;
             if (trackYear && trackYear.toString().startsWith(yearPrefix)) return true;
          }
          return searchTerms.includes(token);
        });
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
        console.log("AI Search Criteria:", criteria);
        if (criteria.isSemantic) {
            setSmartFilter(criteria);
            const parts = [
                ...criteria.genres,
                ...criteria.vibes,
                ...criteria.situations,
                criteria.minBpm ? `>${criteria.minBpm}BPM` : null,
                criteria.maxBpm ? `<${criteria.maxBpm}BPM` : null
            ].filter(Boolean);
            setActiveFilterName(parts.length > 0 ? "AI: " + parts.join(", ") : "AI Search");
        } else {
            setSmartFilter(null); 
            setActiveFilterName(`Search: "${query}"`);
        }
    } catch (err) {
        console.error("Smart search failed", err);
    } finally {
        setIsSearchingAI(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          handleSmartSearch(searchInput);
      }
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleOpenSavePlaylistModal = () => {
    if (visibleTracks.length === 0) return;
    setShowPlaylistModal(true);
  };

  const handleConfirmSavePlaylist = (name: string) => {
    const newPlaylist: CustomPlaylist = {
      name: name,
      trackIds: visibleTracks.map(t => t.TrackID)
    };
    setSavedPlaylists(prev => [...prev, newPlaylist]);
    setShowPlaylistModal(false);
    showToast(`Playlist "${name}" saved!`);
  };

  // --- Log Helper ---
  const formatLogLine = (
    label: string, size: number, durationMs: number, usage: any, runningCost: number, runningTokens: number, speed: number
  ) => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const speedStr = `${Math.round(speed)} spm`;
    const costStr = `+$${usage.cost.toFixed(4)} (Tot: $${runningCost.toFixed(4)})`;
    const inTok = (usage.inputTokens / 1000).toFixed(1);
    const outTok = (usage.outputTokens / 1000).toFixed(1);
    const cumTok = (runningTokens / 1000).toFixed(1);
    const tokStr = `In: ${inTok}k / Out: ${outTok}k (Cum: ${cumTok}k)`;
    return `[${time}] ${label.padEnd(12)} | ${size.toString().padEnd(3)} items | ${(durationMs/1000).toFixed(2)}s | ${speedStr.padEnd(8)} | ${costStr.padEnd(26)} | ${tokStr}`;
  };

  const handleFileSelect = async (file: File) => {
    setFilteredIds(null);
    setActiveFilterName(null);
    setDashboardFilter(null);
    setSmartFilter(null);
    setSearchInput("");
    setActiveSearchQuery("");
    setStatus(ParseStatus.PARSING);
    setErrorMsg(null);
    fullXmlDataRef.current = null;
    setShowDuplicateModal(false);
    setShowEnrichmentWarning(false);
    setSavedPlaylists([]); 

    // ELECTRON PATH: Use IPC to read file from disk (Unlimited Size)
    if (window.electron && (file as any).path) {
       const filePath = (file as any).path;
       try {
         const { success, data, error } = await window.electron.readFile(filePath);
         if (!success || !data) {
            throw new Error(error || "Failed to read file via Electron");
         }
         const result = await parseRekordboxXML(data);
         setTracks(result.tracks);
         fullXmlDataRef.current = result.fullData; 
         setStatus(ParseStatus.SUCCESS);
       } catch (err: any) {
         setErrorMsg(err.message || "Failed to parse XML via Electron.");
         setStatus(ParseStatus.ERROR);
       }
       return;
    }

    // BROWSER FALLBACK
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result;
      if (typeof text !== 'string') {
        setErrorMsg("Failed to read file content.");
        setStatus(ParseStatus.ERROR);
        return;
      }
      try {
        const result = await parseRekordboxXML(text);
        setTracks(result.tracks);
        fullXmlDataRef.current = result.fullData; 
        setStatus(ParseStatus.SUCCESS);
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to parse XML.");
        setStatus(ParseStatus.ERROR);
      }
    };
    reader.onerror = () => { setErrorMsg("Error reading file."); setStatus(ParseStatus.ERROR); };
    reader.readAsText(file);
  };

  const reset = () => {
    setTracks([]);
    setStatus(ParseStatus.IDLE);
    setErrorMsg(null);
    setAnalyzingIds(new Set());
    setIsEnriching(false);
    setIsStatsVisible(false);
    setTerminalLog("");
    setFilteredIds(null);
    setDashboardFilter(null);
    setSmartFilter(null);
    setActiveFilterName(null);
    setSearchInput("");
    setActiveSearchQuery("");
    setShowDuplicateModal(false);
    setShowEnrichmentWarning(false);
    fullXmlDataRef.current = null;
    setSavedPlaylists([]);
    setProcessingStats({
      totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, songsProcessed: 0, totalSongs: 0, startTime: 0, currentSpeed: 0, etaSeconds: 0, currentBatchLatency: 0
    });
  };
  
  const handleCloseStats = () => setIsStatsVisible(false);

  const clearFilter = () => {
    setFilteredIds(null);
    setDashboardFilter(null);
    setSmartFilter(null);
    setActiveFilterName(null);
    setActiveSearchQuery("");
    setSearchInput("");
  };

  const handleAnalyzeTrack = async (trackId: string) => {
    const track = tracks.find(t => t.TrackID === trackId);
    if (!track) return;
    setAnalyzingIds(prev => new Set(prev).add(trackId));
    try {
      const analysis = await generateTags(track);
      updateTrackNode(track, analysis, 'full');
      setTracks(currentTracks => 
        currentTracks.map(t => t.TrackID === trackId ? { ...t, Analysis: analysis } : t)
      );
    } catch (error) {
      console.error(`Failed to analyze track ${trackId}:`, error);
      if (!isEnriching) alert("Failed to analyze track. Check console.");
    } finally {
      setAnalyzingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(trackId);
        return newSet;
      });
    }
  };

  // Generic Batch Processor
  const processBatch = async (
    targetTracks: RekordboxTrack[], 
    mode: 'full' | 'missing_genre' | 'missing_year'
  ) => {
    if (targetTracks.length === 0) return;

    const modeLabel = mode === 'full' ? 'FULL ENRICHMENT' : mode === 'missing_genre' ? 'FIX MISSING GENRES' : 'FIX MISSING YEARS';

    setIsEnriching(true);
    setIsStatsVisible(true);
    const startLog = `[${new Date().toLocaleTimeString()}] Initializing ${modeLabel} job (${targetTracks.length} items)...`;
    setTerminalLog(startLog);
    
    // Initialize Stats
    const startTime = performance.now();
    const initialStats: ProcessingStats = {
      totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, songsProcessed: 0, totalSongs: targetTracks.length, startTime: startTime, currentSpeed: 0, etaSeconds: 0, currentBatchLatency: 0
    };
    setProcessingStats(initialStats);
    
    let jobCumulativeCost = 0;
    let jobCumulativeTokens = 0;
    let completedBatchesCount = 0;
    
    // ADJUST CHUNK SIZES FOR ELECTRON POWER
    // If Electron: Main process handles 50 concurrent requests. We send batches of 200 to keep the queue full.
    // If Browser: We rely on runConcurrent with a smaller chunk size to avoid browser lag.
    const isElectron = !!window.electron;
    const CHUNK_SIZE = isElectron ? 200 : 200; 
    const CONCURRENCY = isElectron ? 2 : 8; // Electron chunks are huge, so we process fewer chunks at once on frontend (main process does the heavy lifting)
    const RETRY_CHUNK_SIZE = 50; 
    
    const chunks = chunkArray<RekordboxTrack>(targetTracks, CHUNK_SIZE);
    const totalBatches = chunks.length;
    const retryQueue: RekordboxTrack[] = [];

    const tasks = chunks.map((chunk) => async () => {
      const chunkStartTime = performance.now();
      const chunkIds = new Set(chunk.map(t => t.TrackID));
      
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        chunkIds.forEach(id => next.add(id));
        return next;
      });

      try {
        const { results: resultsMap, usage } = await generateTagsBatch(chunk, mode);
        
        chunk.forEach(t => {
            if (resultsMap[t.TrackID]) {
                updateTrackNode(t, resultsMap[t.TrackID], mode);
            }
        });

        const processedIds = new Set(Object.keys(resultsMap));
        const missingInBatch = chunk.filter(t => !processedIds.has(t.TrackID));
        
        if (missingInBatch.length > 0) {
            retryQueue.push(...missingInBatch);
        }

        completedBatchesCount++;
        jobCumulativeCost += usage.cost;
        jobCumulativeTokens += (usage.inputTokens + usage.outputTokens);

        const now = performance.now();
        const currentBatchDuration = now - chunkStartTime;
        const durationMs = now - startTime;
        const totalSongsProcessedSoFar = completedBatchesCount * CHUNK_SIZE; // Approximate for speed calc
        const songsPerMin = (totalSongsProcessedSoFar / (durationMs / 60000)) || 0;

        const logLine = formatLogLine(
            `Batch ${completedBatchesCount}/${totalBatches}`, chunk.length, currentBatchDuration, usage, jobCumulativeCost, jobCumulativeTokens, songsPerMin
        );
        setTerminalLog(prevLog => prevLog + '\n' + logLine);

        setProcessingStats(prev => {
           const newProcessedCount = prev.songsProcessed + (chunk.length - missingInBatch.length);
           const remaining = prev.totalSongs - newProcessedCount;
           const eta = songsPerMin > 0 ? (remaining / (songsPerMin / 60)) : 0;
           
           return {
             ...prev,
             totalCost: prev.totalCost + usage.cost,
             totalInputTokens: prev.totalInputTokens + usage.inputTokens,
             totalOutputTokens: prev.totalOutputTokens + usage.outputTokens,
             songsProcessed: newProcessedCount,
             currentSpeed: songsPerMin,
             etaSeconds: eta,
             currentBatchLatency: currentBatchDuration
           };
        });

        setTracks(prev => prev.map(t => {
          if (resultsMap[t.TrackID]) {
            const res = resultsMap[t.TrackID];
            if (mode === 'missing_genre') {
              return { ...t, Genre: res.genre };
            } else if (mode === 'missing_year') {
              return { ...t, Year: res.year || t.Year };
            } else {
              return { ...t, Analysis: res };
            }
          }
          return t;
        }));
        
      } catch (e) {
        retryQueue.push(...chunk);
      } finally {
        setAnalyzingIds(prev => {
          const next = new Set(prev);
          chunkIds.forEach(id => next.delete(id));
          return next;
        });
      }
    });

    await runConcurrent(tasks, CONCURRENCY);

    if (retryQueue.length > 0) {
      const retryMsg = `\n\n[${new Date().toLocaleTimeString()}] Starting Retry Phase for ${retryQueue.length} items...`;
      setTerminalLog(prev => prev + retryMsg);
      
      const retryChunks = chunkArray<RekordboxTrack>(retryQueue, RETRY_CHUNK_SIZE);
      let retryBatchCount = 0;
      const totalRetryBatches = retryChunks.length;
      
      const retryTasks = retryChunks.map(chunk => async () => {
        const chunkStartTime = performance.now();
        const chunkIds = new Set(chunk.map(t => t.TrackID));
        setAnalyzingIds(prev => { const next = new Set(prev); chunkIds.forEach(id => next.add(id)); return next; });

        try {
           const { results: resultsMap, usage } = await generateTagsBatch(chunk, mode);
           chunk.forEach(t => { if (resultsMap[t.TrackID]) updateTrackNode(t, resultsMap[t.TrackID], mode); });
           
           retryBatchCount++;
           jobCumulativeCost += usage.cost;
           jobCumulativeTokens += (usage.inputTokens + usage.outputTokens);
           
           const now = performance.now();
           const currentBatchDuration = now - chunkStartTime;
           
           const logLine = formatLogLine(
                `Retry ${retryBatchCount}/${totalRetryBatches}`, chunk.length, currentBatchDuration, usage, jobCumulativeCost, jobCumulativeTokens, processingStats.currentSpeed
            );
           setTerminalLog(prevLog => prevLog + '\n' + logLine);

           setProcessingStats(prev => {
             return {
                 ...prev,
                 totalCost: prev.totalCost + usage.cost,
                 totalInputTokens: prev.totalInputTokens + usage.inputTokens,
                 totalOutputTokens: prev.totalOutputTokens + usage.outputTokens,
                 songsProcessed: Math.min(prev.songsProcessed + Object.keys(resultsMap).length, prev.totalSongs),
                 currentBatchLatency: currentBatchDuration
             };
           });

           setTracks(prev => prev.map(t => {
            if (resultsMap[t.TrackID]) {
               const res = resultsMap[t.TrackID];
               if (mode === 'missing_genre') return { ...t, Genre: res.genre };
               if (mode === 'missing_year') return { ...t, Year: res.year || t.Year };
               return { ...t, Analysis: res };
            }
            return t;
          }));
        } catch (e) { console.error(`Retry failed`, e); } 
        finally { setAnalyzingIds(prev => { const next = new Set(prev); chunkIds.forEach(id => next.delete(id)); return next; }); }
      });
      
      await runConcurrent(retryTasks, 8);
    }

    const finalDuration = performance.now() - startTime;
    setProcessingStats(prev => ({ ...prev, totalDuration: finalDuration, etaSeconds: 0 }));
    
    setIsEnriching(false);
    const doneMsg = `\n\n[${new Date().toLocaleTimeString()}] ✅ Job Complete! Total Cost: $${jobCumulativeCost.toFixed(4)}`;
    setTerminalLog(prev => prev + doneMsg);
  };

  const handleFixMissingYears = () => {
    const missing = tracks.filter(t => !t.Year || String(t.Year).trim() === "" || t.Year === "0");
    if (missing.length === 0) { alert("No missing years found."); return; }
    const ids = new Set(missing.map(t => t.TrackID));
    setFilteredIds(ids);
    setActiveFilterName("Missing Years");
    processBatch(missing, 'missing_year');
  };

  const handleFixMissingGenres = () => {
    const missing = tracks.filter(t => !t.Genre || String(t.Genre).trim() === "");
    if (missing.length === 0) { alert("No missing genres found."); return; }
    const ids = new Set(missing.map(t => t.TrackID));
    setFilteredIds(ids);
    setActiveFilterName("Missing Genres");
    processBatch(missing, 'missing_genre');
  };

  const handleReviewDuplicates = () => setShowDuplicateModal(true);

  const handleInitiateEnrichment = () => {
    if ((filteredIds || dashboardFilter || activeSearchQuery || smartFilter) && visibleTracks.length !== tracks.length) {
      setShowEnrichmentWarning(true);
    } else {
      executeEnrichment('visible');
    }
  };

  const executeEnrichment = async (scope: 'visible' | 'all') => {
    setShowEnrichmentWarning(false);
    let tracksToProcess = scope === 'visible' ? visibleTracks : tracks;
    if (scope === 'all') clearFilter();
    tracksToProcess = tracksToProcess.filter(t => !t.Analysis);
    if (tracksToProcess.length === 0) { alert("All selected tracks are already enriched!"); return; }
    processBatch(tracksToProcess, 'full');
  };

  const handleExport = () => {
    try {
      if (!fullXmlDataRef.current) throw new Error("No master XML data found.");
      const { ids: duplicateIds } = findDuplicates(tracks);
      generateSmartPlaylists(fullXmlDataRef.current, tracks, duplicateIds, savedPlaylists);
      const xmlString = exportRekordboxXML(fullXmlDataRef.current);
      const blob = new Blob([xmlString], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'rekordbox_enriched.xml';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      let msg = "Export Complete! Your XML is ready.";
      if (duplicateIds.length > 0 || savedPlaylists.length > 0) {
          msg += "\n";
          if (duplicateIds.length > 0) msg += `\n• [POSSIBLE DUPLICATES] playlist created (${duplicateIds.length} tracks).`;
          if (savedPlaylists.length > 0) msg += `\n• Included ${savedPlaylists.length} custom search playlists.`;
      }
      setTimeout(() => alert(msg), 100);
    } catch (e) {
      console.error("Export failed", e);
      alert("Failed to export XML");
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-dj-dark text-white font-sans selection:bg-dj-neon selection:text-black">
      {/* Header */}
      <header className="flex-none h-16 border-b border-dj-border bg-dj-dark/50 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-50">
        <div className="flex items-center gap-3 w-64 flex-shrink-0">
          <div className="w-3 h-3 rounded-full bg-dj-neon shadow-[0_0_10px_rgba(0,243,255,0.5)]"></div>
          <h1 className="text-xl font-bold tracking-tight">
            REKORDBOX <span className="text-dj-neon font-light">ANALYZER</span>
          </h1>
        </div>
        
        {status === ParseStatus.SUCCESS && (
          <>
            <div className="flex-1 max-w-xl mx-4 relative group">
               <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    {isSearchingAI ? (
                        <Sparkles className="h-4 w-4 text-dj-neon animate-spin" />
                    ) : (
                        <Search className="h-4 w-4 text-dj-dim group-focus-within:text-dj-neon transition-colors" />
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Ask AI: 'High energy 90s techno for peak hour...'"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isSearchingAI}
                    className="w-full bg-dj-panel border border-dj-border rounded-full py-1.5 pl-10 pr-10 text-sm text-white focus:outline-none focus:border-dj-neon focus:ring-1 focus:ring-dj-neon/50 transition-all shadow-inner"
                  />
                  {searchInput && (
                      <button 
                        onClick={() => { setSearchInput(""); setActiveSearchQuery(""); setSmartFilter(null); }}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-white"
                      >
                          <X className="w-3 h-3" />
                      </button>
                  )}
               </div>
            </div>

            <div className="flex items-center gap-4 flex-shrink-0">
              {isEnriching ? (
                 <div className="flex flex-col w-64 mr-2 animate-fade-in">
                  <div className="text-xs text-dj-neon mb-1 font-mono text-center animate-pulse">
                     PROCESSING ACTIVE
                  </div>
                </div>
              ) : (
                <div className="text-sm text-dj-dim border-r border-dj-border pr-4">
                   <span className="text-white font-mono">
                    {visibleTracks.length}
                   </span> tracks
                </div>
              )}

              <div className="flex items-center gap-4">
                  {!isEnriching && (
                    <>
                      <button
                        onClick={handleInitiateEnrichment}
                        disabled={tracks.every(t => t.Analysis)}
                        className={`
                            flex items-center gap-2 px-4 py-1.5 rounded text-sm font-bold uppercase tracking-wide transition-all
                            ${tracks.every(t => t.Analysis)
                            ? 'bg-dj-dim/20 text-dj-dim cursor-not-allowed border border-transparent' 
                            : 'bg-dj-neon/10 text-dj-neon border border-dj-neon hover:bg-dj-neon hover:text-black shadow-[0_0_15px_rgba(0,243,255,0.2)] hover:shadow-[0_0_25px_rgba(0,243,255,0.4)]'
                            }
                        `}
                        >
                        AI Enrich
                      </button>
                    </>
                  )}

                  <button
                      onClick={handleExport}
                      className="flex items-center gap-2 px-4 py-1.5 rounded text-sm font-bold uppercase tracking-wide bg-dj-accent/10 text-dj-accent border border-dj-accent hover:bg-dj-accent hover:text-white transition-all shadow-[0_0_15px_rgba(255,0,85,0.2)] hover:shadow-[0_0_25px_rgba(255,0,85,0.4)]"
                  >
                      Export
                  </button>
              </div>

              <button 
                onClick={reset}
                className="ml-2 text-xs px-3 py-1.5 rounded border border-dj-border hover:border-red-500 hover:text-red-500 transition-colors"
              >
                CLEAR
              </button>
            </div>
          </>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-10">
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-dj-neon/5 rounded-full blur-[100px]"></div>
          <div className="absolute top-[30%] -right-[10%] w-[40%] h-[60%] bg-purple-600/5 rounded-full blur-[100px]"></div>
        </div>

        <div className="relative z-10 min-h-full p-6 flex flex-col">
          {status === ParseStatus.IDLE && (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full animate-fade-in-up mt-20">
              <div className="mb-8 text-center space-y-2">
                <h2 className="text-3xl font-bold">Import Collection</h2>
                <p className="text-dj-dim">Export your collection from Rekordbox as XML (File {'>'} Export Collection in XML Format) and drop it below.</p>
                {window.electron && (
                   <p className="text-xs text-dj-neon font-mono mt-2 flex items-center justify-center gap-2">
                     <span className="w-2 h-2 rounded-full bg-dj-neon"></span>
                     ELECTRON ENGINE ACTIVE: Unlimited Batch Size Enabled
                   </p>
                )}
              </div>
              <div className="w-full">
                <FileUploader 
                  onFileSelect={handleFileSelect} 
                  isLoading={false} 
                />
              </div>
            </div>
          )}

          {status === ParseStatus.PARSING && (
             <div className="flex-1 flex flex-col items-center justify-center mt-32">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 border-4 border-dj-border border-t-dj-neon rounded-full animate-spin"></div>
                  <p className="text-lg font-mono animate-pulse">PARSING DATABASE...</p>
                </div>
             </div>
          )}

          {status === ParseStatus.ERROR && (
            <div className="flex-1 flex flex-col items-center justify-center mt-32">
              <div className="bg-red-500/10 border border-red-500/50 p-6 rounded-lg text-center max-w-md">
                <h3 className="text-red-400 font-bold text-lg mb-2">Analysis Failed</h3>
                <p className="text-gray-300 mb-6">{errorMsg}</p>
                <button 
                  onClick={reset}
                  className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded font-medium transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {status === ParseStatus.SUCCESS && (
            <div className="flex flex-col animate-fade-in">
              {isStatsVisible && (
                <ProcessingStatsDisplay 
                  stats={processingStats} 
                  log={terminalLog}
                  onClose={handleCloseStats}
                  isProcessing={isEnriching}
                />
              )}
              
              {!isStatsVisible && (
                <LibraryDashboard 
                  stats={stats} 
                  savedPlaylists={savedPlaylists}
                  onFixYears={handleFixMissingYears}
                  onFixGenres={handleFixMissingGenres}
                  onReviewDuplicates={handleReviewDuplicates}
                  onFilter={handleDashboardFilter}
                  isProcessing={isEnriching}
                />
              )}

              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-dj-dim text-xs">
                  {smartFilter ? <Sparkles className="w-3 h-3 text-dj-neon" /> : <Search className="w-3 h-3" />}
                  <span>Showing {visibleTracks.length} of {tracks.length} tracks</span>
                </div>
                
                <div className="flex items-center gap-4">
                  {/* Save Filter Button */}
                  {(activeFilterName || activeSearchQuery) && visibleTracks.length > 0 && (
                    <button
                      onClick={handleOpenSavePlaylistModal}
                      className="flex items-center gap-1.5 px-3 py-1 bg-green-500/10 border border-green-500 rounded-full text-xs font-bold text-green-500 hover:bg-green-500 hover:text-black transition-all animate-fade-in"
                    >
                      <ListPlus className="w-3 h-3" />
                      Save as Playlist
                    </button>
                  )}

                  {activeFilterName && (
                    <button 
                      onClick={clearFilter}
                      className="flex items-center gap-1.5 px-3 py-1 bg-dj-neon/10 border border-dj-neon rounded-full text-xs font-bold text-dj-neon hover:bg-dj-neon hover:text-black transition-all animate-fade-in"
                    >
                      <Filter className="w-3 h-3" />
                      Focus: {activeFilterName}
                      <X className="w-3 h-3 ml-1" />
                    </button>
                  )}
                </div>
              </div>
              <TrackTable 
                tracks={visibleTracks} 
                onAnalyzeTrack={handleAnalyzeTrack}
                analyzingIds={analyzingIds}
              />
            </div>
          )}
        </div>
      </main>

      {/* Duplicate Review Modal */}
      {showDuplicateModal && (
        <DuplicateReviewModal 
          groups={stats.missingData.duplicateGroups} 
          onClose={() => setShowDuplicateModal(false)} 
        />
      )}

      {/* Enrichment Warning Modal */}
      {showEnrichmentWarning && (
        <EnrichmentWarningModal 
          filteredCount={visibleTracks.length}
          totalCount={tracks.length}
          onProcessFiltered={() => executeEnrichment('visible')}
          onProcessAll={() => executeEnrichment('all')}
          onCancel={() => setShowEnrichmentWarning(false)}
        />
      )}

      {/* Playlist Name Modal */}
      {showPlaylistModal && (
        <PlaylistNameModal
          defaultValue={activeFilterName || activeSearchQuery || "New Playlist"}
          count={visibleTracks.length}
          onSave={handleConfirmSavePlaylist}
          onClose={() => setShowPlaylistModal(false)}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-dj-panel border border-dj-neon/50 text-white px-6 py-3 rounded-full shadow-[0_0_20px_rgba(0,243,255,0.3)] animate-fade-in-up">
           <CheckCircle className="w-5 h-5 text-dj-neon" />
           <span className="font-bold text-sm">{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default App;