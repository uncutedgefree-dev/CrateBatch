export interface AIAnalysis {
  vibe: string;
  genre: string;
  situation: string;
  year?: string; 
  hashtags?: string; // New field for pre-formatted hashtags
}

export interface RekordboxTrack {
  TrackID: string;
  Name: string;
  Artist: string;
  AverageBpm: string;
  Tonality: string;
  Year: string; 
  TotalTime: string; 
  Energy?: string; 
  Comments: string;
  BitRate?: string;
  Kind?: string; 
  CueCount?: number;
  Analysis?: AIAnalysis; 
  _rawNode?: any; 
  [key: string]: any; 
}

export interface ParsedCollection {
  tracks: RekordboxTrack[];
  count: number;
  fullData: any; 
}

export enum ParseStatus {
  IDLE = 'IDLE',
  PARSING = 'PARSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export interface StatItem {
  name: string;
  value: number;
}

export interface KeyDistItem {
  name: string; // "1A", "1B"
  value: number;
  type: 'Major' | 'Minor';
  camelotIndex: number; // 1-12
}

export interface DuplicateGroup {
  fingerprint: string;
  tracks: RekordboxTrack[];
}

export interface LibraryStats {
  genreDistribution: StatItem[];
  vibeDistribution: StatItem[];
  situationDistribution: StatItem[]; // New: Context Radar
  yearDistribution: StatItem[];
  keyDistribution: {
    major: KeyDistItem[]; // Outer Ring
    minor: KeyDistItem[]; // Inner Ring
  };
  libraryScore: number; // New: 0-100
  missingData: {
    missingYear: number;
    missingGenre: number;
    totalTracks: number;
    duplicateCount: number;
    duplicateGroups: DuplicateGroup[];
  };
}

export interface BatchUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ProcessingStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  songsProcessed: number;
  totalSongs: number;
  startTime: number;
  currentSpeed: number; // songs per minute
  etaSeconds: number;
  currentBatchLatency: number;
  totalDuration?: number; // New: final duration in ms
}

export interface SmartFilterCriteria {
  keywords: string[];
  genres: string[];
  vibes: string[];
  situations: string[];
  minBpm?: number;
  maxBpm?: number;
  minYear?: number;
  maxYear?: number;
  minEnergy?: number;
  maxEnergy?: number;
  keys?: string[]; // Camelot keys e.g. "8A"
  isSemantic: boolean; // true if AI was used
}

export interface CustomPlaylist {
  name: string;
  trackIds: string[];
}

// Global Window Extension for Electron
declare global {
  interface Window {
    electron?: {
      readFile: (path: string) => Promise<{ success: boolean; data: string; error?: string }>;
      saveFile: (payload: { filePath: string; content: string }) => Promise<{ success: boolean; error?: string }>;
      enrichBatch: (payload: { tracks: any[]; prompt: string; apiKey?: string }) => Promise<any[]>;
    };
  }
}
