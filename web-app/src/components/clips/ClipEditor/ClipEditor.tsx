import { Alert, Box, Button, Container, Flashbar, FlashbarProps, Header, List, SpaceBetween, Spinner, Tabs, } from "@cloudscape-design/components";
import { Loader, Scissors, SquareSplitHorizontal, TableColumnsSplit, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useClips } from "../../../hooks/useClips";
import clipService from "../../../services/clipService";
import videoProcessingService from "../../../services/videoProcessingService";
import VideoService from "../../../services/videoService";
import { Clip, VideoEditOperation, VideoProcessingParameters } from "../../../types";
import { AdvancedVideoEditor, AdvancedVideoEditorRef, } from "../../common/AdvancedVideoEditor/AdvancedVideoEditor";
import { VideoProcessingTable } from "../../common/VideoProcessingTable/VideoProcessingTable";
import { ClipsList } from "../ClipsList";
import "./ClipEditor.css";
import { useNavigate } from "react-router-dom";

interface ClipEditorProps {
    clipId?: string;
    clipName: string;
    videoSrc: string | undefined; // For video playback (signed URL)
    sourceKey?: string; // For video processing (S3 key)
    initialStartTime?: number;
    initialEndTime?: number;
    onDiscard?: () => void;
    isProcessing?: boolean; // Whether the clip is currently being processed
    viewOnly?: boolean; // Whether to show in view-only mode
    originalAssetId?: string; // Original asset id for loading original video
}

