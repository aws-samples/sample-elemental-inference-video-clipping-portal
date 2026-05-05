import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    useMemo,
} from "react";
import { filter } from "rxjs";
import "./OmakasePlayer.css";
import "./ModernPlayer.css";
import { MarkerLane, OmakasePlayer, PeriodMarker } from "@byomakase/omakase-player";
// Timeline constants are now inline for better maintainability
import CustomSlider from "./CustomSlider";
import { Maximize, Pause, Play, Volume2, VolumeOff } from "lucide-react";
import { VideoSegment } from "../../../types";
import { Box } from "@cloudscape-design/components";

// HLS Segment Detection
interface HLSSegmentInfo {
    startTime: number;
    endTime: number;
    duration: number;
    url: string;
    index: number;
}

export interface OmakaseVideoPlayerProps {
    videoSrc: string;
    // Core playback callbacks
    onPlay?: () => void;
    onPause?: () => void;
    onSeek?: (time: number) => void;
    onTimeUpdate?: (time: number) => void;
    onDurationChange?: (duration: number) => void;
    onError?: (error: any) => void;
    // Timeline and segment features
    showTimeline?: boolean;
    showThumbnails?: boolean;
    segments: VideoSegment[]; // Segments are always displayed when available
    // Edit operations support
    trimStart?: number;
    trimEnd?: number;
}

export interface OmakaseVideoPlayerRef {
    // Core playback controls
    getCurrentTime: () => number;
    getDuration: () => number;
    seekToTime: (time: number) => void;
    play: () => void;
    pause: () => void;
    isPlaying: () => boolean;
    // Utility functions
    formatToTimecode: (time: number) => string;
}

// Utility function for generating segment colors
function getSegmentColor(index: number): string {
    const colors = [
        "#00FFFF",
        "#FF028D",
        "#00FF00",
        "#FFFF00",
        "#FF00FF",
        "#FF7124",
        "#21FC0D",
        "#BC13FE",
        "#DDA0DD",
        "#4ECDC4",
        "#45B7D1",
        "#96CEB4",
        "#FFEAA7",
        "#FF6B6B",
        "#FFA5A5",
        "#98D8C8",
        "#F39C12",
    ];
    return colors[index % colors.length];
}

