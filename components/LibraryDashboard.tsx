import React from 'react';
import { 
  PieChart, Pie, Cell, 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  RadialBarChart, RadialBar, PolarAngleAxis as RadialPolarAngleAxis
} from 'recharts';
import { Activity, BarChart3, Disc, Map, Clock, Hash, ListPlus } from 'lucide-react';
import { LibraryStats, CustomPlaylist } from '../types';

interface LibraryDashboardProps {
  stats: LibraryStats;
  savedPlaylists: CustomPlaylist[];
  onFixYears: () => void;
  onFixGenres: () => void;
  onReviewDuplicates: () => void;
  onFilter: (type: 'genre' | 'vibe' | 'year' | 'key', value: string) => void;
  isProcessing: boolean;
}

// Cyberpunk / Neon Palette
const COLORS = ['#00f3ff', '#ff0055', '#7000ff', '#cc00cc', '#ffe600', '#00ff9d', '#ffffff', '#888888'];
const CAMELOT_COLORS_MAJOR = ['#ff0055', '#ff4d00', '#ff9900', '#ffe600', '#88ff00', '#00ff9d', '#00f3ff', '#0088ff', '#0000ff', '#7000ff', '#cc00cc', '#ff00cc'];
const CAMELOT_COLORS_MINOR = ['#990033', '#992e00', '#995c00', '#998a00', '#529900', '#00995e', '#009299', '#005299', '#000099', '#430099', '#7a007a', '#99007a'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-dj-dark/95 border border-dj-neon/50 p-3 rounded-md shadow-[0_0_15px_rgba(0,0,0,0.5)] backdrop-blur-sm z-50">
        <p className="text-white font-bold text-xs uppercase tracking-wider mb-1">{label || data.name}</p>
        <p className="text-dj-neon font-mono text-sm">
          {payload[0].value} <span className="text-gray-500 text-xs">{data.unit || 'tracks'}</span>
        </p>
      </div>
    );
  }
  return null;
};

