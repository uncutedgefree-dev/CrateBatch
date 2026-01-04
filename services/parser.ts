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
  const toHashtag = (str: string) => str ? `#${str.replace(/\s+/g, '')}` : '';
  const parts = [
    analysis.vibe ? toHashtag(analysis.vibe) : '',
    analysis.genre ? toHashtag(analysis.genre) : '',
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
  const genre = findInList(MICRO_GENRE_TAGS);
  const situation = findInList(SITUATION_TAGS);

  // If we found at least one relevant tag, return an analysis object
  if (vibe || genre || situation) {
    return {
      vibe: vibe || "Unknown",
      genre: genre || "Unknown",
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
    if (analysis.genre) {
      attributes['@_Genre'] = analysis.genre;
    }
  } 
  // MODE: Only fix missing Year
  else if (mode === 'missing_year') {
    if (analysis.year) {
      // Safety Check: Update ONLY if the existing year is empty, null, or equals '0'
      const currentYear = attributes['@_Year'];
      if (!currentYear || currentYear === "" || currentYear === "0") {
        attributes['@_Year'] = analysis.year;
      }
    }
  } 
  // MODE: Full Enrichment
  else {
    // In Full Mode, we previously appended hashtags to Comments.
    // WE NO LONGER DO THIS to preserve original comments (Mixed In Key, etc).
    // The Analysis data is stored in the 'tracks' state in App.tsx and used for Playlist Generation only.
    
    // However, if the track is missing basic metadata that we found, we might as well fix it (Year/Genre)
    // ONLY if it is currently missing.
    
    if (analysis.year) {
      const currentYear = attributes['@_Year'];
      if (!currentYear || currentYear === "" || currentYear === "0") {
        attributes['@_Year'] = analysis.year;
      }
    }
    
    // Optional: We could fix missing Genre here too, but users might prefer their own genre tags.
    // We will leave Genre alone in 'full' mode unless it's empty, similar to Year.
    if (analysis.genre) {
      const currentGenre = attributes['@_Genre'];
      if (!currentGenre || currentGenre.trim() === "") {
         attributes['@_Genre'] = analysis.genre;
      }
    }
  }
};

const formatRekordboxPath = (path: string): string => {
  if (!path) return "";
  
  // 1. Decode first to handle mix of encoded/unencoded
  let cleanPath = path;
  try {
    cleanPath = decodeURIComponent(path);
  } catch (e) {
    // fallback to raw if decode fails
    cleanPath = path;
  }

  // 2. Strip existing prefix to normalize to absolute path
  if (cleanPath.startsWith("file://localhost/")) {
    cleanPath = cleanPath.replace("file://localhost/", "/");
  } else if (cleanPath.startsWith("file:///")) {
    cleanPath = cleanPath.replace("file:///", "/");
  }

  // 3. Ensure it starts with / for absolute path
  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }

  // 4. Re-encode using encodeURI
  // This encodes spaces to %20 but preserves path structure (slashes)
  // It does NOT encode '&' or ',' which is standard for file URIs.
  // The XML Builder will automatically escape '&' to '&amp;' in the attribute value.
  const encodedPath = encodeURI(cleanPath);
  
  // 5. Add Rekordbox specific prefix
  return `file://localhost${encodedPath}`;
};

