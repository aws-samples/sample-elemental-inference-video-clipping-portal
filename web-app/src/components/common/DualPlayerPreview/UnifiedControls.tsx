import React from 'react';
import { Pause, Play } from 'lucide-react';

export interface UnifiedControlsProps {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    onPlay(): void;
    onPause(): void;
    onSeek(time: number): void;
}

function formatTime(seconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

const CLOUDSCAPE_BLUE = '#0972d3';

const UnifiedControls: React.FC<UnifiedControlsProps> = ({
    isPlaying,
    currentTime,
    duration,
    onPlay,
    onPause,
    onSeek,
}) => {
    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        onSeek(Number(e.target.value));
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
            <button
                type="button"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={isPlaying ? onPause : onPlay}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                {isPlaying
                    ? <Pause size={20} color={CLOUDSCAPE_BLUE} fill={CLOUDSCAPE_BLUE} />
                    : <Play size={20} color={CLOUDSCAPE_BLUE} fill={CLOUDSCAPE_BLUE} />
                }
            </button>
            <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                aria-label="Seek"
                style={{ flex: 1, accentColor: CLOUDSCAPE_BLUE }}
            />
            <span style={{ whiteSpace: 'nowrap', fontSize: '14px' }}>
                {formatTime(currentTime)} / {formatTime(duration)}
            </span>
        </div>
    );
};

export default UnifiedControls;