// HLS Segment Analysis Functions
async function fetchHLSManifest(hlsUrl: string): Promise<string> {
    try {
        const response = await fetch(hlsUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch HLS manifest: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.error("Error fetching HLS manifest:", error);
        throw error;
    }
}

function parseHLSManifest(manifestContent: string): HLSSegmentInfo[] {
    const lines = manifestContent.split('\n').map(line => line.trim());
    const segments: HLSSegmentInfo[] = [];
    let currentTime = 0;
    let segmentIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for segment duration directive
        if (line.startsWith('#EXTINF:')) {
            const durationMatch = line.match(/#EXTINF:([0-9.]+)/);
            if (durationMatch) {
                const duration = parseFloat(durationMatch[1]);
                
                // Next line should be the segment URL
                const nextLine = lines[i + 1];
                if (nextLine && !nextLine.startsWith('#')) {
                    segments.push({
                        startTime: currentTime,
                        endTime: currentTime + duration,
                        duration: duration,
                        url: nextLine,
                        index: segmentIndex
                    });
                    
                    currentTime += duration;
                    segmentIndex++;
                }
            }
        }
    }
    
    return segments;
}

function createVideoSegmentsFromHLS(hlsSegments: HLSSegmentInfo[]): VideoSegment[] {
    return hlsSegments.map((hlsSegment, index) => ({
        id: `hls-segment-${hlsSegment.index}`,
        startTime: hlsSegment.startTime,
        endTime: hlsSegment.endTime,
        duration: hlsSegment.duration,
        order: index,
        enabled: true,
        name: `Segment ${hlsSegment.index + 1}`,
        color: getSegmentColor(index),
    }));
}

async function analyzeHLSContent(videoSrc: string): Promise<VideoSegment[]> {
    try {
        
        // Check if this is an HLS URL
        if (!videoSrc.includes('.m3u8')) {
            return [];
        }
        
        // Fetch and parse the HLS manifest
        const manifestContent = await fetchHLSManifest(videoSrc);
        const hlsSegments = parseHLSManifest(manifestContent);
        
        // Convert to VideoSegment format
        const videoSegments = createVideoSegmentsFromHLS(hlsSegments);
        
        return videoSegments;
        
    } catch (error) {
        console.error("Failed to analyze HLS content:", error);
        return []; // Return empty array on error
    }
}

/**
 * Custom hook that creates and manages the OmakasePlayer instance.
 * We pass in a markerLaneRef to save the created marker lane so that we can add markers later.
 */
const useOmakasePlayer = (
    videoSrc: string,
    containerRef: React.RefObject<HTMLDivElement | null>,
    callbacks: Partial<OmakaseVideoPlayerProps>,
    markerLaneRef: React.MutableRefObject<MarkerLane | null>,
    playerId: string,
    timelineId: string,
    showTimeline: boolean = true,
    segments: VideoSegment[],
    showThumbnails: boolean = false,
    trimStart?: number,
    trimEnd?: number,
    tooltipFunctions?: {
        createTooltip: (content: string, mouseX?: number, mouseY?: number) => void;
        removeTooltip: () => void;
        scheduleTooltipRemoval: (delay?: number) => void;
    }
) => {
    const playerRef = useRef<OmakasePlayer | null>(null);
    const [, setPlayerVolume] = useState(1);
    const isInitializingRef = useRef(false);
    const initializedVideoSrcRef = useRef<string>("");

    const callbacksRef = useRef(callbacks);
    useEffect(() => {
        callbacksRef.current = callbacks;
    }, [callbacks]);



    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [hlsSegments, setHlsSegments] = useState<VideoSegment[]>([]);
    const [isAnalyzingHLS, setIsAnalyzingHLS] = useState(false);
    
    // Playback control state for edit operations
    const [isPlayingSegments, setIsPlayingSegments] = useState(false);
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
    const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const initializePlayer = useCallback(() => {

        if (!containerRef || !containerRef.current) {
            console.warn("Container not ready, skipping player initialization");
            return;
        }

        // Prevent double initialization
        if (isInitializingRef.current) {
            console.warn("Player initialization already in progress, skipping");
            return;
        }

        // Skip if already initialized with same video
        if (playerRef.current && initializedVideoSrcRef.current === videoSrc) {
            return;
        }

        isInitializingRef.current = true;

        // Clean up previous player instance if it exists
        if (playerRef.current) {
            playerRef.current = null;
        }

        // Clear the timeline container if timeline is enabled
        if (showTimeline && timelineId) {
            const timelineContainer = document.getElementById(timelineId);
            if (timelineContainer) {
                timelineContainer.innerHTML = "";
            }
        }

        // Set unique ID for the player container
        if (playerId) {
            containerRef.current.id = playerId;
        }

        try {
            const playerConfig = {
                playerHTMLElementId: playerId || containerRef.current.id || "omakase-player",
            };
            const player = new OmakasePlayer(playerConfig);
            playerRef.current = player;
        } catch (error) {
            console.error("Failed to create OmakasePlayer:", error);
            return;
        }

        const player = playerRef.current;
        if (!player) {
            console.error("Player is null after creation");
            return;
        }

        // Only create timeline if showTimeline is true
        if (showTimeline) {
            player
                .createTimeline({
                    timelineHTMLElementId: timelineId || "omakase-timeline",
                    style: {
                        stageMinHeight: 90, // Increased height to accommodate timecode text
                        rightPaneMarginLeft: 10,
                        rightPaneMarginRight: 10,
                        rightPaneClipPadding: 10,
                        backgroundFill: "#292d43", // Dark background like the image
                        playheadFill: "#43F4FF",
                        playheadBufferedFill: "#989BFF",
                        playheadBackgroundFill: "#83899E",
                        playheadPlayProgressFill: "#3E44FE",
                        scrubberFill: "#B2BAD6",
                        scrubberSnappedFill: "#9ED78D",
                        playheadLineWidth: 3,
                        playheadSymbolHeight: 16,
                        headerHeight: 0,
                        footerHeight: 0,
                        leftPaneWidth: 0,
                        scrollbarHeight: 0, // Hide zoom/scroll bar
                        playheadVisible: true,
                        headerBackgroundFill: "#EDEFEE",
                        headerMarginBottom: 0,
                        footerBackgroundFill: "#EDEFEE",
                        footerMarginTop: 0,
                        thumbnailHoverWidth: showThumbnails ? 200 : 0,
                        thumbnailHoverStroke: "#43F4FF",
                        thumbnailHoverStrokeWidth: 3,
                        thumbnailHoverYOffset: -10,
                        playheadScrubberHeight: 10,
                        playheadTextFill: "#FFFFFF", // White text for visibility
                        playheadTextYOffset: -15,
                        playheadBackgroundOpacity: 0,
                        playheadPlayProgressOpacity: 0.5,
                        playheadBufferedOpacity: 0.7, // Reduce buffer opacity so text shows through
                        scrubberHeight: 50, // Increase height to accommodate text
                        scrubberMarginBottom: 5,
                        scrubberSouthLineOpacity: 0.2,
                        scrubberTextFill: "#FFFFFF", // White text for timecode visibility
                        scrubberTextYOffset: -35, // Position text above the buffer area
                        scrollbarBackgroundFill: "#1e293b",
                        // scrollbarHandleFill: "#6c548a",
                        // scrollbarHandleHoverFill: "#64748b",
                        // scrollbarBorderRadius: 8,
                    },
                    zoomWheelEnabled: false,
                    // Zoom functionality disabled as requested
                })
                .subscribe((timelineApi) => {
                    const scrubberLane = timelineApi.getScrubberLane();
                    scrubberLane.style = {
                        backgroundFill: "#2A2D3A", // Dark background
                        tickFill: "#FFFFFF", // White tick marks
                        timecodeFill: "#FFFFFF", // White timecode text
                        marginBottom: 5, // Add margin to separate from other elements
                        tickHeight: 12, // Taller tick marks for better visibility
                    };
                });
        }


        const subscriptions = [
            player.loadVideo(videoSrc, { frameRate: 30 }).subscribe({
                next: async (video) => {
                    setDuration(video.duration);
                    callbacksRef.current.onDurationChange?.(video.duration);
                    initializedVideoSrcRef.current = videoSrc;
                    isInitializingRef.current = false;
                    
                    // Analyze HLS content for segments
                    if (videoSrc.includes('.m3u8')) {
                        setIsAnalyzingHLS(true);
                        try {
                            const detectedSegments = await analyzeHLSContent(videoSrc);
                            setHlsSegments(detectedSegments);
                        } catch (error) {
                            console.error("HLS analysis failed:", error);
                            setHlsSegments([]);
                        } finally {
                            setIsAnalyzingHLS(false);
                        }
                    }
                },
                error: (error) => {
                    console.error("Error loading video:", error);
                    callbacksRef.current.onError?.(error);
                    isInitializingRef.current = false;
                },
                complete: () => {
                    console.log("Video loading completed");
                },
            }),
            player.video.onPlay$.subscribe({
                next: (event) => {
                    callbacksRef.current.onPlay?.();
                },
            }),
            player.video.onPause$.subscribe({
                next: (event) => {
                    if (playerRef?.current)
                    callbacksRef.current.onPause?.();
                },
            }),
            player.video.onSeeked$.subscribe({
                next: (event) => {
                    callbacksRef.current.onSeek?.(event.currentTime);
                },
            }),
            player.video.onBuffering$.subscribe({
                next: () => {
                    console.log("Video buffering");
                },
            }),
            player.video.onEnded$.subscribe({
                next: () => {
                    console.log("Video ended - stopping segment playback");
                    setIsPlayingSegments(false);
                    setCurrentSegmentIndex(0);
                },
            }),
            player.video.onFullscreenChange$.subscribe({
                next: (event: any) => {
                    // Forward fullscreen changes if needed.
                    console.log("onFullscreenChange$", event);
                },
            }),
            player.video.onVolumeChange$.subscribe({
                next: (event) => {
                    const newVolume = Math.round(event.volume * 100);
                    setPlayerVolume(event.volume);
                },
            }),
            player.video.onVideoTimeChange$.subscribe({
                next: (event) => {
                    setCurrentTime(event.currentTime);
                    callbacksRef.current.onTimeUpdate?.(event.currentTime);
                },
            }),
            player.video.onVideoError$.subscribe({
                next: (error) => {
                    console.error("Video error:", error);
                    callbacksRef.current.onError?.(error);
                },
            }),
        ];

        // Only create timeline lanes if timeline is enabled
        if (showTimeline) {
            player.video.onVideoLoaded$.pipe(filter((video) => !!video)).subscribe({
                next: () => {
                    createTimelineLanes();
                },
            });
        }

        const createTimelineLanes = () => {
            createMarkerLane();
        };

        const createMarkerLane = () => {
            // Only create marker lane if timeline exists
            if (!player.timeline) {
                return;
            }

            const markerLane = new MarkerLane({
                style: {
                    height: 30,
                    backgroundFill: "rgba(0, 0, 0, 0.1)",
                    marginBottom: 5,
                },
            });
            player.timeline.addTimelineLane(markerLane);
            markerLaneRef.current = markerLane;

            // Create segment markers if segments are provided
            createSegmentMarkers(markerLane);
        };

        // Helper function to format time for tooltips
        const formatTimeForTooltip = (time: number): string => {
            const hours = Math.floor(time / 3600);
            const minutes = Math.floor((time % 3600) / 60);
            const seconds = Math.floor(time % 60);
            const frames = Math.floor((time % 1) * 25);
            return `${hours.toString().padStart(2, "0")}:${minutes
                .toString()
                .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames
                .toString()
                .padStart(2, "0")}`;
        };

        // Use tooltip functions from component level if available
        const { createTooltip, removeTooltip, scheduleTooltipRemoval } = tooltipFunctions || {};



        const createSegmentMarkers = (markerLane: MarkerLane) => {

            if (segments.length === 0) {
                return;
            }

            segments.forEach((segment: VideoSegment, index: number) => {
                const segmentColor = segment.enabled ? getSegmentColor(index) : "#666666";
                const marker = new PeriodMarker({
                    timeObservation: { start: segment.startTime, end: segment.endTime },
                    editable: false,
                    style: {
                        color: segmentColor,
                        symbolSize: segment.enabled ? 10 : 8,
                        symbolType: "circle",
                    },
                });

                // Click to seek to segment start (only if enabled)
                marker.onClick$.subscribe(() => {
                    if (player?.video && segment.enabled) {
                        player.video.seekToTime(segment.startTime);
                    }
                });

                // Hover effects with tooltip
                marker.onMouseEnter$.subscribe((event) => {
                    marker.style = { ...marker.style, symbolSize: segment.enabled ? 12 : 10 };

                    if (createTooltip) {
                        const duration = segment.endTime - segment.startTime;
                        const statusText = segment.enabled ? "Enabled" : "Disabled";
                        const statusColor = segment.enabled ? "#10b981" : "#ef4444";
                        
                        const formatTimeForTooltip = (time: number): string => {
                            const hours = Math.floor(time / 3600);
                            const minutes = Math.floor((time % 3600) / 60);
                            const seconds = Math.floor(time % 60);
                            const frames = Math.floor((time % 1) * 25);
                            return `${hours.toString().padStart(2, "0")}:${minutes
                                .toString()
                                .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames
                                .toString()
                                .padStart(2, "0")}`;
                        };
                        
                        const tooltipContent = `
                            <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #f1f5f9;">
                                <span style="color: ${segmentColor};">●</span> ${segment.name || `Segment ${index + 1}`}
                                <span style="color: ${statusColor}; font-size: 12px; margin-left: 8px;">(${statusText})</span>
                            </div>
                            <div style="font-size: 12px; color: #cbd5e1; font-family: monospace;">
                                ${formatTimeForTooltip(segment.startTime)} - ${formatTimeForTooltip(segment.endTime)}
                                <br/>Duration: ${formatTimeForTooltip(duration)}
                            </div>
                            ${!segment.enabled ? '<div style="font-size: 11px; color: #fbbf24; margin-top: 4px;">⚠️ This segment will be skipped during playback</div>' : ''}
                        `;
                        
                        createTooltip(tooltipContent);
                    }
                });

                marker.onMouseLeave$.subscribe(() => {
                    marker.style = { ...marker.style, symbolSize: segment.enabled ? 10 : 8 };
                    if (scheduleTooltipRemoval) {
                        scheduleTooltipRemoval(100); // Small delay to prevent flickering
                    }
                });

                markerLane.addMarker(marker);
            });
        };

        return () => {
            subscriptions.forEach((subscription) => subscription.unsubscribe());
            playerRef.current = null;
            isInitializingRef.current = false;
            initializedVideoSrcRef.current = "";
            // Clean up tooltips if available
            if (removeTooltip) {
                removeTooltip();
            }
        };
    }, [videoSrc, containerRef, markerLaneRef, playerId, timelineId]);

    useEffect(() => {
        const cleanup = initializePlayer();
        return cleanup;
    }, [videoSrc]); // Reinitialize when video source changes

    // Get enabled segments within trim bounds
    const getEnabledSegments = useCallback(() => {
        const effectiveTrimStart = trimStart ?? 0;
        const effectiveTrimEnd = trimEnd ?? duration;
        
        if (!segments || segments.length === 0) {
            // If no segments, return the full trimmed range as a single segment
            if (effectiveTrimEnd > effectiveTrimStart) {
                return [{
                    id: 'full-video',
                    startTime: effectiveTrimStart,
                    endTime: effectiveTrimEnd,
                    duration: effectiveTrimEnd - effectiveTrimStart,
                    order: 0,
                    enabled: true,
                    name: 'Full Video'
                }];
            }
            return [];
        }

        // Filter enabled segments and apply trim bounds
        return segments
            .filter(segment => segment.enabled)
            .map(segment => {
                // Calculate intersection of segment with trim bounds
                const start = Math.max(segment.startTime, effectiveTrimStart);
                const end = Math.min(segment.endTime, effectiveTrimEnd);
                return {
                    ...segment,
                    startTime: start,
                    endTime: end,
                    duration: end - start
                };
            })
            .filter(segment => segment.duration > 0.1) // Minimum 100ms segment
            .sort((a, b) => a.startTime - b.startTime);
    }, [segments, trimStart, trimEnd, duration]);

    // Handle segment-based playback
    const handleSegmentPlayback = useCallback(() => {
        if (!playerRef.current?.video || !isPlayingSegments) return;

        const enabledSegments = getEnabledSegments();
        if (enabledSegments.length === 0) {
            // No enabled segments, pause playback
            playerRef.current.video.pause();
            setIsPlayingSegments(false);
            return;
        }

        const currentSegment = enabledSegments[currentSegmentIndex];
        if (!currentSegment) {
            // Invalid segment index, stop playback
            playerRef.current.video.pause();
            setIsPlayingSegments(false);
            setCurrentSegmentIndex(0);
            return;
        }

        // Check if we've reached the end of the current segment (with small buffer for precision)
        const segmentEndBuffer = 0.05; // 50ms buffer for better precision
        if (currentTime >= currentSegment.endTime - segmentEndBuffer) {
            
            // Move to next segment
            const nextIndex = currentSegmentIndex + 1;
            if (nextIndex < enabledSegments.length) {
                const nextSegment = enabledSegments[nextIndex];
                setCurrentSegmentIndex(nextIndex);
                
                // Check if there's a gap between segments
                const gap = nextSegment.startTime - currentSegment.endTime;
                if (gap > 0.1) {
                    // There's a gap, seek to next segment start
                    playerRef.current.video.seekToTime(nextSegment.startTime);
                }
                // If no significant gap, let playback continue naturally
            } else {
                // End of all segments, stop playback
                playerRef.current.video.pause();
                setIsPlayingSegments(false);
                setCurrentSegmentIndex(0);
                // Seek to start of first segment for next play
                playerRef.current.video.seekToTime(enabledSegments[0].startTime);
            }
        }
    }, [currentTime, currentSegmentIndex, isPlayingSegments, getEnabledSegments]);

    // Monitor playback and handle segment transitions
    useEffect(() => {
        if (isPlayingSegments) {
            handleSegmentPlayback();
        }
    }, [currentTime, isPlayingSegments, handleSegmentPlayback]);

    // Additional safety check: pause if playing outside enabled segments
    useEffect(() => {
        if (!playerRef.current?.video || !isPlayingSegments) return;

        const enabledSegments = getEnabledSegments();
        if (enabledSegments.length === 0) return;

        // Check if current time is within any enabled segment (with small buffer)
        const buffer = 0.05; // 50ms buffer for precision issues
        const isInEnabledSegment = enabledSegments.some(segment => 
            currentTime >= (segment.startTime - buffer) && currentTime <= (segment.endTime + buffer)
        );

        if (!isInEnabledSegment && isPlayingSegments) {
            playerRef.current.video.pause();
            setIsPlayingSegments(false);
            
            // Find the segment that should contain this time or the next one
            let targetSegment = enabledSegments.find(segment => 
                currentTime >= segment.startTime && currentTime <= segment.endTime
            );
            
            if (!targetSegment) {
                // Find the next segment after current time
                targetSegment = enabledSegments.find(segment => segment.startTime > currentTime);
                
                // If no segment after current time, use the first segment
                if (!targetSegment) {
                    targetSegment = enabledSegments[0];
                }
            }
            
            if (targetSegment) {
                const targetIndex = enabledSegments.indexOf(targetSegment);
                setCurrentSegmentIndex(targetIndex);
                playerRef.current.video.seekToTime(targetSegment.startTime);
            }
        }
    }, [currentTime, isPlayingSegments, getEnabledSegments]);

    // Update markers when segments change
    useEffect(() => {
        if (markerLaneRef.current && playerRef.current?.timeline) {
            // Clear existing markers (remove all markers)
            const existingMarkers = markerLaneRef.current.getMarkers();
            existingMarkers.forEach(marker => {
                markerLaneRef.current?.removeMarker(marker.id);
            });
            
            // Recreate markers with updated segment states
            if (segments.length > 0) {
                segments.forEach((segment: VideoSegment, index: number) => {
                    const segmentColor = segment.enabled ? getSegmentColor(index) : "#666666";
                    const marker = new PeriodMarker({
                        timeObservation: { start: segment.startTime, end: segment.endTime },
                        editable: false,
                        style: {
                            color: segmentColor,
                            symbolSize: segment.enabled ? 10 : 8,
                            symbolType: "circle",
                        },
                    });

                    // Click to seek to segment start (only if enabled)
                    marker.onClick$.subscribe(() => {
                        if (playerRef.current?.video && segment.enabled) {
                            playerRef.current.video.seekToTime(segment.startTime);
                        }
                    });

                    // Hover effects
                    marker.onMouseEnter$.subscribe(() => {
                        marker.style = { ...marker.style, symbolSize: segment.enabled ? 12 : 10 };
                    });

                    marker.onMouseLeave$.subscribe(() => {
                        marker.style = { ...marker.style, symbolSize: segment.enabled ? 10 : 8 };
                    });

                    markerLaneRef.current?.addMarker(marker);
                });
            }
        }
    }, [segments]);

    // Cleanup effect for playback timeout
    useEffect(() => {
        return () => {
            if (playbackTimeoutRef.current) {
                clearTimeout(playbackTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        // Select the timeline container element.
        if (!timelineId) return;
        const timelineContainer = document.getElementById(timelineId);
        if (!timelineContainer) return;

        const resizeObserver = new ResizeObserver(() => {
            // When the timeline container's size changes, settle the layout.
            if (playerRef.current?.timeline) {
                playerRef.current.timeline.settleLayout();
            }
        });
        resizeObserver.observe(timelineContainer);

        return () => {
            resizeObserver.disconnect();
        };
    }, [timelineId]);

    const play = useCallback(() => {
        if (!playerRef.current?.video) return;

        const enabledSegments = getEnabledSegments();
        
        if (enabledSegments.length === 0) {
            console.warn('No enabled segments to play');
            return;
        }

        // Check if current time is at or beyond the end of the last enabled segment
        const lastSegment = enabledSegments[enabledSegments.length - 1];
        const isAtEnd = currentTime >= lastSegment.endTime - 0.1; // Small buffer for precision
        
        // Find which segment contains the current time
        let segmentIndex = 0;
        const currentSegment = enabledSegments.find((segment, index) => {
            if (currentTime >= segment.startTime && currentTime < segment.endTime) {
                segmentIndex = index;
                return true;
            }
            return false;
        });

        if (!currentSegment || isAtEnd) {
            // Current time is not in any enabled segment or we're at the end, start from the first segment
            segmentIndex = 0;
            const startTime = enabledSegments[0].startTime;
            playerRef.current.video.seekToTime(startTime);
            // Wait a bit for seek to complete before starting playback
            setTimeout(() => {
                if (playerRef.current?.video) {
                    setCurrentSegmentIndex(segmentIndex);
                    setIsPlayingSegments(true);
                    playerRef.current.video.play();
                }
            }, 100);
        } else {
            setCurrentSegmentIndex(segmentIndex);
            setIsPlayingSegments(true);
            playerRef.current.video.play();
        }
    }, [getEnabledSegments, currentTime]);



    const pause = useCallback(() => {
        setIsPlayingSegments(false);
        playerRef.current?.video.pause();
    }, []);

    const seek = useCallback((time: number) => {
        if (!playerRef.current?.video) return;

        const enabledSegments = getEnabledSegments();
        
        if (enabledSegments.length === 0) {
            console.warn('No enabled segments available for seeking');
            return;
        }
        
        // Check if the seek time is within an enabled segment
        const targetSegment = enabledSegments.find((segment, index) => {
            if (time >= segment.startTime && time <= segment.endTime) {
                setCurrentSegmentIndex(index);
                return true;
            }
            return false;
        });

        if (targetSegment) {
            // Seek time is within an enabled segment
            playerRef.current.video.seekToTime(time);
        } else {
            // Seek time is not in an enabled segment, find the nearest enabled segment
            let nearestSegment = enabledSegments[0];
            let nearestIndex = 0;
            let minDistance = Infinity;

            enabledSegments.forEach((segment, index) => {
                // Calculate distance to segment (prefer start of segment for better UX)
                let distance;
                if (time < segment.startTime) {
                    distance = segment.startTime - time;
                } else if (time > segment.endTime) {
                    distance = time - segment.endTime;
                } else {
                    distance = 0; // Should not happen as we already checked above
                }

                if (distance < minDistance) {
                    minDistance = distance;
                    nearestSegment = segment;
                    nearestIndex = index;
                }
            });

            // Seek to the start of the nearest enabled segment
            setCurrentSegmentIndex(nearestIndex);
            const seekTime = nearestSegment.startTime;
            playerRef.current.video.seekToTime(seekTime);
        }
    }, [getEnabledSegments]);

    const setVolume = useCallback((volume: number) => {
        const newVolume = volume / 100;
        playerRef.current?.video.setVolume(newVolume);
        setPlayerVolume(newVolume);
    }, []);

    const mute = useCallback(() => {
        playerRef.current?.video.mute();
    }, []);

    const unmute = useCallback(() => {
        playerRef.current?.video.unmute();
    }, []);

    const setPlaybackRate = useCallback((rate: number) => {
        playerRef.current?.video.setPlaybackRate(rate);
    }, []);

    const toggleFullscreen = useCallback(() => {
        playerRef.current?.video.toggleFullscreen();
    }, []);

    const handleSeekCommitted = useCallback((value: number) => {
        // Use our custom seek function that respects enabled segments
        seek(value);
        // Stop segment playback temporarily during seek to prevent conflicts
        setIsPlayingSegments(false);
        // Small delay to prevent immediate time updates from overriding the seek
        setTimeout(() => {
            // Resume segment playback if we were playing before seek
            // Note: We'll rely on the play button state instead of checking video API
            // since the Omakase VideoApi doesn't expose a paused property
        }, 150);
    }, [seek]);

    return {
        play,
        pause,
        seek,
        handleSeekCommitted,
        setVolume,
        mute,
        unmute,
        setPlaybackRate,
        toggleFullscreen,
        currentTime,
        duration,
        setCurrentTime,
        playerRef,
    };
};

export const OmakaseVideoPlayer = forwardRef<OmakaseVideoPlayerRef, OmakaseVideoPlayerProps>(
    (
        {
            videoSrc,
            onPlay,
            onPause,
            onSeek,
            onTimeUpdate,
            onDurationChange,
            onError,
            showTimeline = true,
            showThumbnails = false,
            segments,
            trimStart,
            trimEnd,
        },
        ref,
    ) => {
        const playerContainerRef = useRef<HTMLDivElement | null>(null);
        const markerLaneRef = useRef<MarkerLane | null>(null);
        
        // Tooltip management at component level
        const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
        const globalMouseRef = useRef({ x: 0, y: 0 });

        // Global mouse position tracking
        useEffect(() => {
            const updateMousePosition = (e: MouseEvent) => {
                globalMouseRef.current = { x: e.clientX, y: e.clientY };
            };

            document.addEventListener("mousemove", updateMousePosition);
            return () => {
                document.removeEventListener("mousemove", updateMousePosition);
                if (tooltipTimeoutRef.current) {
                    clearTimeout(tooltipTimeoutRef.current);
                }
            };
        }, []);

        // Tooltip functions at component level
        const createTooltip = useCallback((content: string, mouseX?: number, mouseY?: number) => {
            // Clear any existing timeout
            if (tooltipTimeoutRef.current) {
                clearTimeout(tooltipTimeoutRef.current);
                tooltipTimeoutRef.current = null;
            }

            // Remove existing tooltip
            const existingTooltip = document.getElementById("omakase-marker-tooltip");
            if (existingTooltip) {
                existingTooltip.remove();
            }

            const tooltip = document.createElement("div");
            tooltip.id = "omakase-marker-tooltip";
            tooltip.innerHTML = content;

            // Use provided mouse position or current position
            const currentMouseX = mouseX !== undefined ? mouseX : globalMouseRef.current.x;
            const currentMouseY = mouseY !== undefined ? mouseY : globalMouseRef.current.y;

            // Calculate position to avoid screen edges
            const tooltipWidth = 350;
            const tooltipHeight = 120;
            const margin = 15;

            let left = currentMouseX + margin;
            let top = currentMouseY - tooltipHeight - margin;

            // Adjust if tooltip would go off screen
            if (left + tooltipWidth > window.innerWidth) {
                left = currentMouseX - tooltipWidth - margin;
            }
            if (top < 0) {
                top = currentMouseY + margin;
            }
            if (left < margin) {
                left = margin;
            }

            tooltip.style.cssText = `
                position: fixed;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
                color: #f8fafc;
                padding: 12px 16px;
                border-radius: 12px;
                font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;
                font-weight: 500;
                line-height: 1.5;
                z-index: 10000;
                pointer-events: none;
                box-shadow: 
                    0 20px 25px -5px rgba(0, 0, 0, 0.4),
                    0 10px 10px -5px rgba(0, 0, 0, 0.2),
                    0 0 0 1px rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(148, 163, 184, 0.2);
                max-width: ${tooltipWidth}px;
                min-width: 200px;
                word-wrap: break-word;
                left: ${left}px;
                top: ${top}px;
                opacity: 0;
                transform: translateY(8px) scale(0.95);
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
            `;

            document.body.appendChild(tooltip);

            // Animate in
            requestAnimationFrame(() => {
                tooltip.style.opacity = "1";
                tooltip.style.transform = "translateY(0) scale(1)";
            });
        }, []);

        const removeTooltip = useCallback(() => {
            if (tooltipTimeoutRef.current) {
                clearTimeout(tooltipTimeoutRef.current);
                tooltipTimeoutRef.current = null;
            }

            const tooltip = document.getElementById("omakase-marker-tooltip");
            if (tooltip) {
                tooltip.style.opacity = "0";
                tooltip.style.transform = "translateY(-8px) scale(0.95)";
                setTimeout(() => {
                    if (tooltip.parentNode) {
                        tooltip.remove();
                    }
                }, 200);
            }
        }, []);

        const scheduleTooltipRemoval = useCallback((delay: number = 300) => {
            if (tooltipTimeoutRef.current) {
                clearTimeout(tooltipTimeoutRef.current);
            }
            tooltipTimeoutRef.current = setTimeout(removeTooltip, delay);
        }, [removeTooltip]);



        // Generate unique IDs for this player instance
        const playerId = useMemo(
            () => `omakase-player-${Math.random().toString(36).substr(2, 9)}`,
            [],
        );
        const timelineId = useMemo(
            () => `omakase-timeline-${Math.random().toString(36).substr(2, 9)}`,
            [],
        );

        const [isPlaying, setIsPlaying] = useState(false);
        const [volume, setVolumeState] = useState(100);
        const [muted, setMuted] = useState(false);
        const [isSmtpeFormat, setIsSmtpeFormat] = useState(true);
        const [isVolumeVisible, setIsVolumeVisible] = useState(false);
        const [isPlayerHovered, setIsPlayerHovered] = useState(false);
        const [controlsTimeout, setControlsTimeout] = useState<NodeJS.Timeout | null>(null);
        const [isDraggingSlider, setIsDraggingSlider] = useState(false);
        const isDraggingRef = useRef(false);
        const customCallbacks = useMemo<Partial<OmakaseVideoPlayerProps>>(
            () => ({
                onPlay: () => {
                    setIsPlaying(true);
                    onPlay?.();
                },
                onPause: () => {
                    setIsPlaying(false);
                    onPause?.();
                },
                onSeek,
                onError,
                onTimeUpdate: (time: number) => {
                    onTimeUpdate?.(time);
                },
                onDurationChange,
            }),
            [onPlay, onPause, onSeek, onError, onTimeUpdate, onDurationChange],
        );

        const {
            play,
            pause,
            seek,
            handleSeekCommitted,
            setVolume: setPlayerVolume,
            mute,
            unmute,
            toggleFullscreen,
            currentTime,
            duration,
            setCurrentTime,
        } = useOmakasePlayer(
            videoSrc,
            playerContainerRef,
            customCallbacks,
            markerLaneRef,
            playerId,
            timelineId,
            showTimeline,
            segments,
            showThumbnails,
            trimStart,
            trimEnd,
            { createTooltip, removeTooltip, scheduleTooltipRemoval }
        );

        // Expose player control methods via ref
        useImperativeHandle(
            ref,
            () => ({
                getCurrentTime: () => currentTime,
                getDuration: () => duration,
                formatToTimecode: (time: number) => {
                    const hours = Math.floor(time / 3600);
                    const minutes = Math.floor((time % 3600) / 60);
                    const seconds = Math.floor(time % 60);
                    const frames = Math.floor((time % 1) * 25); // 25fps for better compatibility
                    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
                },
                seekToTime: (time: number) => seek(time),
                play: () => play(),
                pause: () => pause(),
                isPlaying: () => isPlaying,
            }),
            [currentTime, duration, play, pause, isPlaying],
        );

        const handlePlayPause = () => {
            if (isPlaying) {
                pause();
            } else {
                play();
            }
        };

        const handleSeekChange = (value: number) => {
            setIsDraggingSlider(true);
            isDraggingRef.current = true;
            setCurrentTime(value);
        };



        // const handleSeekCommitted = ({ detail }: any) => {
        //     if (typeof detail.value === "number") {
        //         seek(detail.value);
        //     }
        // };

        const handleVolumeChange = (value: number) => {
            setPlayerVolume(value);
            setVolumeState(value);
            setMuted(value === 0);
        };

        const handleMuteToggle = () => {
            if (muted) {
                unmute();
                setPlayerVolume(volume);
                setMuted(false);
                // Unmuted
            } else {
                mute();
                setPlayerVolume(0);
                setMuted(true);
                // Muted
            }
        };

        const handleFullscreenToggle = () => {
            toggleFullscreen();
        };

        const formatTime = (time: number): string => {
            const hours = Math.floor(time / 3600);
            const minutes = Math.floor((time % 3600) / 60);
            const seconds = Math.floor(time % 60);
            if (isSmtpeFormat) {
                const frames = Math.floor((time % 1) * 25);
                return `${hours.toString().padStart(2, "0")}:${minutes
                    .toString()
                    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames
                    .toString()
                    .padStart(2, "0")}`;
            } else {
                return `${hours.toString().padStart(2, "0")}:${minutes
                    .toString()
                    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
            }
        };

        const handleTimeFormatToggle = () => {
            setIsSmtpeFormat(!isSmtpeFormat);
        };

        const handlePlayerMouseEnter = () => {
            if (controlsTimeout) {
                clearTimeout(controlsTimeout);
                setControlsTimeout(null);
            }
            setIsPlayerHovered(true);
        };

        const handlePlayerMouseLeave = () => {
            const timeout = setTimeout(() => {
                setIsPlayerHovered(false);
            }, 1000); // Hide controls after 1 second
            setControlsTimeout(timeout);
        };

        const handlePlayerMouseMove = () => {
            if (controlsTimeout) {
                clearTimeout(controlsTimeout);
            }
            setIsPlayerHovered(true);
            const timeout = setTimeout(() => {
                setIsPlayerHovered(false);
            }, 2000); // Hide controls after 2 seconds of no movement
            setControlsTimeout(timeout);
        };

        const handleControlsMouseEnter = () => {
            if (controlsTimeout) {
                clearTimeout(controlsTimeout);
                setControlsTimeout(null);
            }
            setIsPlayerHovered(true);
        };

        const handleControlsMouseLeave = () => {
            const timeout = setTimeout(() => {
                setIsPlayerHovered(false);
            }, 500); // Quick hide when leaving controls
            setControlsTimeout(timeout);
        };

        // Cleanup timeout on unmount
        useEffect(() => {
            return () => {
                if (controlsTimeout) {
                    clearTimeout(controlsTimeout);
                }
            };
        }, [controlsTimeout]);

        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    width: "100%",
                    height: "70vh",
                    maxHeight: "800px",
                    position: "relative",
                    overflow: "hidden",
                    // borderRadius: "12px",
                    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                    background: "#000",
                }}
                onMouseEnter={handlePlayerMouseEnter}
                onMouseLeave={handlePlayerMouseLeave}
                onMouseMove={handlePlayerMouseMove}
            >
                {/* Video Player */}
                <div
                    ref={playerContainerRef}
                    id="omakase-player"
                    style={{ flex: 1, position: "relative" }}
                />

                {/* Overlay Controls */}
                <div
                    style={{
                        position: "absolute",
                        bottom: 80,
                        left: 0,
                        right: 0,
                        background:
                            "linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.8) 100%)",
                        color: "#fff",
                        padding: "10px 32px 20px 32px",
                        backdropFilter: "blur(20px)",
                        opacity: isPlayerHovered ? 1 : 0,
                        transform: isPlayerHovered ? "translateY(0)" : "translateY(20px)",
                        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                        pointerEvents: "auto", // Always allow pointer events
                        zIndex: 1,
                    }}
                    onMouseEnter={handleControlsMouseEnter}
                    onMouseLeave={handleControlsMouseLeave}
                >
                    {/* Timeline Slider */}
                    <div style={{ marginBottom: 4 }}>
                        <CustomSlider
                            value={isDraggingSlider ? currentTime : Math.max(trimStart || 0, Math.min(currentTime, trimEnd || duration))}
                            min={trimStart || 0}
                            max={trimEnd || duration || 1}
                            step={0.1}
                            onChange={handleSeekChange}
                            onChangeCommitted={handleSeekCommitted}
                            ariaLabel="Video timeline"
                            variant="timeline"
                            showTooltip={true}
                            tooltipFormatter={formatTime}
                            bufferedPercentage={Math.min(
                                ((currentTime + 30) / (duration || 1)) * 100,
                                100,
                            )}
                        />
                    </div>
                    {/* Control Buttons */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "16px",
                            zIndex: 1000,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <div
                                style={{
                                    background: isPlaying
                                        ? "rgba(255, 107, 107, 0.1)"
                                        : "rgba(76, 175, 80, 0.1)",
                                    borderRadius: segments?.length > 1 ? 12 : "50%",
                                    padding: "8px",
                                    border: `2px solid ${isPlaying ? "rgba(255, 107, 107, 0.3)" : "rgba(76, 175, 80, 0.3)"}`,
                                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                                onClick={handlePlayPause}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = "scale(1.1)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = "scale(1)";
                                }}
                                title={isPlaying ? "Pause video" : "Play video"}
                            >
                                {segments?.length > 1 && <span style={{ fontSize: 16, marginRight: 12}}>Preview</span>}
                                {isPlaying ? (
                                    <Pause size={20} color="#fff" />
                                ) : (
                                    <Play size={20} color="#fff" />
                                )}
                            </div>
                            <div
                                onClick={handleTimeFormatToggle}
                                style={{
                                    color: "#D5DBDB",
                                    minWidth: "140px",
                                    userSelect: "none",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    fontWeight: "500",
                                    fontFamily: "monospace",
                                    transition: "color 0.2s ease",
                                    padding: "4px 8px",
                                    borderRadius: "4px",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.color = "#FFFFFF";
                                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.color = "#D5DBDB";
                                    e.currentTarget.style.background = "transparent";
                                }}
                                title="Click to toggle time format"
                            >
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </div>
                        </div>

                        <div style={{ flexGrow: 1 }} />

                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                background: isVolumeVisible
                                    ? "rgba(255, 255, 255, 0.1)"
                                    : "rgba(255, 255, 255, 0.05)",
                                padding: "4px 16px",
                                borderRadius: "24px",
                                border: `1px solid ${isVolumeVisible ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.1)"}`,
                                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                                transform: isVolumeVisible ? "translateY(-2px)" : "translateY(0)",
                                boxShadow: isVolumeVisible
                                    ? "0 8px 25px rgba(0, 115, 187, 0.2)"
                                    : "0 2px 8px rgba(0, 0, 0, 0.1)",
                            }}
                            onMouseEnter={() => {
                                setIsVolumeVisible(true);
                            }}
                            onMouseLeave={() => {
                                setIsVolumeVisible(false);
                            }}
                        >
                            <div
                                onClick={handleMuteToggle}
                                style={{
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "4px",
                                    borderRadius: "50%",
                                    transition: "background-color 0.2s ease",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor =
                                        "rgba(255, 255, 255, 0.1)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "transparent";
                                }}
                                title={muted ? "Unmute" : "Mute"}
                            >
                                {muted || volume === 0 ? (
                                    <VolumeOff size={20} color="#D5DBDB" />
                                ) : (
                                    <Volume2 size={20} color="#D5DBDB" />
                                )}
                            </div>
                            <div style={{ width: "120px" }}>
                                <CustomSlider
                                    value={volume}
                                    min={0}
                                    max={100}
                                    step={1}
                                    onChange={handleVolumeChange}
                                    ariaLabel="Volume control"
                                    variant="volume"
                                    showTooltip={isVolumeVisible}
                                    tooltipFormatter={(value) => `Volume: ${Math.round(value)}%`}
                                />
                            </div>
                        </div>

                        <div
                            style={{
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                padding: "8px",
                                borderRadius: "50%",
                                transition: "all 0.2s ease",
                                border: "1px solid rgba(255, 255, 255, 0.2)",
                            }}
                            onClick={handleFullscreenToggle}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
                                e.currentTarget.style.transform = "scale(1.1)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "transparent";
                                e.currentTarget.style.transform = "scale(1)";
                            }}
                            title="Toggle fullscreen"
                        >
                            <Maximize size={20} color="#fff" />
                        </div>
                    </div>
                </div>

                {/* Modern Timeline Container */}
                {showTimeline && (
                    <div
                        id={timelineId}
                        style={{
                            zIndex: 2,
                            minHeight: "90px",
                            paddingTop: "10px",
                            position: "relative",
                        }}
                    />
                )}
            </div>
        );
    },
);

OmakaseVideoPlayer.displayName = "OmakaseVideoPlayer";
export default OmakaseVideoPlayer;
