import React, { useState } from 'react';
import { Building2 } from 'lucide-react';

interface SafeImageProps {
  src?: string;
  alt: string;
  className?: string;
}

export function SafeImage({ src, alt, className = 'w-full h-44 object-cover' }: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#ECF3F0] to-[#DCE8E2] text-[#0F3D2E] ${className}`}
      >
        <Building2 className="w-7 h-7 opacity-60" />
        <span className="mt-1.5 text-xs font-medium text-[#0F3D2E]/80 px-3 text-center truncate max-w-full">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
