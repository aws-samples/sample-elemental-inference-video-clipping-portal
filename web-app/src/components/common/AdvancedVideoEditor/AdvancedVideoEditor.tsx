import { Button } from "@cloudscape-design/components";
import { Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, } from "react";
import VideoService from "../../../services/videoService";
import { VideoEditOperation, VideoSegment } from "../../../types";
import "./AdvancedVideoEditor.css";
import OmakaseVideoPlayer, { OmakaseVideoPlayerRef } from "../OmakasePlayer/OmakasePlayer.tsx";

export interface AdvancedVideoEditorProps {
    clipId: string | undefined;
    videoSrc: string | undefined;
    operations?: VideoEditOperation[];
    onOperationsChange?: (operations: VideoEditOperation[]) => void;
    disabled?: boolean;
    initialTrimStart?: number;
    initialTrimEnd?: number;
    onTrimChange?: (startTime: number, endTime: number) => void;
    onSegmentsChange?: (segments: VideoSegment[]) => void;
}

export interface AdvancedVideoEditorRef {
    getCurrentOperations: () => VideoEditOperation[];
    setOperations: (operations: VideoEditOperation[]) => void;
    addSplitPoint: (time: number) => void;
    clearOperations: () => void;
    getCurrentTrim: () => { startTime: number; endTime: number };
    setTrimPoints: (startTime: number, endTime: number) => void;
    addTrimOperation: (startTime: number, endTime: number) => void;
    getCurrentSegments: () => VideoSegment[];
    toggleSegmentEnabled: (segmentId: string) => void;
    reorderSegments: (segments: VideoSegment[]) => void;
    undoLastSplit: () => void;
    canUndo: () => boolean;
    redoLastSplit: () => void;
    canRedo: () => boolean;
}

