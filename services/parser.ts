import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { ParsedCollection, RekordboxTrack, AIAnalysis, CustomPlaylist } from '../types';
import { VIBE_TAGS, MICRO_GENRE_TAGS, SITUATION_TAGS } from './taxonomy';

// Helper to decode XML entities manually if parser didn't
const decodeEntities = (str: string): string => {
  if (!str) return "";
  return str.replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
};

// Helper to generate hashtags from analysis
export const generateHashtags = (analysis: AIAnalysis): string => {
  if (analysis.hashtags) return analysis.hashtags;
  const toHashtag = (str: string) => str && str !== "Unknown" ? `#${str.replace(/\s+/g, '')}` : '';
  const parts = [
    analysis.vibe ? toHashtag(analysis.vibe) : '',
    analysis.subGenre ? toHashtag(analysis.subGenre) : '', // UPDATED
    analysis.situation ? toHashtag(analysis.situation) : ''
  ].filter(Boolean);
  return parts.join(' ');
};

// Helper to parse hashtags back into Analysis object
const extractAnalysisFromComments = (comments: string): AIAnalysis | undefined => {
  if (!comments) return undefined;
  
  // 1. Decode entities (e.g. #R&amp;B -> #R&B)
  const decodedComments = decodeEntities(comments);

  // 2. Find all hashtags (case insensitive match for extraction)
  // Updated Regex: Allow letters, numbers, underscores, dashes, and ampersands
  const hashtags = decodedComments.match(/#[a-zA-Z0-9_\-&]+/g);
  if (!hashtags) return undefined;
  
  // Normalize found tags: remove #, lowercase, ensure no spaces
  const foundTags = new Set(hashtags.map(t => t.slice(1).toLowerCase()));

  // Helper to find a matching tag from a taxonomy list
  const findInList = (list: string[]): string => {
    for (const item of list) {
      // Create the expected hashtag version of the taxonomy item
      // e.g. "R&B" -> "r&b", "Drum & Bass" -> "drum&bass"
      const normalizedItem = item.toLowerCase().replace(/\s+/g, '');
      if (foundTags.has(normalizedItem)) {
        return item;
      }
    }
    return "";
  };

  const vibe = findInList(VIBE_TAGS);
  const subGenre = findInList(MICRO_GENRE_TAGS); // UPDATED
  const situation = findInList(SITUATION_TAGS);

  // If we found at least one relevant tag, return an analysis object
  if (vibe || subGenre || situation) {
    return {
      vibe: vibe || "Unknown",
      subGenre: subGenre || "Unknown", // UPDATED
      situation: situation || "Unknown"
    };
  }

  return undefined;
};

// Update the Master XML Node in-place
export const updateTrackNode = (track: RekordboxTrack, analysis: AIAnalysis, mode: 'full' | 'missing_genre' | 'missing_year') => {
  if (!track._rawNode || !track._rawNode[':@']) {
    return;
  }

  const attributes = track._rawNode[':@'];

  // MODE: Only fix missing Genre
  if (mode === 'missing_genre') {
    // NOTE: This mode specifically asks to fix the MAIN Genre field in Rekordbox
    // We use the AI's 'genre' (which we treat as Main Genre in this mode)
    // We do NOT use subGenre here unless mainGenre is missing
    const genreToUse = analysis.mainGenre || analysis.subGenre;
    
    if (genreToUse && genreToUse !== "Unknown") {
      attributes['@_Genre'] = genreToUse;
    }
  } 
  // MODE: Only fix missing Year
  else if (mode === 'missing_year') {
    if (analysis.year && analysis.year !== "0") {
      // Safety Check: Update ONLY if the existing year is empty, null, or equals '0'
      const currentYear = attributes['@_Year'];
      if (!currentYear || currentYear === "" || currentYear === "0") {
        attributes['@_Year'] = analysis.year;
      }
    }
  } 
  // MODE: Full Enrichment
  else {
    // In Full Mode (AI ENRICH), we add micro-genres and other vibes to the COMMENTS field
    // as hashtags, but we PRESERVE existing comments.
    const currentComments = attributes['@_Comments'] || "";
    
    // Generate new hashtags but filter out "Unknown" tags first
    const toHashtag = (str: string) => str && str !== "Unknown" ? `#${str.replace(/\s+/g, '')}` : '';
    const parts = [
      analysis.vibe ? toHashtag(analysis.vibe) : '',
      analysis.subGenre ? toHashtag(analysis.subGenre) : '', // UPDATED
      analysis.situation ? toHashtag(analysis.situation) : ''
    ].filter(Boolean);
    
    const hashtags = parts.join(' ');
    
    if (hashtags) {
      // If hashtags already exist in the comments, don't duplicate them
      if (!currentComments.includes(hashtags)) {
        attributes['@_Comments'] = currentComments ? `${currentComments} ${hashtags}` : hashtags;
      }
    }

    // Also fix basic metadata if missing
    if (analysis.year && analysis.year !== "0") {
      const currentYear = attributes['@_Year'];
      if (!currentYear || currentYear === "" || currentYear === "0") {
        attributes['@_Year'] = analysis.year;
      }
    }
    
    // NOTE: We deliberately DO NOT overwrite the main Genre column with Sub-Genre in Full Mode
    // to avoid confusion as requested by user.
    // If the main genre is completely missing, we COULD theoretically fill it,
    // but the user requested strict separation.
    // So we only update Year and Comments (Hashtags) in Full Mode.
  }
};

const formatRekordboxPath = (path: string): string => {
  if (!path) return "";
  
  // 1. Decode first to handle mix of encoded/unencoded
  let cleanPath = path;
  try {
    cleanPath = decodeURIComponent(path);
  } catch (e) {
    cleanPath = path;
  }

  // 2. Strip existing prefix
  if (cleanPath.startsWith("file://localhost/")) {
    cleanPath = cleanPath.replace("file://localhost/", "/");
  } else if (cleanPath.startsWith("file:///")) {
    cleanPath = cleanPath.replace("file:///", "/");
  }

  // 3. Ensure absolute path
  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }

  // 4. Re-encode
  const encodedPath = encodeURI(cleanPath);
  
  // 5. Add Prefix
  return `file://localhost${encodedPath}`;
};

