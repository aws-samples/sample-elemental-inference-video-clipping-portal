import { useState, useCallback, useEffect, useRef } from 'react';
import type { SimpleHlsPlayerRef } from '../SimpleHlsPlayer';

export interface UseSyncPlaybackOptions {
    landscapeRef: React.RefObject<SimpleHlsPlayerRef | null>;
    portraitRef: React.RefObject<SimpleHlsPlayerRef | null>;
    enabled: boolean;
    driftTolerance?: number;
}

export interface UseSyncPlaybackReturn {
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    play(): void;
    pause(): void;
    seek(time: number): void;
}

export function useSyncPlayback({
    landscapeRef,
    portraitRef,
    enabled,
    driftTolerance = 0.5,
}: UseSyncPlaybackOptions): UseSyncPlaybackReturn {
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    const rafIdRef = useRef<number | null>(null);
    const isPlayingRef = useRef(false);

    // Keep the ref in sync so the rAF loop reads the latest value
    isPlayingRef.current = isPlaying;

    const play = useCallback(() => {
        landscapeRef.current?.play();
        if (enabled) {
            portraitRef.current?.play();
        }
        setIsPlaying(true);
    }, [landscapeRef, portraitRef, enabled]);

    const pause = useCallback(() => {
        landscapeRef.current?.pause();
        if (enabled) {
            portraitRef.current?.pause();
        }
        setIsPlaying(false);
    }, [landscapeRef, portraitRef, enabled]);

    const seek = useCallback(
        (time: number) => {
            landscapeRef.current?.seek(time);
            if (enabled) {
                portraitRef.current?.seek(time);
            }
            setCurrentTime(time);
        },
        [landscapeRef, portraitRef, enabled],
    );

    // requestAnimationFrame polling loop
    useEffect(() => {
        const tick = () => {
            const landscape = landscapeRef.current;
            if (!landscape) {
                rafIdRef.current = requestAnimationFrame(tick);
                return;
            }

            const lTime = landscape.getCurrentTime();
            const lDuration = landscape.getDuration();

            setCurrentTime(lTime);
            if (lDuration && !Number.isNaN(lDuration)) {
                setDuration(lDuration);
            }

            // Sync portrait when enabled and playing
            if (enabled && isPlayingRef.current) {
                const portrait = portraitRef.current;
                if (portrait) {
                    const pTime = portrait.getCurrentTime();
                    if (Math.abs(lTime - pTime) > driftTolerance) {
                        portrait.seek(lTime);
                    }
                }
            }

            rafIdRef.current = requestAnimationFrame(tick);
        };

        rafIdRef.current = requestAnimationFrame(tick);

        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, [landscapeRef, portraitRef, enabled, driftTolerance]);

    return { currentTime, duration, isPlaying, play, pause, seek };
}
