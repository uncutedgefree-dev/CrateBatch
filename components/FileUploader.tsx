import React, { useCallback, useState } from 'react';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect, isLoading }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === "text/xml" || file.name.endsWith(".xml")) {
        onFileSelect(file);
      } else {
        alert("Please upload a valid XML file.");
      }
    }
  }, [onFileSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
    }
  }, [onFileSelect]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative group border-2 border-dashed rounded-xl p-12 text-center transition-all duration-300 ease-in-out cursor-pointer
        ${isDragOver 
          ? 'border-dj-neon bg-dj-neon/10 scale-[1.02]' 
          : 'border-dj-dim/30 hover:border-dj-neon/50 hover:bg-dj-panel'
        }
      `}
    >
      <input
        type="file"
        accept=".xml"
        onChange={handleInputChange}
        disabled={isLoading}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />
      
      <div className="flex flex-col items-center justify-center gap-4">
        {isLoading ? (
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-dj-neon"></div>
        ) : (
          <>
            <div className={`p-4 rounded-full bg-dj-panel border border-dj-border transition-colors group-hover:border-dj-neon/50`}>
              <svg 
                className={`w-10 h-10 ${isDragOver ? 'text-dj-neon' : 'text-gray-400 group-hover:text-dj-neon'}`}
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-1">
                Drop Rekordbox XML
              </h3>
              <p className="text-sm text-dj-dim">
                or click to browse local files
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FileUploader;