export const AdvancedVideoEditor = forwardRef<AdvancedVideoEditorRef, AdvancedVideoEditorProps>(
    (
        {
            videoSrc,
            operations = [],
            onOperationsChange,
            disabled = false,
            initialTrimStart = 0,
            initialTrimEnd,
            onTrimChange,
            onSegmentsChange,
        },
        ref,
    ) => {
        // Note: initialTrimStart and initialTrimEnd are ignored for clip editing
        // Clips are treated as standalone videos starting from 0
        const videoRef = useRef<HTMLVideoElement>(null);
        const trimTimelineRef = useRef<HTMLDivElement>(null);
        const splitTimelineRef = useRef<HTMLDivElement>(null);

        // Video state
        const [isPlaying, setIsPlaying] = useState(false);
        const [currentTime, setCurrentTime] = useState(0);
        const [duration, setDuration] = useState(0);
        const [signedVideoUrl, setSignedVideoUrl] = useState<string | undefined>(undefined);
        const [videoLoadError, setVideoLoadError] = useState<string | null>(null);
        const [isVideoLoading, setIsVideoLoading] = useState(false);

        // Editing state
        const [localOperations, setLocalOperations] = useState<VideoEditOperation[]>(operations);
        const [isHovered, setIsHovered] = useState(false);
        const [previewTime, setPreviewTime] = useState<number | null>(null);

        // Segments state
        const [segments, setSegments] = useState<VideoSegment[]>([]);

        // Undo/Redo state
        const [undoStack, setUndoStack] = useState<VideoEditOperation[]>([]);

        // Trim state - initialize to show full video range, trim boundaries will be set when video loads
        const [trimStart, setTrimStart] = useState<number>(0);
        const [trimEnd, setTrimEnd] = useState<number>(0);
        const [isDraggingTrim, setIsDraggingTrim] = useState<"start" | "end" | null>(null);
        const playerRef = useRef<OmakaseVideoPlayerRef>(null);

        // Sync state between Omakase player and custom timelines
        const [omakaseCurrentTime, setOmakaseCurrentTime] = useState(0);
        const [omakaseDuration, setOmakaseDuration] = useState(0);
        const [isOmakasePlaying, setIsOmakasePlaying] = useState(false);

        // Update local operations when props change
        useEffect(() => {
            setLocalOperations(operations);

            // Sync trim state with existing trim operations
            const existingTrimOp = operations.find((op) => op.type === "trim" && op.enabled);
            if (existingTrimOp && duration > 0) {
                setTrimStart(existingTrimOp.startTime);
                setTrimEnd(existingTrimOp.endTime);
            }
        }, [operations, duration]);

        // Sync duration from Omakase player (but don't duplicate trim point initialization)
        useEffect(() => {
            if (omakaseDuration > 0 && omakaseDuration !== duration) {
                setDuration(omakaseDuration);
            }
        }, [omakaseDuration, duration]);

        // Sync current time from Omakase player (but don't override when user is interacting with custom timelines)
        useEffect(() => {
            if (!isDraggingTrim && Math.abs(omakaseCurrentTime - currentTime) > 0.1) {
                setCurrentTime(omakaseCurrentTime);
            }
        }, [omakaseCurrentTime, currentTime, isDraggingTrim]);

        // Generate signed URL when videoSrc changes
        useEffect(() => {
            const generateSignedUrl = async () => {
                if (!videoSrc) {
                    setSignedVideoUrl(undefined);
                    setVideoLoadError(null);
                    setIsVideoLoading(false);
                    return;
                }

                try {
                    setIsVideoLoading(true);
                    setVideoLoadError(null);

                    // Determine HLS path based on videoSrc format
                    let hlsPath: string;
                    if (videoSrc.endsWith(".m3u8")) {
                        // Modified clips: videoSrc already includes the playlist path
                        hlsPath = videoSrc;
                    } else {
                        // Original clips: videoSrc is just the path, append main.m3u8
                        hlsPath = `${videoSrc}main.m3u8`;
                    }

                    const videoService = VideoService.getInstance();
                    const signedUrl = await videoService.getVideoUrl(hlsPath);

                    setSignedVideoUrl(signedUrl);
                    setIsVideoLoading(false);
                } catch (error) {
                    console.error("AdvancedVideoEditor: Failed to generate signed URL:", error);
                    setVideoLoadError(
                        error instanceof Error
                            ? error.message
                            : "Failed to load video for Omakase player",
                    );
                    setSignedVideoUrl(undefined);
                    setIsVideoLoading(false);
                }
            };

            generateSignedUrl().then();
        }, [videoSrc]);

        // No fallback duration - only use actual video duration
        useEffect(() => {
            if (videoSrc && duration === 0) {
                const timer = setTimeout(() => {
                    if (duration === 0) {
                        console.error("Video failed to load - no duration available");
                        console.error(
                            "Video editing features will be disabled until video loads properly",
                        );
                        // Don't set any fallback duration - keep it at 0
                    }
                }, 5000); // Wait 5 seconds to confirm video load failure

                return () => clearTimeout(timer);
            }
        }, [videoSrc, duration]);

        // Notify parent of changes
        useEffect(() => {
            onOperationsChange?.(localOperations);
        }, [localOperations, onOperationsChange]);

        // Generate segments from split operations
        useEffect(() => {
            if (duration > 0) {
                const newSegments = generateSegmentsFromSplits();
                setSegments(newSegments);
                // Don't call onSegmentsChange here to prevent loops
                // The parent will get segments via ref methods when needed
            }
        }, [localOperations, duration, trimStart, trimEnd]);

        // Validate and clamp trim points to video duration (only if video is loaded)
        const validateTrimPoints = useCallback(
            (start: number, end: number) => {
                // If video hasn't loaded (duration = 0), return original values
                if (duration === 0) {
                    console.warn("Cannot validate trim points - video duration not available");
                    return { start, end };
                }

                const validStart = Math.max(0, Math.min(start, duration - 1));
                const validEnd = Math.max(validStart + 1, Math.min(end, duration));

                if (start !== validStart || end !== validEnd) {
                    console.warn("Trim points adjusted to fit video duration", {
                        original: { start, end },
                        adjusted: { start: validStart, end: validEnd },
                        videoDuration: duration,
                    });
                }

                return { start: validStart, end: validEnd };
            },
            [duration],
        );

        // Get effective timeline boundaries (considering trim)
        const getEffectiveTimelineBounds = () => {
            // Check if there are existing trim operations that should be considered
            const existingTrimOp = localOperations.find((op) => op.type === "trim" && op.enabled);

            let effectiveStart = trimStart;
            let effectiveEnd = trimEnd;

            // If there's an existing trim operation, use its bounds as the base
            if (existingTrimOp) {
                effectiveStart = Math.max(effectiveStart, existingTrimOp.startTime);
                effectiveEnd = Math.min(effectiveEnd, existingTrimOp.endTime);
            }

            const validated = validateTrimPoints(effectiveStart, effectiveEnd);
            return { start: validated.start, end: validated.end };
        };

        // Generate segments from split points (only within trimmed area)
        const generateSegmentsFromSplits = (): VideoSegment[] => {
            const splitOps = localOperations.filter((op) => op.type === "split" && op.enabled);
            const { start: effectiveStart, end: effectiveEnd } = getEffectiveTimelineBounds();

            // Filter split points to only those within the trimmed area
            const splitPoints = splitOps
                .map((op) => op.startTime)
                .filter((time) => time > effectiveStart && time < effectiveEnd)
                .sort((a, b) => a - b);

            // If no splits, return single segment for the entire trimmed area
            if (splitPoints.length === 0) {
                return [
                    {
                        id: `segment_full_${Math.round(effectiveStart * 1000)}_${Math.round(effectiveEnd * 1000)}`,
                        startTime: effectiveStart,
                        endTime: effectiveEnd,
                        duration: effectiveEnd - effectiveStart,
                        order: 0,
                        enabled: true,
                        name: `Full Segment`,
                        color: undefined,
                    },
                ];
            }

            // Create segments between split points
            const allPoints = [effectiveStart, ...splitPoints, effectiveEnd];
            const newSegments: VideoSegment[] = [];

            for (let i = 0; i < allPoints.length - 1; i++) {
                const startTime = allPoints[i];
                const endTime = allPoints[i + 1];
                const segmentId = `segment_${i}_${Math.round(startTime * 1000)}_${Math.round(endTime * 1000)}`;

                // Check if this segment was previously disabled
                const existingSegment = segments.find(
                    (s) => s.startTime === startTime && s.endTime === endTime,
                );

                newSegments.push({
                    id: segmentId,
                    startTime,
                    endTime,
                    duration: endTime - startTime,
                    order: i,
                    enabled: existingSegment ? existingSegment.enabled : true,
                    name: `Segment ${i + 1}`,
                    color: existingSegment ? existingSegment.color : undefined,
                });
            }

            return newSegments;
        };

        // Optimized timeline interaction handlers with caching
        const timelineRectCache = useRef<{
            element: HTMLDivElement | null;
            rect: DOMRect | null;
            timestamp: number;
        }>({ element: null, rect: null, timestamp: 0 });

        const getTimeFromPosition = useCallback(
            (clientX: number, timelineRef: React.RefObject<HTMLDivElement | null>) => {
                if (!timelineRef.current) return 0;

                const now = Date.now();
                const cache = timelineRectCache.current;

                // Cache rect for 100ms to avoid repeated getBoundingClientRect calls
                if (cache.element !== timelineRef.current || now - cache.timestamp > 100) {
                    cache.element = timelineRef.current;
                    cache.rect = timelineRef.current.getBoundingClientRect();
                    cache.timestamp = now;
                }

                if (!cache.rect) return 0;

                const percentage = Math.max(
                    0,
                    Math.min(1, (clientX - cache.rect.left) / cache.rect.width),
                );
                return percentage * duration;
            },
            [duration],
        );

        // Unified seek function - works on all timelines and syncs with Omakase player
        const handleSeek = (time: number) => {
            if (disabled) return;

            // Seek using Omakase player if available
            if (playerRef.current) {
                playerRef.current.seekToTime(time);
                setCurrentTime(time);
            } else if (videoRef.current) {
                // Fallback to HTML5 video element
                videoRef.current.currentTime = time;
                setCurrentTime(time);
            }
        };

        const handleTrimTimelineClick = (e: React.MouseEvent) => {
            if (disabled) return;
            const time = getTimeFromPosition(e.clientX, trimTimelineRef);

            // Check if clicking near a trim handle (within 20px)
            const startPos = (trimStart / duration) * (trimTimelineRef.current?.clientWidth || 0);
            const endPos = (trimEnd / duration) * (trimTimelineRef.current?.clientWidth || 0);
            const clickPos = e.nativeEvent.offsetX;

            const nearStart = Math.abs(clickPos - startPos) < 20;
            const nearEnd = Math.abs(clickPos - endPos) < 20;

            if (nearStart || nearEnd) {
                // Adjust trim points when clicking near handles
                const distanceToStart = Math.abs(time - trimStart);
                const distanceToEnd = Math.abs(time - trimEnd);

                let newTrimStart = trimStart;
                let newTrimEnd = trimEnd;

                if (distanceToStart < distanceToEnd) {
                    newTrimStart = Math.max(0, Math.min(time, trimEnd - 1));
                } else {
                    newTrimEnd = Math.max(trimStart + 1, Math.min(time, duration));
                }

                // Update state first
                setTrimStart(newTrimStart);
                setTrimEnd(newTrimEnd);

                // Then notify parent and add operation
                onTrimChange?.(newTrimStart, newTrimEnd);

                // Use a timeout to ensure state has been updated before adding operation
                setTimeout(() => {
                    addTrimOperation(newTrimStart, newTrimEnd);
                }, 0);
            } else {
                // Otherwise, just seek
                handleSeek(time);
            }
        };

        const handleSplitTimelineClick = (e: React.MouseEvent) => {
            if (disabled) return;
            const time = getTimeFromPosition(e.clientX, splitTimelineRef);
            const { start: effectiveStart, end: effectiveEnd } = getEffectiveTimelineBounds();

            // Check if clicking on the timeline background (not on a segment)
            const clickedOnTimeline =
                e.target === e.currentTarget ||
                (e.target as HTMLElement).classList.contains("timeline-track");

            if (clickedOnTimeline && time > effectiveStart && time < effectiveEnd) {
                // Add split point when clicking on empty timeline space
                addSplitPoint(time);
            } else if (clickedOnTimeline) {
                // Otherwise, just seek when clicking on empty space
                handleSeek(time);
            }
            // If clicking on a segment, let the segment handle the click (drag/drop or toggle)
        };

        // Throttled preview time updates
        const previewTimeRef = useRef<number | null>(null);
        const previewRafRef = useRef<number | null>(null);

        const handleTimelineMouseMove = (
            e: React.MouseEvent,
            timelineRef: React.RefObject<HTMLDivElement | null>,
        ) => {
            const time = getTimeFromPosition(e.clientX, timelineRef);

            // Only update if time changed significantly (avoid micro-movements)
            if (previewTimeRef.current === null || Math.abs(time - previewTimeRef.current) > 0.1) {
                previewTimeRef.current = time;

                // Cancel previous RAF
                if (previewRafRef.current) {
                    cancelAnimationFrame(previewRafRef.current);
                }

                // Schedule update for next frame
                previewRafRef.current = requestAnimationFrame(() => {
                    setPreviewTime(time);
                    previewRafRef.current = null;
                });
            }
        };

        const handleTimelineMouseLeave = () => {
            // Cancel any pending preview updates
            if (previewRafRef.current) {
                cancelAnimationFrame(previewRafRef.current);
                previewRafRef.current = null;
            }
            previewTimeRef.current = null;
            setPreviewTime(null);
        };

        // Define addTrimOperation early to avoid dependency issues
        const addTrimOperation = useCallback(
            (startTime: number, endTime: number) => {
                // Validate trim points before creating operation
                const validated = validateTrimPoints(startTime, endTime);

                // Remove any existing trim operations first
                setLocalOperations((prev) => prev.filter((op) => op.type !== "trim"));

                const newOperation: VideoEditOperation = {
                    id: `trim_${Date.now()}`,
                    type: "trim",
                    startTime: validated.start,
                    endTime: validated.end,
                    order: 0, // Trim operations should be first
                    enabled: true,
                    description: `Trim ${formatTime(validated.start)} - ${formatTime(validated.end)}`,
                };

                setLocalOperations((prev) => [
                    newOperation,
                    ...prev.map((op) => ({ ...op, order: op.order + 1 })),
                ]);
            },
            [validateTrimPoints],
        );

        // Optimized trim handle interaction with RAF
        const dragStateRef = useRef<{
            isDragging: "start" | "end" | null;
            startX: number;
            startTrimStart: number;
            startTrimEnd: number;
            rafId: number | null;
        }>({
            isDragging: null,
            startX: 0,
            startTrimStart: 0,
            startTrimEnd: 0,
            rafId: null,
        });

        const handleTrimHandleMouseDown = (type: "start" | "end", e: React.MouseEvent) => {
            if (disabled) return;
            e.stopPropagation();
            e.preventDefault();

            // Store initial state
            dragStateRef.current = {
                isDragging: type,
                startX: e.clientX,
                startTrimStart: trimStart,
                startTrimEnd: trimEnd,
                rafId: null,
            };

            setIsDraggingTrim(type);

            // Add cursor style to body for better UX
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        };

        const updateTrimPosition = useCallback(
            (clientX: number) => {
                const dragState = dragStateRef.current;
                if (!dragState.isDragging || !trimTimelineRef.current) return;

                const rect = trimTimelineRef.current.getBoundingClientRect();
                const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                const time = percentage * duration;

                let newTrimStart = trimStart;
                let newTrimEnd = trimEnd;

                if (dragState.isDragging === "start") {
                    newTrimStart = Math.max(0, Math.min(time, trimEnd - 0.1)); // Ensure minimum gap
                } else if (dragState.isDragging === "end") {
                    newTrimEnd = Math.max(trimStart + 0.1, Math.min(time, duration)); // Ensure minimum gap
                }

                // Only update if values actually changed significantly (avoid micro-updates)
                const threshold = 0.01; // 10ms threshold
                if (
                    Math.abs(newTrimStart - trimStart) > threshold ||
                    Math.abs(newTrimEnd - trimEnd) > threshold
                ) {
                    setTrimStart(newTrimStart);
                    setTrimEnd(newTrimEnd);
                    onTrimChange?.(newTrimStart, newTrimEnd);
                }
            },
            [duration, trimStart, trimEnd, onTrimChange],
        );

        const handleTrimMouseMove = useCallback(
            (e: MouseEvent) => {
                const dragState = dragStateRef.current;
                if (!dragState.isDragging || disabled) return;

                // Cancel previous RAF if exists
                if (dragState.rafId) {
                    cancelAnimationFrame(dragState.rafId);
                }

                // Schedule update for next frame
                dragState.rafId = requestAnimationFrame(() => {
                    updateTrimPosition(e.clientX);
                    dragState.rafId = null;
                });
            },
            [updateTrimPosition, disabled],
        );

        const handleTrimMouseUp = useCallback(() => {
            const dragState = dragStateRef.current;
            if (!dragState.isDragging) return;

            // Cancel any pending RAF
            if (dragState.rafId) {
                cancelAnimationFrame(dragState.rafId);
                dragState.rafId = null;
            }

            // Get the current trim values at the time of mouse up
            // This ensures we capture the final state after all drag updates
            const finalTrimStart = trimStart;
            const finalTrimEnd = trimEnd;

            // Add trim operation when dragging finishes with final values
            addTrimOperation(finalTrimStart, finalTrimEnd);

            // Reset drag state
            dragStateRef.current.isDragging = null;
            setIsDraggingTrim(null);

            // Restore cursor
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }, [trimStart, trimEnd, addTrimOperation]);

        // Add trim mouse event listeners with passive option for better performance
        useEffect(() => {
            if (isDraggingTrim) {
                document.addEventListener("mousemove", handleTrimMouseMove, { passive: true });
                document.addEventListener("mouseup", handleTrimMouseUp);

                return () => {
                    document.removeEventListener("mousemove", handleTrimMouseMove);
                    document.removeEventListener("mouseup", handleTrimMouseUp);

                    // Cleanup on unmount
                    const dragState = dragStateRef.current;
                    if (dragState.rafId) {
                        cancelAnimationFrame(dragState.rafId);
                    }
                    document.body.style.cursor = "";
                    document.body.style.userSelect = "";
                };
            }
        }, [isDraggingTrim, handleTrimMouseMove, handleTrimMouseUp]);

        // Cleanup effect for RAF calls on unmount
        useEffect(() => {
            return () => {
                // Cleanup all RAF calls
                if (dragStateRef.current.rafId) {
                    cancelAnimationFrame(dragStateRef.current.rafId);
                }
                if (previewRafRef.current) {
                    cancelAnimationFrame(previewRafRef.current);
                }

                // Reset body styles
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            };
        }, []);

        // Operation management functions
        const addSplitPoint = (time: number) => {
            const newOperation: VideoEditOperation = {
                id: `split_${Date.now()}`,
                type: "split",
                startTime: time,
                endTime: time, // For split, start and end are the same
                order: localOperations.length,
                enabled: true,
                description: `Split at ${formatTime(time)}`,
            };

            // Clear undo stack when adding new operations (invalidates redo history)
            setUndoStack([]);
            setLocalOperations((prev) => {
                const updated = [...prev, newOperation];
                return updated;
            });
        };

        const undoLastSplit = () => {
            setLocalOperations((prev) => {
                // Find the most recent split operation
                const splitOperations = prev.filter((op) => op.type === "split");
                if (splitOperations.length === 0) return prev;

                // Get the last split operation by order
                const lastSplit = splitOperations.reduce((latest, current) =>
                    current.order > latest.order ? current : latest,
                );

                // Add to undo stack for redo functionality
                setUndoStack((undoStack) => [...undoStack, lastSplit]);

                // Remove the last split operation
                const updated = prev.filter((op) => op.id !== lastSplit.id);
                return updated;
            });
        };

        const canUndo = () => {
            return localOperations.some((op) => op.type === "split");
        };

        const redoLastSplit = () => {
            if (undoStack.length === 0) return;
            
            const lastUndone = undoStack[undoStack.length - 1];
            setUndoStack((prev) => prev.slice(0, -1));
            
            setLocalOperations((prev) => {
                const updated = [...prev, lastUndone];
                return updated;
            });
        };

        const canRedo = () => {
            return undoStack.length > 0;
        };

        const toggleSegmentEnabled = (segmentId: string) => {
            setSegments((prev) => {
                // Find the segment to toggle
                const segmentToToggle = prev.find(segment => segment.id === segmentId);
                if (!segmentToToggle) {
                    console.error("Segment not found for toggle operation:", segmentId);
                    return prev;
                }

                // Check if this would leave no enabled segments
                const enabledSegments = prev.filter(segment => segment.enabled);
                const wouldDisableLastSegment = segmentToToggle.enabled && enabledSegments.length === 1;
                
                if (wouldDisableLastSegment) {
                    console.warn("Cannot disable the last remaining segment");
                    // Optionally show a user notification here
                    return prev;
                }

                const updated = prev.map((segment) =>
                    segment.id === segmentId ? { ...segment, enabled: !segment.enabled } : segment,
                );
                
                onSegmentsChange?.(updated);
                return updated;
            });
        };

        // Segment reordering (drag and drop removed)
        // Note: Drag and drop functionality has been removed as requested

        const reorderSegments = (newSegments: VideoSegment[]) => {
            // Note: Manual reordering still available via API, but drag and drop UI has been removed
            const reorderedSegments = newSegments.map((segment, index) => ({
                ...segment,
                order: index,
            }));
            setSegments(reorderedSegments);
            onSegmentsChange?.(reorderedSegments);
        };

        // Utility functions
        const formatTime = (time: number): string => {
            // Validate input to prevent infinite rendering
            if (!isFinite(time) || isNaN(time) || time < 0) {
                return "0:00";
            }

            const hours = Math.floor(time / 3600);
            const minutes = Math.floor((time % 3600) / 60);
            const seconds = Math.floor(time % 60);

            if (hours > 0) {
                return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
            }
            return `${minutes}:${seconds.toString().padStart(2, "0")}`;
        };

        // Ref methods
        useImperativeHandle(
            ref,
            () => ({
                getCurrentOperations: () => localOperations,
                setOperations: (ops: VideoEditOperation[]) => {
                    setLocalOperations(ops);
                    setUndoStack([]); // Clear undo stack when operations are set externally
                    // Sync trim state when operations are set externally
                    const trimOp = ops.find((op) => op.type === "trim" && op.enabled);
                    if (trimOp) {
                        setTrimStart(trimOp.startTime);
                        setTrimEnd(trimOp.endTime);
                    }
                },
                addSplitPoint,
                clearOperations: () => {
                    setLocalOperations([]);
                    setSegments([]);
                    setUndoStack([]); // Clear undo stack when clearing operations
                    // Reset trim points to full duration when clearing
                    if (duration > 0) {
                        setTrimStart(0);
                        setTrimEnd(duration);
                    }
                },
                getCurrentTrim: () => ({ startTime: trimStart, endTime: trimEnd }),
                setTrimPoints: (startTime: number, endTime: number) => {
                    const validated = validateTrimPoints(startTime, endTime);
                    setTrimStart(validated.start);
                    setTrimEnd(validated.end);
                    onTrimChange?.(validated.start, validated.end);
                },
                addTrimOperation,
                getCurrentSegments: () => segments,
                toggleSegmentEnabled,
                reorderSegments,
                undoLastSplit,
                canUndo,
                redoLastSplit,
                canRedo,
            }),
            [
                localOperations,
                trimStart,
                trimEnd,
                onTrimChange,
                segments,
                duration,
                validateTrimPoints,
                addTrimOperation,
            ],
        );

        // Calculate positions for UI
        const currentPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
        const previewPercentage =
            duration > 0 && previewTime !== null ? (previewTime / duration) * 100 : null;

        return (
            <div
                className={`advanced-video-editor ${isDraggingTrim ? "dragging-trim" : ""}`}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{ width: "90%", margin: "2em auto" }}
            >
                {/* Loading Overlay */}
                {isVideoLoading && (
                    <div className="video-loading-overlay">
                        <div className="loading-spinner"></div>
                        <p>Loading video...</p>
                    </div>
                )}

                {/* Video Player */}
                <div className="video-container">
                    {videoLoadError ? (
                        <div className="video-error">
                            <p>Failed to load video: {videoLoadError}</p>
                        </div>
                    ) : (
                        <>
                            {signedVideoUrl && (
                                <OmakaseVideoPlayer
                                    ref={playerRef}
                                    videoSrc={signedVideoUrl}
                                    showTimeline={true}
                                    showThumbnails={true}
                                    segments={segments}
                                    trimStart={trimStart}
                                    trimEnd={trimEnd}
                                    onTimeUpdate={(time) => {
                                        setOmakaseCurrentTime(time);
                                        setCurrentTime(time);
                                    }}
                                    onPlay={() => {
                                        setIsOmakasePlaying(true);
                                        setIsPlaying(true);
                                    }}
                                    onPause={() => {
                                        setIsOmakasePlaying(false);
                                        setIsPlaying(false);
                                    }}
                                    onSeek={(time) => {
                                        setOmakaseCurrentTime(time);
                                        setCurrentTime(time);
                                    }}
                                    onDurationChange={(duration) => {
                                        setOmakaseDuration(duration);
                                        setDuration(duration);
                                        setIsVideoLoading(false);

                                        // Initialize trim points for the clip's own timeline
                                        // The clip video file starts from 0 and goes to its own duration
                                        // Ignore the original source video timestamps (initialTrimStart/End)
                                        // and treat this as a standalone clip starting from 0

                                        // For a clip file: timeline always goes from 0 to clip duration
                                        // Initial trim should span the entire clip (0 to duration)
                                        const clipStartTime = 0; // Always start from beginning of clip
                                        const clipEndTime = duration; // Always end at clip duration

                                        // Only set trim points if they haven't been set yet (trimEnd === 0 means not initialized)
                                        const shouldInitialize = trimEnd === 0;

                                        // Only initialize if not already set by user interaction
                                        if (shouldInitialize) {
                                            // Set trim points to span the entire clip
                                            setTrimStart(clipStartTime); // 0
                                            setTrimEnd(clipEndTime); // clip duration
                                        }
                                    }}
                                    onError={(error) => {
                                        console.error(
                                            "AdvancedVideoEditor: Omakase player error:",
                                            error,
                                        );
                                        setVideoLoadError("Omakase player failed to load video");
                                        setIsVideoLoading(false);
                                    }}
                                />
                            )}
                        </>
                    )}
                </div>

                {/* Three-Timeline System */}
                <div className="timelines-container">
                    {/* 1. Trim Timeline */}
                    <div className="timeline-section trim-timeline-section">
                        <div
                            ref={trimTimelineRef}
                            className={`timeline trim-timeline`}
                            onClick={handleTrimTimelineClick}
                            onMouseMove={(e) => handleTimelineMouseMove(e, trimTimelineRef)}
                            onMouseLeave={handleTimelineMouseLeave}
                        >
                            <div className="timeline-track trim-track" />

                            {/* Trim region */}
                            {duration > 0 && (
                                <div
                                    className="trim-region"
                                    style={{
                                        left: `${(trimStart / duration) * 100}%`,
                                        width: `${((trimEnd - trimStart) / duration) * 100}%`,
                                    }}
                                />
                            )}

                            {/* Excluded sections (parts that will be removed) */}
                            {duration > 0 && (
                                <>
                                    {/* Left excluded section (before trim start) */}
                                    {trimStart > 0 && (
                                        <div
                                            className="excluded-section start"
                                            style={{
                                                left: "0%",
                                                width: `${(trimStart / duration) * 100}%`,
                                            }}
                                        />
                                    )}

                                    {/* Right excluded section (after trim end) */}
                                    {trimEnd < duration && (
                                        <div
                                            className="excluded-section end"
                                            style={{
                                                left: `${(trimEnd / duration) * 100}%`,
                                                width: `${((duration - trimEnd) / duration) * 100}%`,
                                            }}
                                        />
                                    )}
                                </>
                            )}
                            {/* Time markers - major markers every 30 seconds, sub-markers every 10 seconds */}
                            {duration > 0 && (
                                <>
                                    {/* Major markers every 30 seconds */}
                                    {Array.from(
                                        { length: Math.floor(duration / 30) + 1 },
                                        (_, i) => i * 30,
                                    ).map((time, index) => (
                                        <div
                                            key={`trim-major-${index}`}
                                            className="time-marker major"
                                            style={{ left: `${(time / duration) * 100}%` }}
                                        >
                                            <div className="time-marker-line" />
                                        </div>
                                    ))}
                                </>
                            )}

                            {/* Trim handles */}
                            {duration > 0 && (
                                <>
                                    <div
                                        className={`trim-handle start ${isDraggingTrim === "start" ? "dragging" : ""}`}
                                        style={{
                                            left: `calc(${(trimStart / duration) * 100}% - 6px)`,
                                        }}
                                        onMouseDown={(e) => handleTrimHandleMouseDown("start", e)}
                                    >
                                        <div className="handle-grip" />
                                        <div className="handle-label">{formatTime(trimStart)}</div>
                                    </div>

                                    <div
                                        className={`trim-handle end ${isDraggingTrim === "end" ? "dragging" : ""}`}
                                        style={{
                                            left: `calc(${(trimEnd / duration) * 100}% + 6px)`,
                                        }}
                                        onMouseDown={(e) => handleTrimHandleMouseDown("end", e)}
                                    >
                                        <div className="handle-grip" />
                                        <div className="handle-label">{formatTime(trimEnd)}</div>
                                    </div>
                                </>
                            )}

                            {/* Current time indicator */}
                            <div
                                className="current-time-indicator trim"
                                style={{ left: `calc(${currentPercentage}% - 1px)` }}
                            />

                            {/* Preview time indicator */}
                            {previewPercentage !== null && (
                                <div
                                    className="preview-time-indicator"
                                    style={{ left: `${previewPercentage}%` }}
                                />
                            )}
                        </div>
                    </div>

                    {/* 2. Split Timeline (hidden — split mode disabled) */}
                    <div className="timeline-section split-timeline-section" style={{ display: 'none' }}>
                        <div
                            ref={splitTimelineRef}
                            className="timeline split-timeline active"
                            onClick={handleSplitTimelineClick}
                            onMouseMove={(e) => handleTimelineMouseMove(e, splitTimelineRef)}
                            onMouseLeave={handleTimelineMouseLeave}
                        >
                            <div className="timeline-track split-track" />
                            {/* <div className={"split-info"} 
                                 style={{ 
                                    left: `${(trimStart / duration) * 100}%`,
                                    width: `${((trimEnd - trimStart) / duration) * 100}%`
                                }}
                            >
                                Click on this lane to split
                            </div> */}
                            {/* Video Segments */}
                            {segments.map((segment) => {
                                const startPercentage =
                                    duration > 0 ? (segment.startTime / duration) * 100 : 0;
                                const widthPercentage =
                                    duration > 0
                                        ? ((segment.endTime - segment.startTime) / duration) * 100
                                        : 0;

                                return (
                                    <div
                                        key={segment.id}
                                        className={`video-segment ${segment.enabled ? "enabled" : "disabled"}`}
                                        style={{
                                            left: `${startPercentage}%`,
                                            width: `${widthPercentage}%`,
                                        }}
                                        title={`${segment.name} (${formatTime(segment.startTime)} - ${formatTime(segment.endTime)}) - Click to ${segment.enabled ? "disable" : "enable"}`}
                                    >
                                        <div className="segment-content">
                                            <div className="segment-label">
                                                <span>{segment.name}</span>
                                            </div>
                                            <div className="segment-controls">
                                                <Button
                                                    variant={"icon"}
                                                    // className="segment-control-btn toggle"
                                                    iconSvg={
                                                        segment.enabled ? (
                                                            <Trash2
                                                                size={14}
                                                                style={{ color: "#fff" }}
                                                            />
                                                        ) : (
                                                            <Plus
                                                                size={14}
                                                                style={{ color: "#fff" }}
                                                            />
                                                        )
                                                    }
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleSegmentEnabled(segment.id);
                                                    }}
                                                    // title={segment.enabled ? "Disable segment" : "Enable segment"}
                                                ></Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Excluded sections (parts that will be removed) */}
                            {duration > 0 && (
                                <>
                                    {/* Left excluded section (before trim start) */}
                                    {trimStart > 0 && (
                                        <div
                                            className="excluded-section start"
                                            style={{
                                                left: "0%",
                                                width: `${(trimStart / duration) * 100}%`,
                                            }}
                                        />
                                    )}

                                    {/* Right excluded section (after trim end) */}
                                    {trimEnd < duration && (
                                        <div
                                            className="excluded-section end"
                                            style={{
                                                left: `${(trimEnd / duration) * 100}%`,
                                                width: `${((duration - trimEnd) / duration) * 100}%`,
                                            }}
                                        />
                                    )}
                                </>
                            )}
                            {/* Current time indicator */}
                            <div
                                className="current-time-indicator split"
                                style={{ left: `calc(${currentPercentage}% - 1px)` }}
                            />

                            {/* Preview time indicator */}
                            {previewPercentage !== null && (
                                <div
                                    className="preview-time-indicator"
                                    style={{ left: `${previewPercentage}%` }}
                                />
                            )}
                            {/* Time markers - major markers every 30 seconds, sub-markers every 10 seconds */}
                            {duration > 0 && (
                                <>
                                    {/* Major markers every 30 seconds */}
                                    {Array.from(
                                        { length: Math.floor(duration / 30) + 1 },
                                        (_, i) => i * 30,
                                    ).map((time, index) => (
                                        <div
                                            key={`split-major-${index}`}
                                            className="time-marker major"
                                            style={{ left: `${(time / duration) * 100}%` }}
                                        >
                                            <div className="time-marker-line" />
                                        </div>
                                    ))}

                                    {/* Sub-markers every 10 seconds (excluding major marker positions) */}
                                    {Array.from(
                                        { length: Math.floor(duration / 10) + 1 },
                                        (_, i) => i * 10,
                                    )
                                        .filter((time) => time % 30 !== 0) // Exclude positions where major markers exist
                                        .map((time, index) => (
                                            <div
                                                key={`split-sub-${index}`}
                                                className="time-mark sub"
                                                style={{
                                                    position: "absolute",
                                                    height: "15px",
                                                    width: "1px",
                                                    background: "rgba(255, 255, 255, 0.1)",
                                                    bottom: "1px",
                                                    left: `${(time / duration) * 100}%`,
                                                }}
                                            />
                                        ))}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Undo/Redo Controls (hidden — split mode disabled) */}
                    <div className="undo-redo-controls" style={{ display: 'none' }}>
                        <Button
                            variant="normal"
                            disabled={!canUndo() || disabled}
                            onClick={undoLastSplit}
                            iconSvg={<Undo2 size={16} />}
                        >
                            Undo Split
                        </Button>
                        <Button
                            variant="normal"
                            disabled={!canRedo() || disabled}
                            onClick={redoLastSplit}
                            iconSvg={<Redo2 size={16} />}
                        >
                            Redo Split
                        </Button>
                    </div>
                </div>

                {/* Operations Summary */}
                <div className="operations-summary">
                    {localOperations.length > 0 && (
                        <div className="operations-list">
                            {/* <h5>Applied Operations:</h5> */}
                            <div className="operations-items">
                                {localOperations.map((op) => (
                                    <div
                                        key={op.id}
                                        className={`operation-item ${op.enabled ? "enabled" : "disabled"}`}
                                    >
                                        <span className="operation-type">
                                            {op.type.toUpperCase()} -
                                        </span>
                                        <span className="operation-description">
                                            {op.description}
                                        </span>
                                        {!op.enabled && (
                                            <span className="operation-status">DISABLED</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    },
);

AdvancedVideoEditor.displayName = "AdvancedVideoEditor";
export default AdvancedVideoEditor;