export const parseRekordboxXML = async (xmlContent: string): Promise<ParsedCollection> => {
  return new Promise((resolve, reject) => {
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        preserveOrder: true,        
        parseAttributeValue: false, 
        trimValues: true,
        processEntities: true       
      });

      const parsedData = parser.parse(xmlContent);
      
      const root = parsedData?.find((node: any) => node.DJ_PLAYLISTS);
      if (!root) throw new Error("Missing DJ_PLAYLISTS");

      const djPlaylists = root.DJ_PLAYLISTS;
      const collectionNode = djPlaylists?.find((node: any) => node.COLLECTION);
      if (!collectionNode) throw new Error("Missing COLLECTION");

      const collectionChildren = collectionNode.COLLECTION;
      
      const tracks: RekordboxTrack[] = [];

      collectionChildren.forEach((child: any) => {
        if (child.TRACK) {
          const attributes = child[':@'] || {};
          const trackChildren = child.TRACK; 

          let energy = "";
          let cueCount = 0;

          // Energy Logic...
          const energyValues: number[] = [];
          if (Array.isArray(trackChildren)) {
             trackChildren.forEach((node: any) => {
                 if (node.POSITION_MARK) {
                     cueCount++;
                     const pmAttr = node[':@'];
                     if (pmAttr && pmAttr['@_Name']) {
                         const match = pmAttr['@_Name'].match(/Energy\s+(\d+)/i);
                         if (match) energyValues.push(parseInt(match[1], 10));
                     }
                 }
             });
          }

          if (energyValues.length > 0) {
              const counts: Record<number, number> = {};
              let maxCount = 0;
              let modeVal = energyValues[0];
              for (const val of energyValues) {
                  counts[val] = (counts[val] || 0) + 1;
                  if (counts[val] > maxCount) {
                      maxCount = counts[val];
                      modeVal = val;
                  }
              }
              energy = modeVal.toString();
          }

          const comments = attributes['@_Comments'] || "";
          if (!energy) {
            const energyMatch = comments.match(/Energy\s*:\s*(\d+)/i);
            if (energyMatch) energy = energyMatch[1];
          }

          if (!energy && attributes['@_Rating']) {
            const r = parseInt(attributes['@_Rating'], 10);
            if (!isNaN(r) && r > 0) energy = Math.round(r / 51).toString();
          }

          const existingAnalysis = extractAnalysisFromComments(comments);

          tracks.push({
            TrackID: attributes['@_TrackID'] || "",
            Name: attributes['@_Name'] || "Unknown Title",
            Artist: attributes['@_Artist'] || "Unknown Artist",
            AverageBpm: attributes['@_AverageBpm'] || "0",
            Tonality: attributes['@_Tonality'] || "",
            Year: attributes['@_Year'] || "",
            TotalTime: attributes['@_TotalTime'] || "0", 
            BitRate: attributes['@_BitRate'] || "0",
            Kind: attributes['@_Kind'] || "",
            CueCount: cueCount,
            Comments: comments,
            Energy: energy,
            Genre: attributes['@_Genre'] || "", 
            Analysis: existingAnalysis, 
            _rawNode: child 
          });
        }
      });

      resolve({
        tracks,
        count: tracks.length,
        fullData: parsedData
      });

    } catch (error) {
      console.error("XML Parse Error:", error);
      reject(error);
    }
  });
};

