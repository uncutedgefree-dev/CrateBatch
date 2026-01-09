import { RekordboxTrack, LibraryStats, DuplicateGroup, KeyDistItem } from '../types';

export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute tasks with limited concurrency
 */
export const runConcurrent = async <T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  delayBetweenTasks: number = 0
): Promise<void> => {
  const queue = [...tasks];
  
  const worker = async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) {
        try {
          await task();
        } catch (e) {
          console.error("Task failed in concurrent runner", e);
        }
        if (delayBetweenTasks > 0 && queue.length > 0) {
            await sleep(delayBetweenTasks);
        }
      }
    }
  };

  const workers = Array(Math.min(tasks.length, concurrency))
    .fill(null)
    .map(() => worker());
    
  await Promise.all(workers);
};

/**
 * Finds duplicates based on fuzzy name matching and strict duration checking.
 * Returns both the list of IDs (for counting) and the Groups (for UI review).
 */
export const findDuplicates = (tracks: RekordboxTrack[]): { ids: string[], groups: DuplicateGroup[], duplicateCount: number } => {
  const fingerprintMap: Record<string, RekordboxTrack[]> = {};
  const duplicateIds = new Set<string>();
  const duplicateGroups: DuplicateGroup[] = [];

  // Helper to normalize strings
  const normalize = (str: string) => (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // 1. Group by Fingerprint
  tracks.forEach(t => {
    const artist = normalize(t.Artist);
    const title = normalize(t.Name);
    const fingerprint = artist + title;

    if (!fingerprint) return;

    if (!fingerprintMap[fingerprint]) {
      fingerprintMap[fingerprint] = [];
    }
    fingerprintMap[fingerprint].push(t);
  });

  // 2. Strict Duration Check within Groups
  Object.entries(fingerprintMap).forEach(([fingerprint, group]) => {
    if (group.length < 2) return;

    const confirmedDuplicates: RekordboxTrack[] = [];
    const processedIndices = new Set<number>();

    // Compare every track against every other track in the group
    for (let i = 0; i < group.length; i++) {
      let isDup = false;
      for (let j = i + 1; j < group.length; j++) {
        const trackA = group[i];
        const trackB = group[j];

        const durationA = parseInt(trackA.TotalTime || "0", 10);
        const durationB = parseInt(trackB.TotalTime || "0", 10);

        if (durationA === 0 || durationB === 0) continue;

        const diff = Math.abs(durationA - durationB);

        // Check if within 2 seconds
        if (diff <= 2) {
          duplicateIds.add(trackA.TrackID);
          duplicateIds.add(trackB.TrackID);
          isDup = true;
          processedIndices.add(j);
        }
      }
      if (isDup || processedIndices.has(i)) {
        confirmedDuplicates.push(group[i]);
      }
    }

    // Only add to groups if we found actual duplicates in this fingerprint cluster
    // Remove duplicates from the confirmed list to ensure clean grouping if logic overlapped
    const uniqueConfirmed = Array.from(new Set(confirmedDuplicates));
    
    if (uniqueConfirmed.length > 1) {
      duplicateGroups.push({
        fingerprint,
        tracks: uniqueConfirmed
      });
    }
  });

  return { 
    ids: Array.from(duplicateIds), 
    groups: duplicateGroups,
    duplicateCount: duplicateIds.size
  };
};

export const calculateLibraryStats = (tracks: RekordboxTrack[]): LibraryStats => {
  const genreCounts: Record<string, number> = {};
  const vibeCounts: Record<string, number> = {};
  const situationCounts: Record<string, number> = {};
  const yearCounts: Record<string, number> = {};
  const keyCounts: Record<string, number> = {};
  
  let missingYearCount = 0;
  let missingGenreCount = 0;

  // Calculate duplicates
  const { ids: duplicateIds, groups: duplicateGroups, duplicateCount } = findDuplicates(tracks);

  tracks.forEach((track) => {
    // 1. Genre Distribution
    let genre = track.Genre ? track.Genre.trim() : "Unknown";
    if (!track.Genre || track.Genre.trim() === "") {
        missingGenreCount++;
    }
    
    if (genre !== "Unknown") {
      genre = genre.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    }
    
    genreCounts[genre] = (genreCounts[genre] || 0) + 1;

    // 2. Vibe Distribution
    if (track.Analysis?.vibe && track.Analysis.vibe !== "Unknown") {
      const vibe = track.Analysis.vibe;
      vibeCounts[vibe] = (vibeCounts[vibe] || 0) + 1;
    }

    // 3. Situation Distribution (Context)
    if (track.Analysis?.situation && track.Analysis.situation !== "Unknown") {
      const situation = track.Analysis.situation;
      situationCounts[situation] = (situationCounts[situation] || 0) + 1;
    }

    // 4. Missing Data (Year) & Year Distribution
    const yearRaw = track.Year || track.Analysis?.year || "0";
    if (yearRaw === "" || yearRaw === "0") {
      missingYearCount++;
    } else {
      // Normalize Year to YYYY
      const y = yearRaw.substring(0, 4);
      if (parseInt(y) > 1950 && parseInt(y) <= new Date().getFullYear() + 1) {
        yearCounts[y] = (yearCounts[y] || 0) + 1;
      }
    }

    // 5. Key Distribution
    const key = track.Tonality;
    if (key && key.match(/^\d+[AB]$/)) { // Match Camelot (e.g., 8A, 12B)
      keyCounts[key] = (keyCounts[key] || 0) + 1;
    }
  });

  // --- Aggregate & Sort Data ---

  // Genres
  const genreDistribution = Object.entries(genreCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10); 

  // Vibes
  const vibeDistribution = Object.entries(vibeCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Situations (Take top 6 for a balanced Radar Chart)
  const situationDistribution = Object.entries(situationCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Timeline
  const yearDistribution = Object.entries(yearCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => parseInt(a.name) - parseInt(b.name));

  // Camelot Wheel
  const majorKeys: KeyDistItem[] = [];
  const minorKeys: KeyDistItem[] = [];
  
  // Fill all 12 keys even if 0 to maintain circle shape
  for (let i = 1; i <= 12; i++) {
    const kMaj = `${i}B`;
    const kMin = `${i}A`;
    majorKeys.push({ name: kMaj, value: keyCounts[kMaj] || 0, type: 'Major', camelotIndex: i });
    minorKeys.push({ name: kMin, value: keyCounts[kMin] || 0, type: 'Minor', camelotIndex: i });
  }

  // Library Score Calculation
  const total = tracks.length;
  if (total === 0) return {
    genreDistribution: [], vibeDistribution: [], situationDistribution: [], yearDistribution: [], 
    keyDistribution: { major: [], minor: [] }, libraryScore: 0,
    missingData: { missingYear: 0, missingGenre: 0, totalTracks: 0, duplicateCount: 0, duplicateGroups: [] }
  };

  const yearScore = Math.max(0, (total - missingYearCount) / total) * 30;
  const genreScore = Math.max(0, (total - missingGenreCount) / total) * 30;
  
  // Tag Score (Do we have AI tags or standard Energy?)
  const tracksWithEnergyOrAI = tracks.filter(t => (t.Energy && t.Energy !== "0") || t.Analysis).length;
  const tagScore = (tracksWithEnergyOrAI / total) * 20;

  // Duplicate Score (Penalize duplicates)
  const dupRatio = duplicateIds.length / total;
  const dupScore = Math.max(0, (1 - dupRatio * 5)) * 20; // Heavy penalty if > 20% duplicates

  const libraryScore = Math.round(yearScore + genreScore + tagScore + dupScore);

  return {
    genreDistribution,
    vibeDistribution,
    situationDistribution,
    yearDistribution,
    keyDistribution: {
      major: majorKeys, // 1B-12B
      minor: minorKeys  // 1A-12A
    },
    libraryScore,
    missingData: {
      missingYear: missingYearCount,
      missingGenre: missingGenreCount,
      totalTracks: tracks.length,
      duplicateCount: duplicateCount, // Updated
      duplicateGroups: duplicateGroups
    }
  };
};
