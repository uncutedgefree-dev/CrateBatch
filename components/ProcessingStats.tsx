import React, { useEffect, useRef, useState } from 'react';
import { DollarSign, Zap, Cpu, Clock, X, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { ProcessingStats } from '../types';

interface ProcessingStatsProps {
  stats: ProcessingStats;
  log: string;
  onClose: () => void;
  isProcessing: boolean;
}

const ProcessingStatsDisplay: React.FC<ProcessingStatsProps> = ({ stats, log, onClose, isProcessing }) => {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  
  const percentage = Math.round((stats.songsProcessed / stats.totalSongs) * 100) || 0;

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  // Auto-scroll logic
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [log, isLogExpanded]);

  return (
    <div className="bg-dj-panel border border-dj-border rounded-lg p-6 mb-6 animate-fade-in shadow-2xl relative overflow-hidden group">
      {/* Background Pulse */}
      {isProcessing && (
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-dj-neon to-purple-600 animate-pulse"></div>
      )}
      {!isProcessing && (
        <div className="absolute top-0 left-0 w-full h-1 bg-green-500"></div>
      )}

      {/* Dismiss Button - Top Right */}
      <button 
        onClick={onClose}
        disabled={isProcessing}
        className={`
            absolute top-4 right-4 p-2 rounded-full transition-all duration-200 z-10
            ${isProcessing 
                ? 'text-gray-600 cursor-not-allowed opacity-50' 
                : 'text-gray-400 hover:text-white hover:bg-white/10'
            }
        `}
        title={isProcessing ? "Wait for process to finish" : "Close Stats"}
      >
        <X className="w-5 h-5" />
      </button>

      {/* Header - Job Status */}
      <div className="flex items-center gap-3 mb-6">
        {isProcessing ? (
           <div className="w-3 h-3 bg-dj-neon rounded-full animate-ping"></div>
        ) : (
           <CheckCircle className="w-5 h-5 text-green-500" />
        )}
        <h2 className="text-lg font-bold text-white tracking-wide">
            {isProcessing ? "PROCESSING BATCH JOB..." : "JOB COMPLETE"}
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {/* Card 1: Cost */}
        <div className="bg-dj-dark/50 border border-dj-border rounded p-4 flex items-center gap-4">
          <div className="p-3 bg-green-500/10 rounded-full text-green-400">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-green-400">
              ${stats.totalCost.toFixed(4)}
            </div>
            <div className="text-xs text-dj-dim">Total AI Cost</div>
          </div>
        </div>

        {/* Card 2: Speed */}
        <div className="bg-dj-dark/50 border border-dj-border rounded p-4 flex items-center gap-4">
          <div className="p-3 bg-yellow-500/10 rounded-full text-yellow-400">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              {Math.round(stats.currentSpeed)} <span className="text-sm font-normal text-dj-dim">spm</span>
            </div>
            <div className="text-xs text-dj-dim">
              Batch Latency: {(stats.currentBatchLatency / 1000).toFixed(1)}s
            </div>
          </div>
        </div>

        {/* Card 3: Tokens */}
        <div className="bg-dj-dark/50 border border-dj-border rounded p-4 flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-full text-blue-400">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              {((stats.totalInputTokens + stats.totalOutputTokens) / 1000).toFixed(1)}k
            </div>
            <div className="text-xs text-dj-dim">
              In: {(stats.totalInputTokens/1000).toFixed(1)}k | Out: {(stats.totalOutputTokens/1000).toFixed(1)}k
            </div>
          </div>
        </div>

        {/* Card 4: ETA / Time Taken */}
        <div className="bg-dj-dark/50 border border-dj-border rounded p-4 flex items-center gap-4">
          <div className="p-3 bg-purple-500/10 rounded-full text-purple-400">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              {isProcessing ? formatTime(stats.etaSeconds) : formatTime((stats.totalDuration || 0) / 1000)}
            </div>
            <div className="text-xs text-dj-dim">
                {isProcessing ? "Estimated Time Left" : "Total Processing Time"}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative pt-2 mb-6">
        <div className="flex items-center justify-between text-xs text-dj-neon font-mono mb-2">
          <span>PROGRESS</span>
          <span>{stats.songsProcessed} / {stats.totalSongs} TRACKS ({percentage}%)</span>
        </div>
        <div className="h-4 bg-dj-dark rounded-full overflow-hidden border border-dj-border">
          <div 
            className={`h-full shadow-[0_0_15px_rgba(0,243,255,0.4)] transition-all duration-500 ease-out relative ${isProcessing ? 'bg-gradient-to-r from-dj-neon to-purple-500' : 'bg-green-500'}`}
            style={{ width: `${percentage}%` }}
          >
             {isProcessing && <div className="absolute inset-0 bg-white/20 animate-[pulse_1s_ease-in-out_infinite]"></div>}
          </div>
        </div>
      </div>

      {/* Terminal / Log Viewer */}
      <div className="mt-4">
         <div className="flex justify-between items-center mb-2">
            <div className="text-xs text-dj-dim uppercase font-bold">Live Activity Log</div>
            <button 
              onClick={() => setIsLogExpanded(!isLogExpanded)}
              className="flex items-center gap-1 text-[10px] uppercase text-dj-neon hover:text-white transition-colors"
            >
              {isLogExpanded ? (
                <>Collapse <ChevronUp className="w-3 h-3" /></>
              ) : (
                <>Expand <ChevronDown className="w-3 h-3" /></>
              )}
            </button>
         </div>
         <div 
           ref={logContainerRef}
           className={`bg-black/50 rounded font-mono text-xs text-gray-300 shadow-inner transition-all duration-300 ease-in-out overflow-y-auto ${isLogExpanded ? 'h-[500px] border border-dj-border p-4 opacity-100 mt-2' : 'h-0 border-0 p-0 opacity-0 mt-0'}`}
         >
             <pre className="whitespace-pre-wrap">{log || "Waiting for logs..."}</pre>
         </div>
      </div>

    </div>
  );
};

export default ProcessingStatsDisplay;