export const generateSmartPlaylists = (
  fullData: any, 
  tracks: RekordboxTrack[], 
  duplicateIds: string[] = [],
  customPlaylists: CustomPlaylist[] = [],
  rootFolderName: string = "AI_GENERATED"
) => {
  // 1. Group Data
  const vibes: Record<string, string[]> = {};
  const subGenres: Record<string, string[]> = {}; // UPDATED from genres
  const situations: Record<string, string[]> = {};

  tracks.forEach(t => {
    if (!t.Analysis) return;
    
    // Group by Vibe
    if (t.Analysis.vibe && t.Analysis.vibe !== "Unknown") {
      if (!vibes[t.Analysis.vibe]) vibes[t.Analysis.vibe] = [];
      vibes[t.Analysis.vibe].push(t.TrackID);
    }
    
    // Group by Sub-Genre (AI Generated)
    if (t.Analysis.subGenre && t.Analysis.subGenre !== "Unknown") { // UPDATED
       if (!subGenres[t.Analysis.subGenre]) subGenres[t.Analysis.subGenre] = [];
       subGenres[t.Analysis.subGenre].push(t.TrackID);
    }

    // Group by Situation
    if (t.Analysis.situation && t.Analysis.situation !== "Unknown") {
       if (!situations[t.Analysis.situation]) situations[t.Analysis.situation] = [];
       situations[t.Analysis.situation].push(t.TrackID);
    }
  });

  // 2. Helpers for creating nodes
  const createFolderNode = (name: string, children: any[] = []) => ({
    NODE: children,
    ':@': { 
      '@_Name': name, 
      '@_Type': '0',
      '@_Count': children.length.toString() 
    } 
  });

  const createPlaylistNode = (name: string, trackIds: string[]) => {
    const trackNodes = trackIds.map(id => ({
      TRACK: [],
      ':@': { '@_Key': id }
    }));
    return {
      NODE: trackNodes,
      ':@': { 
        '@_Name': name, 
        '@_Type': '1', 
        '@_KeyType': '0', 
        '@_Entries': trackIds.length.toString() 
      } 
    };
  };

  const createSubFolderWithPlaylists = (folderName: string, map: Record<string, string[]>) => {
    const playlists = Object.keys(map).sort().map(key => 
      createPlaylistNode(key, map[key])
    );
    return createFolderNode(folderName, playlists);
  };

  // 3. Build the AI Structure - UPDATED: Genres -> Sub-Genres
  const aiRootChildren: any[] = [
    createSubFolderWithPlaylists("Vibes", vibes),
    createSubFolderWithPlaylists("Sub-Genres", subGenres), // UPDATED FOLDER NAME
    createSubFolderWithPlaylists("Situations", situations)
  ];

  if (customPlaylists.length > 0) {
    const savedPlaylistsNodes = customPlaylists.map(cp => createPlaylistNode(cp.name, cp.trackIds));
    const savedFolder = createFolderNode("SAVED_SEARCHES", savedPlaylistsNodes);
    aiRootChildren.push(savedFolder);
  }

  if (duplicateIds.length > 0) {
    aiRootChildren.unshift(createPlaylistNode("[POSSIBLE DUPLICATES]", duplicateIds));
  }

  const aiRootNode = createFolderNode(rootFolderName, aiRootChildren);

  // 4. Inject into fullData
  const djPlaylists = fullData.find((n: any) => n.DJ_PLAYLISTS)?.DJ_PLAYLISTS;
  if (!djPlaylists) return;

  let playlistsNode = djPlaylists.find((n: any) => n.PLAYLISTS);
  
  if (!playlistsNode) {
    playlistsNode = { PLAYLISTS: [] };
    djPlaylists.push(playlistsNode);
  }

  let rootNode = playlistsNode.PLAYLISTS.find((n: any) => n.NODE);

  if (!rootNode) {
     playlistsNode.PLAYLISTS.push(aiRootNode);
  } else {
    const children = rootNode.NODE;
    if (Array.isArray(children)) {
      const existingIndex = children.findIndex((n: any) => n[':@']?.['@_Name'] === rootFolderName);
      if (existingIndex >= 0) {
        children.splice(existingIndex, 1);
      }
      children.push(aiRootNode);

      if (rootNode[':@']) {
         rootNode[':@']['@_Count'] = children.length.toString();
      }
    }
  }
};

export const exportRekordboxXML = (fullData: any): string => {
  const root = fullData.find((node: any) => node.DJ_PLAYLISTS);
  if (root?.DJ_PLAYLISTS) {
    const collectionNode = root.DJ_PLAYLISTS.find((node: any) => node.COLLECTION);
    if (collectionNode?.COLLECTION) {
      collectionNode.COLLECTION.forEach((child: any) => {
        if (child.TRACK && child[':@']) {
          const currentLocation = child[':@']['@_Location'];
          if (currentLocation) {
            child[':@']['@_Location'] = formatRekordboxPath(currentLocation);
          }
        }
      });
    }
  }

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true, 
    format: true,        
    suppressBooleanAttributes: false
  });

  const xmlStr = builder.build(fullData);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlStr}`;
};