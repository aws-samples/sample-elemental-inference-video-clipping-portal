import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Hls from 'hls.js';

export interface SubtitleTrackInfo {
    id: number;
    name: string;
    lang?: string;
}

export interface SimpleHlsPlayerRef {
    play(): void;
    pause(): void;
    seek(time: number): void;
    mute(): void;
    unmute(): void;
    getCurrentTime(): number;
    getDuration(): number;
    getVideoElement(): HTMLVideoElement | null;
    /** Currently known subtitle tracks (empty when none). */
    getSubtitleTracks(): SubtitleTrackInfo[];
    /** Select a subtitle track by id and render it, or pass -1 to turn captions off. */
    setSubtitleTrack(id: number): void;
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
    /** Fired when the set of available subtitle tracks changes. */
    onSubtitleTracksUpdated?: (tracks: SubtitleTrackInfo[]) => void;
}

const SimpleHlsPlayer = forwardRef<SimpleHlsPlayerRef, SimpleHlsPlayerProps>(
    ({ src, autoplay = false, controls = true, muted, onError, onTimeUpdate, onLoadedMetadata, onStreamTypeDetected, onSubtitleTracksUpdated }, ref) => {
        const videoRef = useRef<HTMLVideoElement>(null);
        const hlsRef = useRef<Hls | null>(null);
        const subtitleTracksRef = useRef<SubtitleTrackInfo[]>([]);

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
            getSubtitleTracks() {
                return subtitleTracksRef.current;
            },
            setSubtitleTrack(id: number) {
                const hls = hlsRef.current;
                if (hls) {
                    // hls.js renders IMSC1 (TTML) / WebVTT cues natively into the
                    // video element. -1 disables captions.
                    hls.subtitleDisplay = id >= 0;
                    hls.subtitleTrack = id;
                    return;
                }
                // Native (Safari) fallback: toggle the matching TextTrack directly.
                const textTracks = videoRef.current?.textTracks;
                if (textTracks) {
                    for (let i = 0; i < textTracks.length; i++) {
                        textTracks[i].mode = i === id ? 'showing' : 'disabled';
                    }
                }
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

        const onSubtitleTracksUpdatedRef = useRef(onSubtitleTracksUpdated);
        onSubtitleTracksUpdatedRef.current = onSubtitleTracksUpdated;

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

            // Reset any tracks discovered for a previous source.
            subtitleTracksRef.current = [];

            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                });
                // Captions are opt-in via the CC toggle; don't auto-show a track.
                hls.subtitleDisplay = false;

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

                hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
                    const tracks: SubtitleTrackInfo[] = data.subtitleTracks.map(t => ({
                        id: t.id,
                        name: t.name || t.lang || `Track ${t.id + 1}`,
                        lang: t.lang,
                    }));
                    subtitleTracksRef.current = tracks;
                    // Keep captions off until the user opts in.
                    hls.subtitleDisplay = false;
                    hls.subtitleTrack = -1;
                    onSubtitleTracksUpdatedRef.current?.(tracks);
                });

                hls.loadSource(src);
                hls.attachMedia(video);
                hlsRef.current = hls;

                return () => {
                    hls.destroy();
                    hlsRef.current = null;
                    subtitleTracksRef.current = [];
                };
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = src;
                if (autoplay) {
                    video.play().catch(e => console.error('Autoplay failed:', e));
                }

                // Native HLS (Safari) exposes subtitle renditions as TextTracks.
                const reportNativeTracks = () => {
                    const textTracks = video.textTracks;
                    const tracks: SubtitleTrackInfo[] = [];
                    for (let i = 0; i < textTracks.length; i++) {
                        const tt = textTracks[i];
                        if (tt.kind === 'subtitles' || tt.kind === 'captions') {
                            tt.mode = 'disabled';
                            tracks.push({ id: i, name: tt.label || tt.language || `Track ${i + 1}`, lang: tt.language });
                        }
                    }
                    subtitleTracksRef.current = tracks;
                    if (tracks.length > 0) {
                        onSubtitleTracksUpdatedRef.current?.(tracks);
                    }
                };
                video.textTracks.addEventListener('addtrack', reportNativeTracks);

                return () => {
                    video.textTracks.removeEventListener('addtrack', reportNativeTracks);
                    subtitleTracksRef.current = [];
                };
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