const LibraryDashboard: React.FC<LibraryDashboardProps> = ({ 
  stats, savedPlaylists, onFixYears, onFixGenres, onReviewDuplicates, onFilter, isProcessing 
}) => {
  const { genreDistribution, vibeDistribution, situationDistribution, yearDistribution, keyDistribution, libraryScore, missingData } = stats;

  if (missingData.totalTracks === 0) return null;

  // Prepare Score Data
  const scoreData = [{ name: 'Score', value: libraryScore, fill: libraryScore > 80 ? '#00f3ff' : libraryScore > 50 ? '#ffe600' : '#ff0055' }];

  return (
    <div className="flex flex-col gap-6 mb-6">
      
      {/* ROW 1: Health, Radar, Camelot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 min-h-[300px]">
        
        {/* 1. Health & Score Card */}
        <div className="bg-dj-panel border border-dj-border rounded-xl p-6 flex flex-col relative overflow-hidden shadow-lg group">
           <div className="absolute top-0 right-0 w-32 h-32 bg-dj-accent/5 rounded-full blur-3xl pointer-events-none"></div>
           
           <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2 text-white text-sm font-bold tracking-widest uppercase">
                  <Activity className="w-4 h-4 text-dj-accent" />
                  Library Integrity
              </div>
              <div className="flex items-center gap-2">
                 {/* Radial Gauge */}
                 <div className="w-16 h-16 relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadialBarChart 
                        innerRadius="70%" outerRadius="100%" barSize={10} data={scoreData} 
                        startAngle={180} endAngle={0}
                      >
                        <RadialPolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                        <RadialBar background dataKey="value" cornerRadius={30} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center pt-2">
                       <span className={`text-sm font-bold ${libraryScore > 80 ? 'text-dj-neon' : libraryScore > 50 ? 'text-yellow-400' : 'text-red-500'}`}>
                         {libraryScore}%
                       </span>
                    </div>
                 </div>
              </div>
           </div>
           
           <div className="space-y-4 relative z-10 flex-1 flex flex-col justify-center">
              {/* Metric Items */}
              {[
                { label: 'Missing Year', count: missingData.missingYear, color: 'text-dj-accent', action: onFixYears, btn: 'Fix AI' },
                { label: 'Missing Genre', count: missingData.missingGenre, color: 'text-yellow-400', action: onFixGenres, btn: 'Fix AI' },
                { label: 'Duplicates', count: missingData.duplicateCount, color: missingData.duplicateCount > 0 ? 'text-red-500' : 'text-green-500', action: onReviewDuplicates, btn: 'Review' }
              ].map((m, i) => (
                <div key={i} className="flex justify-between items-center group/item">
                   <div className="flex flex-col">
                      <span className="text-xs text-gray-400 uppercase tracking-wide group-hover/item:text-white transition-colors">{m.label}</span>
                      <span className={`text-lg font-mono font-bold ${m.count > 0 ? m.color : 'text-gray-600'}`}>{m.count.toLocaleString()}</span>
                   </div>
                   {m.count > 0 && (
                     <button 
                       onClick={m.action} 
                       disabled={isProcessing}
                       className="px-3 py-1 text-[10px] font-bold uppercase border border-dj-border rounded bg-white/5 hover:bg-white hover:text-black hover:border-white transition-all"
                     >
                       {m.btn}
                     </button>
                   )}
                </div>
              ))}

              {/* Saved Playlists Indicator */}
              {savedPlaylists.length > 0 && (
                <div className="flex justify-between items-center pt-2 border-t border-white/5 animate-fade-in">
                   <div className="flex flex-col">
                      <span className="text-xs text-dj-neon uppercase tracking-wide">Pending Export</span>
                      <span className="text-lg font-mono font-bold text-white">{savedPlaylists.length} Playlists</span>
                   </div>
                   <ListPlus className="w-5 h-5 text-dj-neon" />
                </div>
              )}
           </div>
        </div>

        {/* 2. Context Radar (Replacing Scatter Plot) */}
        <div className="bg-dj-panel border border-dj-border rounded-xl p-6 flex flex-col relative overflow-hidden shadow-lg">
           <div className="flex items-center justify-between mb-2 text-white text-sm font-bold tracking-widest uppercase border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <Map className="w-4 h-4 text-dj-neon" />
                Context Radar
              </div>
              <span className="text-[10px] text-dj-dim">Situation Analysis</span>
           </div>
           <div className="flex-1 w-full h-full min-h-0 relative z-10 text-xs">
              {situationDistribution.length > 2 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={situationDistribution}>
                    <PolarGrid stroke="#333" strokeDasharray="3 3" />
                    <PolarAngleAxis 
                      dataKey="name" 
                      tick={{ fill: '#888', fontSize: 10, dy: 3 }} 
                    />
                    <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
                    <Radar
                      name="Situations"
                      dataKey="value"
                      stroke="#00f3ff"
                      fill="#00f3ff"
                      fillOpacity={0.4}
                    />
                    <Tooltip content={<CustomTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                 <div className="absolute inset-0 flex items-center justify-center text-dj-dim text-xs italic opacity-50 flex-col gap-2">
                    <Map className="w-8 h-8 opacity-20" />
                    <span>Run AI Enrichment to see context data</span>
                 </div>
              )}
           </div>
        </div>

        {/* 3. Harmonic Distribution (Camelot Wheel) */}
        <div className="bg-dj-panel border border-dj-border rounded-xl p-6 flex flex-col relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between mb-2 text-white text-sm font-bold tracking-widest uppercase border-b border-white/5 pb-2">
             <div className="flex items-center gap-2">
               <Hash className="w-4 h-4 text-purple-400" />
               Harmonic Keys
             </div>
             <span className="text-[10px] text-dj-dim">Camelot Wheel</span>
          </div>
          <div className="flex-1 w-full h-full min-h-0 relative z-10 flex items-center justify-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  {/* Outer Ring: Major (B) */}
                  <Pie
                    data={keyDistribution.major}
                    dataKey="value"
                    cx="50%" cy="50%"
                    innerRadius={60} outerRadius={80}
                    startAngle={90} endAngle={-270}
                    stroke="none"
                    onClick={(data) => onFilter('key', data.name)}
                    className="cursor-pointer outline-none"
                  >
                    {keyDistribution.major.map((_, index) => (
                      <Cell key={`maj-${index}`} fill={CAMELOT_COLORS_MAJOR[index]} className="hover:opacity-80 transition-opacity" />
                    ))}
                  </Pie>
                  {/* Inner Ring: Minor (A) */}
                  <Pie
                    data={keyDistribution.minor}
                    dataKey="value"
                    cx="50%" cy="50%"
                    innerRadius={40} outerRadius={60}
                    startAngle={90} endAngle={-270}
                    stroke="none"
                    onClick={(data) => onFilter('key', data.name)}
                    className="cursor-pointer outline-none"
                  >
                    {keyDistribution.minor.map((_, index) => (
                      <Cell key={`min-${index}`} fill={CAMELOT_COLORS_MINOR[index]} className="hover:opacity-80 transition-opacity" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ROW 2: Genres, Vibes, Timeline */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[250px]">
        
        {/* 4. Top Genres (Donut) */}
        <div className="bg-dj-panel border border-dj-border rounded-xl p-6 flex flex-col relative overflow-hidden shadow-lg hover:border-dj-neon/30 transition-all">
          <div className="flex items-center gap-2 mb-2 text-white text-sm font-bold tracking-widest uppercase border-b border-white/5 pb-2">
             <Disc className="w-4 h-4 text-dj-neon" />
             Top Genres
          </div>
          <div className="flex-1 w-full h-full min-h-0 relative z-10 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={genreDistribution}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                    cornerRadius={2}
                    onClick={(data) => onFilter('genre', data.name)}
                    className="cursor-pointer"
                  >
                    {genreDistribution.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} className="hover:opacity-80 transition-opacity" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pt-6">
                 <span className="text-xl font-bold text-white">{genreDistribution.length}</span>
                 <span className="text-[9px] text-dj-dim uppercase tracking-wider">Genres</span>
              </div>
          </div>
        </div>

        {/* 5. Vibe Analysis (Bar) */}
        <div className="bg-dj-panel border border-dj-border rounded-xl p-6 flex flex-col relative overflow-hidden shadow-lg hover:border-dj-neon/30 transition-all">
          <div className="flex items-center gap-2 mb-2 text-white text-sm font-bold tracking-widest uppercase border-b border-white/5 pb-2">
             <BarChart3 className="w-4 h-4 text-purple-400" />
             Vibe Analysis
          </div>
          {vibeDistribution.length === 0 ? (
             <div className="flex-1 flex flex-col items-center justify-center text-dj-dim text-xs italic opacity-50">
               No AI Data
             </div>
          ) : (
            <div className="flex-1 w-full h-full min-h-0 text-xs relative z-10 -ml-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={vibeDistribution.slice(0, 8)} 
                  layout="vertical" 
                  margin={{ top: 5, right: 10, left: 10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="vibeGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#7000ff" stopOpacity={0.6}/>
                      <stop offset="100%" stopColor="#cc00cc" stopOpacity={1}/>
                    </linearGradient>
                  </defs>
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={90}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    tick={{ fill: '#888', fontSize: 10, fontWeight: 500 }} 
                  />
                  <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} content={<CustomTooltip />} />
                  <Bar 
                    dataKey="value" 
                    fill="url(#vibeGradient)" 
                    radius={[0, 4, 4, 0]}
                    barSize={12}
                    onClick={(data) => onFilter('vibe', data.name)}
                    className="cursor-pointer hover:opacity-80"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 6. Decades Timeline (Bar) */}
        <div className="bg-dj-panel border border-dj-border rounded-xl p-6 flex flex-col relative overflow-hidden shadow-lg hover:border-dj-neon/30 transition-all">
          <div className="flex items-center gap-2 mb-2 text-white text-sm font-bold tracking-widest uppercase border-b border-white/5 pb-2">
             <Clock className="w-4 h-4 text-blue-400" />
             Timeline
          </div>
          <div className="flex-1 w-full h-full min-h-0 relative z-10">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={yearDistribution}>
                 <XAxis dataKey="name" tick={{fontSize: 9, fill: '#666'}} axisLine={false} tickLine={false} interval={Math.floor(yearDistribution.length / 5)} />
                 <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} content={<CustomTooltip />} />
                 <Bar 
                    dataKey="value" 
                    fill="#333" 
                    radius={[2, 2, 0, 0]} 
                    onClick={(data) => onFilter('year', data.name)}
                    className="cursor-pointer hover:fill-dj-neon transition-colors"
                 />
               </BarChart>
             </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
};

export default LibraryDashboard;