export const ClipEditor: React.FC<ClipEditorProps> = ({
    clipId,
    clipName,
    videoSrc,
    sourceKey,
    initialStartTime = 0,
    initialEndTime,
    onDiscard,
    isProcessing = false,
    viewOnly = false,
    originalAssetId
}) => {
    const navigate = useNavigate();
    const videoService = VideoService.getInstance();
    const editorRef = useRef<AdvancedVideoEditorRef>(null);
    const { clips: allClips, fetchClips } = useClips();
    // Video editing state
    const [editOperations, setEditOperations] = useState<VideoEditOperation[]>([]);

    // Refs to store current values for callbacks
    const editOperationsRef = useRef<VideoEditOperation[]>([]);
    const [hasChanges, setHasChanges] = useState(false);
    const [activeTab, setActiveTab] = useState("editor");

    // Processing state
    const [isProcessingVideo, setIsProcessingVideo] = useState(false);

    // UI feedback state
    const [flashMessages, setFlashMessages] = useState<FlashbarProps.MessageDefinition[]>([]);
    const [currentClip, setCurrentClip] = useState<Clip | null>(null);

    // Generated clips state
    const [generatedClips, setGeneratedClips] = useState<Clip[]>([]);
    const [isLoadingGeneratedClips, setIsLoadingGeneratedClips] = useState(false);

    // Trim state for clip timeline - treat clip as standalone video starting from 0
    const [trimPoints, setTrimPoints] = useState(() => {
        // For clip editing: ignore source video timestamps (initialStartTime/initialEndTime)
        // Treat the clip as its own timeline starting from 0
        const clipStartTime = 0; // Always start from beginning of clip
        const clipEndTime = 0; // Will be set to clip duration when video loads

        return {
            startTime: clipStartTime,
            endTime: clipEndTime,
        };
    });

    // Update refs when state changes
    useEffect(() => {
        editOperationsRef.current = editOperations;
    }, [editOperations]);

    // Fetch latest clip data
    const fetchLatestClip = useCallback(async () => {
        if (!clipId) return null;

        try {
            const clip = await clipService.getClip(clipId);
            setCurrentClip(clip);
            return clip;
        } catch (error) {
            console.error("Failed to fetch latest clip data:", error);
            return null;
        }
    }, [clipId]);

    // Flash message helpers
    const addFlashMessage = useCallback(
        (message: Omit<FlashbarProps.MessageDefinition, "id" | "onDismiss">) => {
            const messageWithId: FlashbarProps.MessageDefinition = {
                ...message,
                id: Date.now().toString(),
                onDismiss: () => removeFlashMessage(Date.now().toString()),
            };
            setFlashMessages((prev) => [...prev, messageWithId]);
        },
        [],
    );

    const removeFlashMessage = useCallback((id: string) => {
        setFlashMessages((prev) => prev.filter((msg) => msg.id !== id));
    }, []);

    // Get current segments from editor when needed
    const getCurrentSegments = useCallback(() => {
        if (editorRef.current) {
            return editorRef.current.getCurrentSegments();
        }
        return [];
    }, []);

    // Fetch clip data on component load
    useEffect(() => {
        if (clipId) {
            fetchLatestClip().then();
        }
    }, [clipId, fetchLatestClip]);

    // Update trim points when initial values change (new clip loaded)
    useEffect(() => {
        const newTrimPoints = {
            startTime: initialStartTime,
            endTime: initialEndTime || 0,
        };
        setTrimPoints(newTrimPoints);
        setHasChanges(false);

        // Don't initialize with trim operations from props - let the video determine its own duration
        // This prevents using stale/invalid duration data from the database

        // Always start with no operations - let user create them after video loads
        setEditOperations([]);
        editOperationsRef.current = [];
    }, [initialStartTime, initialEndTime]); // Keep dependencies but make ID consistent

    const handleOperationsChange = useCallback(
        (operations: VideoEditOperation[]) => {
            setEditOperations(operations);
            editOperationsRef.current = operations;

            // Get current segments dynamically to check for changes
            const currentSegments = getCurrentSegments();
            setHasChanges(operations.length > 0 || currentSegments.some((s) => !s.enabled));

            // Update trim points if there's a trim operation (but avoid loops)
            const trimOp = operations.find((op) => op.type === "trim" && op.enabled);
            if (trimOp) {
                const newTrimPoints = { startTime: trimOp.startTime, endTime: trimOp.endTime };
                // Only update if values actually changed to prevent loops
                setTrimPoints((prev) => {
                    if (
                        prev.startTime !== newTrimPoints.startTime ||
                        prev.endTime !== newTrimPoints.endTime
                    ) {
                        return newTrimPoints;
                    }
                    return prev;
                });
            }
        },
        [getCurrentSegments],
    ); // Only depend on the getter function

    const handleTrimChange = useCallback((startTime: number, endTime: number) => {
        // Validate trim values before setting
        const maxReasonableTime = 86400; // 24 hours
        const validStartTime = Math.max(0, Math.min(startTime, maxReasonableTime));
        const validEndTime = Math.max(validStartTime + 1, Math.min(endTime, maxReasonableTime));

        setTrimPoints({ startTime: validStartTime, endTime: validEndTime });
        // Don't automatically create trim operations here to avoid loops
        // The AdvancedVideoEditor will handle trim operations internally
    }, []);

    const handleReset = () => {
        // Clear all operations and reset segments
        setEditOperations([]);
        setHasChanges(false);
        setTrimPoints({ startTime: 0, endTime: 0 }); // Reset to clip timeline (0 to clip duration)
        if (editorRef.current) {
            editorRef.current.clearOperations();
        }
    };

    const handleDiscard = () => {
        // Reset and close
        handleReset();
        onDiscard?.();
    };

    const handleProcessVideo = async () => {
        if (!sourceKey) {
            console.error("No source key available for processing");
            return;
        }

        // Check if video has loaded properly by checking if we have a valid duration
        const currentDuration = editorRef.current?.getCurrentTrim()?.endTime || 0;
        if (currentDuration === 0) {
            console.error("Cannot process video - video duration not available");
            addFlashMessage({
                type: "warning",
                header: "Video Still Loading",
                content: "Please wait for the video to load completely before processing.",
                dismissible: true,
            });
            return;
        }

        setIsProcessingVideo(true);

        // Note: Clip status will be updated by the backend video processing service

        try {
            // Validate source key
            if (!sourceKey) {
                throw new Error("No source key available for processing");
            }

            // Prepare parameters with current operations and segments
            const enabledOperations = editOperations.filter((op) => op.enabled);

            // Add delete operations for disabled segments
            const currentSegments = getCurrentSegments();
            const disabledSegments = currentSegments.filter((s) => !s.enabled);
            const deleteOperations: VideoEditOperation[] = disabledSegments.map(
                (segment, index) => ({
                    id: `delete_segment_${segment.id}_${segment.startTime}_${segment.endTime}`, // More unique ID
                    type: "delete",
                    startTime: segment.startTime,
                    endTime: segment.endTime,
                    order: enabledOperations.length + index,
                    enabled: true,
                    description: `Delete ${segment.name}`,
                }),
            );

            const parameters: VideoProcessingParameters = {
                operations: [...enabledOperations, ...deleteOperations],
                outputSettings: {
                    format: "hls",
                    quality: "medium",
                },
                clipName: clipName,
            };

            // Validate operations
            const errors = videoProcessingService.validateOperations(parameters.operations);
            console.log("Validation errors:", errors);

            if (errors.length > 0) {
                throw new Error(`Invalid operations: ${errors.join(", ")}`);
            }

            // Validate that we have a source key for processing
            if (!sourceKey) {
                throw new Error("No source key available for video processing");
            }

            // Start processing (no polling)
            // Determine HLS path based on sourceKey format
            let hlsPath: string;
            if (sourceKey.endsWith(".m3u8")) {
                // Modified clips: sourceKey already includes the master playlist path
                hlsPath = sourceKey;
            } else {
                // Original clips: sourceKey is just the path, append main.m3u8
                if (sourceKey.endsWith('/')) {
                    hlsPath = `${sourceKey}main.m3u8`;
                } else {
                    hlsPath = `${sourceKey}/main.m3u8`;
                }
            }

            const sourceUrl = await videoService.getVideoUrl(hlsPath);
            const response = await videoProcessingService.processVideoAsync({
                sourceUrl,
                parameters,
                clipId,
                eventId: currentClip?.eventId,
                assetType: "clip",
                orientation: "both",
            });

            // With async processing, we always get a "pending" status initially
            if (response.status === "pending") {
                addFlashMessage({
                    type: "success",
                    header: "Video Processing Queued",
                    content: `Your video "${clipName}" has been queued for processing. Refresh to check the latest status. Job ID: ${response.jobId}`,
                    dismissible: true,
                });

                // Optionally start polling for job status
                // You could implement a polling mechanism here or use WebSockets for real-time updates
            } else if (response.status === "completed") {
                // Unlikely with async processing, but handle just in case
                addFlashMessage({
                    type: "success",
                    header: "Video Processing Completed",
                    content: `Your video "${clipName}" has been processed successfully!`,
                    dismissible: true,
                });

                // Fetch latest clip data
                const latestClip = await fetchLatestClip();
                setCurrentClip(latestClip);
            } else {
                // Handle other statuses
                addFlashMessage({
                    type: "info",
                    header: "Video Processing Status",
                    content: `Processing status: ${response.status}. Job ID: ${response.jobId || 'N/A'}`,
                    dismissible: true,
                });
            }
        } catch (error) {
            console.error("Video processing failed:", error);

            // Fetch latest clip to see if anything changed
            await fetchLatestClip();

            addFlashMessage({
                type: "error",
                header: "Processing Failed",
                content: `Failed to start video processing: ${error instanceof Error ? error.message : String(error)}`,
                dismissible: true,
            });
        } finally {
            setIsProcessingVideo(false);
        }
    };

    // Fetch generated clips based on originalAssetId
    const fetchGeneratedClips = useCallback(async () => {
        if (!clipId) return;

        setIsLoadingGeneratedClips(true);
        try {
            // Fetch all clips to filter for generated ones
            await fetchClips();
            
            // Filter clips that have this clip as their originalAssetId
            const generated = allClips.filter(clip => 
                clip.originalAssetId === clipId && clip.id !== clipId
            );
            
            setGeneratedClips(generated);
            
        } catch (error) {
            console.error("Failed to fetch generated clips:", error);
            addFlashMessage({
                type: "error",
                header: "Failed to Load Generated Clips",
                content: "Could not load clips generated from this video.",
                dismissible: true,
            });
        } finally {
            setIsLoadingGeneratedClips(false);
        }
    }, [clipId, allClips, fetchClips, addFlashMessage]);

    // Get current video source using sourceKey (either from current clip or passed prop)
    const getCurrentVideoSource = useCallback(async () => {
        try {
            // Priority: current clip's sourceKey > passed sourceKey > passed videoSrc
            const sourceKeyToUse = currentClip?.sourceKey || sourceKey;

            if (sourceKeyToUse) {
                // Determine HLS path based on sourceKey format
                let hlsPath: string;
                if (sourceKeyToUse.endsWith(".m3u8")) {
                    hlsPath = sourceKeyToUse;
                } else {
                    if (sourceKeyToUse.endsWith('/')) {
                        hlsPath = `${sourceKeyToUse}main.m3u8`;
                    } else {
                        hlsPath = `${sourceKeyToUse}/main.m3u8`;
                    }
                }

                return await videoService.getVideoUrl(hlsPath);
            }

            // Fallback to passed videoSrc
            return videoSrc;
        } catch (error) {
            console.error("Failed to get video source from sourceKey:", error);
            return videoSrc; // Fallback to original videoSrc
        }
    }, [currentClip?.sourceKey, sourceKey, videoSrc, videoService]);

    // State for current video source
    const [currentVideoSrc, setCurrentVideoSrc] = useState<string | undefined>(videoSrc);

    const renderInstructions = () => {
        return (
            <div
                style={{
                    width: "90%",
                    margin: "auto",
                }}
            >
                <Alert header="How to edit your video">
                    <List
                        ariaLabel="List with secondary content"
                        items={[
                            {
                                id: "trim",
                                icon: <Scissors size={14} color={"orange"} />,
                                content: <strong style={{color: "orange"}}>Trim Timeline</strong>,
                                description: "Drag the yellow handles to set video boundaries, or click near handles to adjust"
                            },
                            {
                                id: "segments",
                                icon: <TableColumnsSplit size={14} color={"green"} />,
                                content: <strong style={{color: "green"}}>Segments Timeline</strong>,
                                description: "Click segments to enable/disable them"
                            },
                            {
                                id: "process",
                                icon: <Loader size={14} color={"rgb(0, 108, 224)"} />,
                                content: <strong style={{color: "rgb(0, 108, 224)"}}>Process Video</strong>,
                                description:
                                    "Click \"Process Video\" to apply all operations and create the final edited video"
                            }
                        ]}
                        renderItem={({ id, content, description, icon }) => ({
                            id,
                            content,
                            icon,
                            secondaryContent: (
                            <Box variant="small">{description}</Box>
                            )
                        })}
                    />
                </Alert>
            </div>
        );
    }
    // Update video source when clip or sourceKey changes
    useEffect(() => {
        const updateVideoSource = async () => {
            const newVideoSrc = await getCurrentVideoSource();
            setCurrentVideoSrc(newVideoSrc);
        };

        updateVideoSource().then();
    }, [getCurrentVideoSource]);

    // Load generated clips when clipId or allClips change
    useEffect(() => {
        if (clipId && allClips.length > 0) {
            const generated = allClips.filter(clip => 
                clip.originalAssetId === clipId && clip.id !== clipId
            );
            setGeneratedClips(generated);
        }
    }, [clipId, allClips]);

    // Initial load of all clips
    useEffect(() => {
        fetchClips().then();
    }, [fetchClips]);

    return (
        <Container
            header={
                <Header
                    variant="h2"
                    description={
                        viewOnly
                            ? "View your processed video clip. You can switch between the modified and original versions."
                            : "Edit your video clip with advanced tools including trimming, splitting, and deleting sections"
                    }
                    actions={
                        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                                {originalAssetId && (
                                    <Button
                                        variant="normal"
                                        onClick={() => {
                                            navigate("/video-editor?videoId=" + originalAssetId);
                                            navigate(0);
                                        }}
                                        iconName="refresh"
                                    >
                                        Show Original
                                    </Button>
                                )}
                                <Button
                                    variant="normal"
                                    onClick={handleDiscard}
                                    disabled={isProcessingVideo || !hasChanges}
                                    iconName={"delete-marker"}
                                >
                                    Discard Changes
                                </Button>
                                <Button
                                    variant="primary"
                                    onClick={handleProcessVideo}
                                    disabled={
                                        isProcessingVideo ||
                                        (editOperations.filter((op) => op.enabled).length ===
                                            0 &&
                                            getCurrentSegments().filter((s) => !s.enabled)
                                                .length === 0)
                                    }
                                    loading={isProcessingVideo}
                                    iconSvg={<Scissors />}
                                >
                                    Process Video
                                </Button>
                            </SpaceBetween>
                        </SpaceBetween>
                    }
                >
                    {viewOnly
                        ? `View Clip - ${clipName}`
                        : clipId
                          ? `Edit Clip - ${clipName}`
                          : "Create New Clip"}
                </Header>
            }
        >
            <SpaceBetween size="l">
                {/* Flash Messages */}
                {flashMessages.length > 0 && (
                    <Flashbar
                        items={flashMessages.map((msg) => ({
                            ...msg,
                            onDismiss: () => removeFlashMessage(msg.id!),
                        }))}
                    />
                )}

                {/* Editor and Processing Tabs */}
                <Tabs
                    activeTabId={activeTab}
                    onChange={({ detail }) => setActiveTab(detail.activeTabId)}
                    tabs={[
                        {
                            id: "editor",
                            label: viewOnly ? "Video Viewer" : "Video Editor",
                            content: (
                                <SpaceBetween size={"s"}>
                                    <AdvancedVideoEditor
                                        ref={editorRef}
                                        clipId={clipId}
                                        videoSrc={currentVideoSrc}
                                        operations={editOperations}
                                        onOperationsChange={handleOperationsChange}
                                        disabled={isProcessingVideo || isProcessing}
                                        initialTrimStart={trimPoints.startTime}
                                        initialTrimEnd={trimPoints.endTime}
                                        onTrimChange={handleTrimChange}
                                    />
                                    {renderInstructions()}
                                </SpaceBetween>
                            ),
                        },
                        {
                            id: "processing",
                            label: "Processing Jobs",
                            content: (
                                <VideoProcessingTable
                                    clipId={clipId}
                                    onJobSelect={(job) => {
                                        navigate("/video-editor?videoId=" + job.clipId)
                                        // Could open a modal with job details
                                    }}
                                />
                            ),
                        },
                        {
                            id: "generated",
                            label: `Generated Clips (${generatedClips.length})`,
                            content: (
                                <SpaceBetween size="l">
                                    <ClipsList
                                        title="Generated Clips"
                                        clips={generatedClips}
                                        selectedClips={[]}
                                        onSelectionChange={() => {}}
                                        loading={isLoadingGeneratedClips}
                                        onViewClip={(clip) => {
                                            // Navigate to view the generated clip
                                            window.open(`/video-editor?videoId=${clip.id}`, "_self");
                                        }}
                                        onEditClip={(clip) => {
                                            // Navigate to edit the generated clip (if not modified)
                                            window.open(`/video-editor?videoId=${clip.id}`, "_self");
                                        }}
                                        onFeedbackClip={(clip) => {
                                            // Handle feedback for generated clip
                                            navigate("/feedback?clipId=" + clip.id);
                                        }}
                                        tableSelection="single"
                                        showActions={true}
                                        showEditedOnly={true}
                                        onRefresh={fetchGeneratedClips}
                                    />
                                </SpaceBetween>
                            ),
                        },
                    ]}
                />
            </SpaceBetween>
        </Container>
    );
};

export default ClipEditor;
