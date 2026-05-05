import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Hls from 'hls.js';

export interface SimpleHlsPlayerRef {
    play(): void;
    pause(): void;
    seek(time: number): void;
    mute(): void;
    unmute(): void;
    getCurrentTime(): number;
    getDuration(): number;
    getVideoElement(): HTMLVideoElement | null;
}

interface SimpleHlsPlayerProps {
    src: string;
    autoplay?: boolean;
    controls?: boolean;
    muted?: boolean;
    onError?: (error: Error) => void;
    onTimeUpdate?: (time: number) => void;
    onLoadedMetadata?: () => void;
    onStreamTypeDetected?: (isLive: boolean) => void;
}

const SimpleHlsPlayer = forwardRef<SimpleHlsPlayerRef, SimpleHlsPlayerProps>(
    ({ src, autoplay = false, controls = true, muted, onError, onTimeUpdate, onLoadedMetadata, onStreamTypeDetected }, ref) => {
        const videoRef = useRef<HTMLVideoElement>(null);
        const hlsRef = useRef<Hls | null>(null);

        useImperativeHandle(ref, () => ({
            play() {
                videoRef.current?.play().catch(e => console.error('Play failed:', e));
            },
            pause() {
                videoRef.current?.pause();
            },
            seek(time: number) {
                if (videoRef.current) {
                    videoRef.current.currentTime = time;
                }
            },
            mute() {
                if (videoRef.current) {
                    videoRef.current.muted = true;
                }
            },
            unmute() {
                if (videoRef.current) {
                    videoRef.current.muted = false;
                }
            },
            getCurrentTime() {
                return videoRef.current?.currentTime ?? 0;
            },
            getDuration() {
                return videoRef.current?.duration ?? 0;
            },
            getVideoElement() {
                return videoRef.current;
            },
        }), []);

        const onErrorRef = useRef(onError);
        onErrorRef.current = onError;

        const onTimeUpdateRef = useRef(onTimeUpdate);
        onTimeUpdateRef.current = onTimeUpdate;

        const onLoadedMetadataRef = useRef(onLoadedMetadata);
        onLoadedMetadataRef.current = onLoadedMetadata;

        const onStreamTypeDetectedRef = useRef(onStreamTypeDetected);
        onStreamTypeDetectedRef.current = onStreamTypeDetected;

        // Wire video element event listeners
        useEffect(() => {
            const video = videoRef.current;
            if (!video) return;

            const handleTimeUpdate = () => {
                onTimeUpdateRef.current?.(video.currentTime);
            };

            const handleLoadedMetadata = () => {
                onLoadedMetadataRef.current?.();
            };

            video.addEventListener('timeupdate', handleTimeUpdate);
            video.addEventListener('loadedmetadata', handleLoadedMetadata);

            return () => {
                video.removeEventListener('timeupdate', handleTimeUpdate);
                video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            };
        }, []);

        // Set initial muted state
        useEffect(() => {
            if (videoRef.current && muted !== undefined) {
                videoRef.current.muted = muted;
            }
        }, [muted]);

        useEffect(() => {
            const video = videoRef.current;
            if (!video || !src) return;

            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                });

                hls.on(Hls.Events.ERROR, (_event, data) => {
                    console.error('HLS Error:', data);
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                console.error('Fatal network error, trying to recover');
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.error('Fatal media error, trying to recover');
                                hls.recoverMediaError();
                                break;
                            default:
                                console.error('Fatal error, cannot recover');
                                onErrorRef.current?.(new Error(`HLS fatal error: ${data.type} - ${data.details}`));
                                hls.destroy();
                                break;
                        }
                    }
                });

                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('Time-shift manifest loaded successfully');
                    if (autoplay) {
                        video.play().catch(e => console.error('Autoplay failed:', e));
                    }
                });

                hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
                    onStreamTypeDetectedRef.current?.(data.details.live);
                });

                hls.loadSource(src);
                hls.attachMedia(video);
                hlsRef.current = hls;

                return () => {
                    hls.destroy();
                };
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = src;
                if (autoplay) {
                    video.play().catch(e => console.error('Autoplay failed:', e));
                }
            }
        }, [src, autoplay]);

        return (
            <video
                ref={videoRef}
                controls={controls}
                style={{
                    width: '100%',
                    display: 'block',
                    backgroundColor: '#000',
                }}
            />
        );
    }
);

SimpleHlsPlayer.displayName = 'SimpleHlsPlayer';

export default SimpleHlsPlayer;