export const parseRekordboxXML = async (xmlContent: string): Promise<ParsedCollection> => {
  return new Promise((resolve, reject) => {
    try {
      // Configure parser to PRESERVE EVERYTHING (Order, Attributes, Children)
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        preserveOrder: true,        // Critical: Keeps array structure, preserves <POSITION_MARK> etc.
        parseAttributeValue: false, // Critical: Keep IDs/BPMs as strings to avoid data type loss
        trimValues: true,
        processEntities: true       // Ensure entities are decoded in values
      });

      const parsedData = parser.parse(xmlContent);

      // Traversal for preserveOrder: true structure:
      // [ { DJ_PLAYLISTS: [ { COLLECTION: [ { TRACK: ... } ] } ] } ]
      
      const root = parsedData?.find((node: any) => node.DJ_PLAYLISTS);
      if (!root) throw new Error("Missing DJ_PLAYLISTS");

      const djPlaylists = root.DJ_PLAYLISTS;
      const collectionNode = djPlaylists?.find((node: any) => node.COLLECTION);
      if (!collectionNode) throw new Error("Missing COLLECTION");

      const collectionChildren = collectionNode.COLLECTION;
      
      // Extract Tracks for UI mapping
      const tracks: RekordboxTrack[] = [];

      collectionChildren.forEach((child: any) => {
        if (child.TRACK) {
          // In preserveOrder, child is { TRACK: [children], :@: {attributes} }
          // The attributes are in the ':@' property (default for fast-xml-parser)
          const attributes = child[':@'] || {};
          const trackChildren = child.TRACK; // Array of child nodes (TEMPO, POSITION_MARK, etc.)

          // Logic to extract Energy
          // Priority 1: <POSITION_MARK Name="Energy X"> (Mixed In Key standard)
          // Priority 2: "Energy: X" in Comments
          // Priority 3: "Rating" attribute (0-255 scale)

          let energy = "";
          let cueCount = 0;

          // 1. Scan POSITION_MARK children
          const energyValues: number[] = [];
          if (Array.isArray(trackChildren)) {
             trackChildren.forEach((node: any) => {
                 if (node.POSITION_MARK) {
                     cueCount++; // Count total cue points (Memory or Hot Cues)
                     
                     const pmAttr = node[':@'];
                     if (pmAttr && pmAttr['@_Name']) {
                         // Match "Energy 6" or "Energy 8"
                         const match = pmAttr['@_Name'].match(/Energy\s+(\d+)/i);
                         if (match) {
                             energyValues.push(parseInt(match[1], 10));
                         }
                     }
                 }
             });
          }

          if (energyValues.length > 0) {
              // Calculate Mode (Most Frequent Energy Value)
              // Tracks might have multiple energy cues; the most frequent one represents the track best.
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

          // 2. Fallback: Comments "Energy: 7"
          const comments = attributes['@_Comments'] || "";
          if (!energy) {
            const energyMatch = comments.match(/Energy\s*:\s*(\d+)/i);
            if (energyMatch) {
              energy = energyMatch[1];
            }
          }

          // 3. Fallback: Rating Attribute
          if (!energy && attributes['@_Rating']) {
            const r = parseInt(attributes['@_Rating'], 10);
            if (!isNaN(r) && r > 0) {
              // Rekordbox stores 1 star = 51, 2 stars = 102, etc. (max 255)
              // Approximate to 1-5 scale
              energy = Math.round(r / 51).toString();
            }
          }

          // 4. Extract existing AI tags from Comments
          const existingAnalysis = extractAnalysisFromComments(comments);

          tracks.push({
            TrackID: attributes['@_TrackID'] || "",
            Name: attributes['@_Name'] || "Unknown Title",
            Artist: attributes['@_Artist'] || "Unknown Artist",
            AverageBpm: attributes['@_AverageBpm'] || "0",
            Tonality: attributes['@_Tonality'] || "",
            Year: attributes['@_Year'] || "",
            TotalTime: attributes['@_TotalTime'] || "0", // Extract TotalTime
            BitRate: attributes['@_BitRate'] || "0",
            Kind: attributes['@_Kind'] || "",
            CueCount: cueCount,
            Comments: comments,
            Energy: energy,
            Genre: attributes['@_Genre'] || "", // Capture Genre for display/editing
            Analysis: existingAnalysis, // Populate Analysis if tags found
            _rawNode: child // Store reference to the master node
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

/**
 * Smart Crate Generator
 * Modifies the fullData object in-place to add an AI_GENERATED folder structure.
 * Now also accepts an optional list of Duplicate IDs to generate a cleaning playlist.
 * Now accepts Custom Playlists (saved searches)
 */
export const generateSmartPlaylists = (
  fullData: any, 
  tracks: RekordboxTrack[], 
  duplicateIds: string[] = [],
  customPlaylists: CustomPlaylist[] = []
) => {
  // 1. Group Data
  const vibes: Record<string, string[]> = {};
  const genres: Record<string, string[]> = {};
  const situations: Record<string, string[]> = {};

  tracks.forEach(t => {
    if (!t.Analysis) return;
    
    // Group by Vibe
    if (t.Analysis.vibe && t.Analysis.vibe !== "Unknown") {
      if (!vibes[t.Analysis.vibe]) vibes[t.Analysis.vibe] = [];
      vibes[t.Analysis.vibe].push(t.TrackID);
    }
    
    // Group by Genre (AI Generated)
    if (t.Analysis.genre && t.Analysis.genre !== "Unknown") {
       if (!genres[t.Analysis.genre]) genres[t.Analysis.genre] = [];
       genres[t.Analysis.genre].push(t.TrackID);
    }

    // Group by Situation
    if (t.Analysis.situation && t.Analysis.situation !== "Unknown") {
       if (!situations[t.Analysis.situation]) situations[t.Analysis.situation] = [];
       situations[t.Analysis.situation].push(t.TrackID);
    }
  });

  // 2. Helpers for creating nodes (fast-xml-parser preserveOrder format)
  const createFolderNode = (name: string, children: any[] = []) => ({
    NODE: children,
    ':@': { 
      '@_Name': name, 
      '@_Type': '0',
      '@_Count': children.length.toString() // Critical: Update Count for Folder Validation
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
        '@_Type': '1', // Type 1 = Playlist
        '@_KeyType': '0', // Critical: Tells Rekordbox these keys are Tracks
        '@_Entries': trackIds.length.toString() // Critical: Entries Count
      } 
    };
  };

  const createSubFolderWithPlaylists = (folderName: string, map: Record<string, string[]>) => {
    const playlists = Object.keys(map).sort().map(key => 
      createPlaylistNode(key, map[key])
    );
    return createFolderNode(folderName, playlists);
  };

  // 3. Build the AI Structure
  const aiRootChildren: any[] = [
    createSubFolderWithPlaylists("Vibes", vibes),
    createSubFolderWithPlaylists("Genres", genres),
    createSubFolderWithPlaylists("Situations", situations)
  ];

  // 3b. Add Custom Saved Searches Folder if exist
  if (customPlaylists.length > 0) {
    const savedPlaylistsNodes = customPlaylists.map(cp => createPlaylistNode(cp.name, cp.trackIds));
    const savedFolder = createFolderNode("SAVED_SEARCHES", savedPlaylistsNodes);
    aiRootChildren.push(savedFolder);
  }

  // 3c. Add Duplicates Playlist if detected
  if (duplicateIds.length > 0) {
    aiRootChildren.unshift(createPlaylistNode("[POSSIBLE DUPLICATES]", duplicateIds));
  }

  const aiRootNode = createFolderNode("AI_GENERATED", aiRootChildren);

  // 4. Inject into fullData
  // Navigate to DJ_PLAYLISTS -> PLAYLISTS -> NODE (Root)
  const djPlaylists = fullData.find((n: any) => n.DJ_PLAYLISTS)?.DJ_PLAYLISTS;
  if (!djPlaylists) return;

  let playlistsNode = djPlaylists.find((n: any) => n.PLAYLISTS);
  
  // Create PLAYLISTS node if it doesn't exist (unlikely in valid export but possible)
  if (!playlistsNode) {
    playlistsNode = { PLAYLISTS: [] };
    djPlaylists.push(playlistsNode);
  }

  // Find the Root Node inside PLAYLISTS
  // Usually the first NODE inside PLAYLISTS is the root folder
  let rootNode = playlistsNode.PLAYLISTS.find((n: any) => n.NODE);

  if (!rootNode) {
     // If no root node exists, we treat PLAYLISTS as the container
     playlistsNode.PLAYLISTS.push(aiRootNode);
  } else {
    // Check if AI_GENERATED already exists in the root and remove it to avoid duplicates
    const children = rootNode.NODE;
    if (Array.isArray(children)) {
      const existingIndex = children.findIndex((n: any) => n[':@']?.['@_Name'] === 'AI_GENERATED');
      if (existingIndex >= 0) {
        children.splice(existingIndex, 1);
      }
      // Append new AI_GENERATED folder
      children.push(aiRootNode);

      // Critical: Update Root Node Count to prevent Rekordbox from ignoring new/existing nodes
      if (rootNode[':@']) {
         rootNode[':@']['@_Count'] = children.length.toString();
      }
    }
  }
};

export const exportRekordboxXML = (fullData: any): string => {
  // Pre-process Step: Sanitize Locations
  // We traverse the fullData structure to find all tracks and fix their Location attribute.
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

  // Build XML from the modified Master State directly
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true, // Must match parser to handle the array structure
    format: true,        // Pretty print
    suppressBooleanAttributes: false
  });

  const xmlStr = builder.build(fullData);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlStr}`;
};