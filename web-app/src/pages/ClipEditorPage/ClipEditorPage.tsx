import {
    Alert,
    Badge,
    Box,
    Button,
    Container,
    ContentLayout,
    Header,
    KeyValuePairs,
    SpaceBetween,
    Spinner,
} from "@cloudscape-design/components";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipEditor } from "../../components/clips/ClipEditor/ClipEditor";
import { ClipsList } from "../../components/clips/ClipsList";
import { VideoProcessingTable } from "../../components/common/VideoProcessingTable/VideoProcessingTable";
import { renderClipStatus } from "../../components/common/DataTable";
import ViewClip from "../../components/clips/ClipModal/ViewClip";

import { useClips } from "../../hooks/useClips";
import { Clip } from "../../types";
import ApiService from "../../services/apiService";
import downloadService from "../../services/downloadService";

const ClipEditorPage: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const videoId = searchParams.get("videoId");
    const [clip, setClip] = useState<Clip | undefined>(undefined);
    const [selectedClips, setSelectedClips] = useState<Clip[]>([]);
    const [viewingClip, setViewingClip] = useState<Clip | undefined>(undefined);
    const [showViewClipDialog, setShowViewClipDialog] = useState(false);
    const [eventChannelName, setEventChannelName] = useState<string | undefined>();
    const [channels, setChannels] = useState<any[]>([]);
    const [harvestTriggered, setHarvestTriggered] = useState(false);
    const [harvestError, setHarvestError] = useState<string | undefined>(undefined);
    const harvestPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const apiService = ApiService.getInstance();

    // Determine if we're in view-only mode based on clip status
    const isViewOnlyMode = clip && clip.status === "processing";

    const { clips, fetchClips, fetchClip, loading: clipLoading, error: clipError } = useClips();


    const loadChannels = useCallback(async () => {
        try {
            const channelsData: any[] = await apiService.getChannels();
            setChannels(channelsData);
        } catch (error) {
            console.error("Failed to load channels:", error);
        }
    }, [apiService]);

    useEffect(() => {
        loadChannels().then();
    }, [loadChannels]);

    // Load all clips when component mounts
    useEffect(() => {
        fetchClips().then();
    }, [fetchClips]);

    // Load specific clip when videoId changes
    useEffect(() => {
        const loadClip = async () => {
            if (!videoId) {
                setClip(undefined);
                return;
            }

            try {
                const clipData = await fetchClip(videoId);
                setClip(clipData);
            } catch (error) {
                console.error("Failed to load clip:", error);
            }
        };

        loadClip().then();
    }, [videoId, fetchClip]);

    useEffect(() => {
        if (!clip || !channels) return;
        const channelName = channels?.find((c: any) => c.id === clip?.mediaLiveChannel);
        channelName && setEventChannelName(channelName.name);
    }, [clip]);

    // Determine which clip source the editor would use (it loads a single source).
    const editorSource = clip
        ? clip.sourceKey || clip.sourceKeys?.landscape || clip.sourceKeys?.portrait
        : undefined;
    const editorReady = Boolean(editorSource);

    // Compute the orientations the clip is still waiting on.
    const missingOrientations: Array<"landscape" | "portrait"> = (() => {
        if (!clip) return [];
        const harvested = Array.from(clip.harvestedOrientations ?? []);
        const sourceKeys = clip.sourceKeys ?? {};
        const missing: Array<"landscape" | "portrait"> = [];
        if (!harvested.includes("landscape") && !sourceKeys.landscape) missing.push("landscape");
        if (!harvested.includes("portrait") && !sourceKeys.portrait) missing.push("portrait");
        return missing;
    })();
    const isAwaitingHarvest = !editorReady && missingOrientations.length > 0;

    // Trigger harvest for missing orientations when editor opens.
    useEffect(() => {
        if (!clip || harvestTriggered) return;
        if (missingOrientations.length === 0) return;

        setHarvestTriggered(true);
        setHarvestError(undefined);

        const triggerHarvests = async () => {
            try {
                const responses = await Promise.all(
                    missingOrientations.map((orientation) =>
                        downloadService.createDownloadJobs(
                            [{ id: clip.id, type: "clip" }],
                            orientation,
                        ),
                    ),
                );

                console.log("[ClipEditor] Harvest trigger responses", {
                    clipId: clip.id,
                    requested: missingOrientations,
                    responses,
                });

                // The download API skips when a download_job is already
                // processing/harvesting/pending for this clip. That's fine —
                // it just means a workflow is already running and our polling
                // will pick up the result. Surface a hint when nothing was
                // actually started so the developer/user knows why.
                const allSkipped = responses.every(
                    (r) => r.processed.length === 0 && r.skipped.length > 0,
                );
                if (allSkipped) {
                    console.warn(
                        "[ClipEditor] Harvest not started — an existing download job is in flight for this clip. Waiting on it instead.",
                        responses,
                    );
                }
            } catch (error) {
                console.error("Failed to trigger harvest for missing orientations:", error);
                setHarvestError(
                    error instanceof Error
                        ? error.message
                        : "Failed to start a harvest. Please try again.",
                );
            }
        };

        triggerHarvests();
    }, [clip, harvestTriggered, missingOrientations]);

    // While waiting for a harvest, poll the clip record so the editor lights up
    // as soon as the state machine writes the first sourceKey/harvestedOrientations.
    useEffect(() => {
        if (!videoId) return;
        if (!isAwaitingHarvest) {
            // Nothing to wait for — clear any active poll.
            if (harvestPollRef.current) {
                clearInterval(harvestPollRef.current);
                harvestPollRef.current = null;
            }
            return;
        }

        if (harvestPollRef.current) return; // already polling

        harvestPollRef.current = setInterval(async () => {
            try {
                const updated = await fetchClip(videoId);
                if (updated) setClip(updated);
            } catch (error) {
                console.error("Failed to refresh clip while waiting for harvest:", error);
            }
        }, 5000);

        return () => {
            if (harvestPollRef.current) {
                clearInterval(harvestPollRef.current);
                harvestPollRef.current = null;
            }
        };
    }, [videoId, isAwaitingHarvest, fetchClip]);

    const handleManualRefresh = useCallback(async () => {
        if (!videoId) return;
        try {
            const updated = await fetchClip(videoId);
            if (updated) setClip(updated);
        } catch (error) {
            console.error("Failed to refresh clip:", error);
        }
    }, [videoId, fetchClip]);

    const handleDiscard = () => {
        // Navigate back to clips list or previous page
        window.open("/video-editor", "_self");
    };

    const handleClipView = (selectedClip: Clip) => {
        setViewingClip(selectedClip);
        setShowViewClipDialog(true);
    };

    const handleClipEdit = (selectedClip: Clip) => {
        // Navigate to the video editor with the selected clip ID as query parameter
        navigate(`/video-editor?videoId=${selectedClip.id}`);
    };

    const handleClipFeedback = (_clip: Clip | undefined) => {
        // Feedback feature removed
    };

    const handleToggleLock = async (clip: Clip | undefined) => {
        if (!clip) return;
        
        try {
            await apiService.updateClip({
                ...clip,
                locked: !clip.locked
            });
            
            // Refresh clips to show updated lock state
            await fetchClips();
            
            // If we're viewing this clip, refresh it too
            if (videoId === clip.id) {
                const updatedClip = await fetchClip(clip.id);
                setClip(updatedClip);
            }
        } catch (error) {
            console.error("Failed to toggle lock:", error);
        }
    };

    const formatDuration = (seconds: number | undefined) => {
        if (seconds) {
            const hours = Math.floor(seconds / 60 / 60);
            const remainingSeconds = seconds % 360;
            if (hours > 0) {
                return `${hours}m ${remainingSeconds}s`;
            }
            return `${seconds}s`;
        }
        return "0s";
    };

    // Show loading state
    if (clipLoading) {
        return (
            <ContentLayout
                defaultPadding
                headerVariant="high-contrast"
                header={
                    <Header variant="h1" description="Edit and refine your selected video assets.">
                        Video Editor
                    </Header>
                }
            >
                <Box textAlign="center" padding="xxl">
                    <SpaceBetween size="m">
                        <Spinner size="large" />
                        <Box variant="p">Loading...</Box>
                    </SpaceBetween>
                </Box>
            </ContentLayout>
        );
    }

    // Show clips list and video processing table if no video ID is provided
    if (!videoId) {
        return (
            <ContentLayout
                defaultPadding
                headerVariant="high-contrast"
                header={
                    <Header
                        variant="h1"
                        description="Select a clip to edit and refine with precision trimming tools, or view video processing jobs"
                    >
                        Video Editor
                    </Header>
                }
            >
                <Container>
                    <ClipsList
                        title="Key moments"
                        clips={clips}
                        selectedClips={selectedClips}
                        onSelectionChange={setSelectedClips}
                        loading={clipLoading}
                        onViewClip={handleClipView}
                        onEditClip={(clip) => {
                            // Disable editing for clips being processed or locked
                            if (clip.status === "processing" || clip.locked) return;
                            handleClipEdit(clip);
                        }}
                        onFeedbackClip={handleClipFeedback}
                        onToggleLock={handleToggleLock}
                        tableSelection={"single"}
                        showActions={true}
                        onRefresh={fetchClips}
                    />

                    <VideoProcessingTable
                        showAll={true}
                        clipId={selectedClips?.[0]?.id}
                        onJobSelect={(job) => {
                            // Navigate to the clip if it has a clipId
                            if (job.clipId) {
                                navigate(`/video-editor?videoId=${job.clipId}`);
                            }
                        }}
                    />
                </Container>

                {/* View Clip Modal */}
                <ViewClip
                    clip={viewingClip}
                    showDialog={showViewClipDialog}
                    setShowDialog={setShowViewClipDialog}
                    onEditClip={(clip) => {
                        setShowViewClipDialog(false);
                        if (clip) {
                            handleClipEdit(clip);
                        }
                    }}
                    onFeedbackClip={handleClipFeedback}
                    onToggleLock={handleToggleLock}
                    onRefresh={fetchClips}
                />
            </ContentLayout>
        );
    }

    // Show error if clip couldn't be loaded
    if (clipError) {
        return (
            <ContentLayout
                defaultPadding
                headerVariant="high-contrast"
                header={
                    <Header variant="h1" description="Edit and refine your selected clip.">
                        Video Editor
                    </Header>
                }
            >
                <Alert type="error" header="Unable to load clip">
                    {clipError || "The requested clip could not be loaded."}
                </Alert>
            </ContentLayout>
        );
    }

    return (
        <ContentLayout
            defaultPadding
            headerVariant="high-contrast"
            header={
                <Header
                    variant="h1"
                    description="Edit and refine your selected clip with precision trimming tools"
                    actions={
                        <Button
                            variant="normal"
                            iconName="arrow-left"
                            onClick={() => navigate("/video-editor")}
                            ariaLabel="Back to Clips"
                        >
                            Back to Clips
                        </Button>
                    }
                >
                    Video Editor
                </Header>
            }
        >
            <SpaceBetween size={"xl"}>
                <Container
                    header={
                        <Header description={clip?.originalAssetId ? "Result of the edited video content" : "Video generated by AWS Elemental Inference."}>
                            <SpaceBetween direction="horizontal" size="xs" alignItems="start">
                                <span style={{ textTransform: "capitalize" }}>
                                    {clip?.name}
                                </span>
                                {clip?.originalAssetId && <Badge color="red">Edited</Badge>}
                            </SpaceBetween>
                        </Header>
                    }
                >
                    <SpaceBetween size="xxl">
                        <KeyValuePairs
                            columns={5}
                            items={[
                                {
                                    label: "Status",
                                    value: renderClipStatus(clip?.status as any ?? "original"),
                                },
                                {
                                    label: "Duration",
                                    value: formatDuration(clip?.duration),
                                },
                                {
                                    label: "Resolution",
                                    value: <Badge>{clip?.resolution}</Badge>,
                                },
                                {
                                    label: "Format",
                                    value: <Badge color="severity-low">HLS</Badge>,
                                },
                                {
                                    label: "Media Live Channel",
                                    value: eventChannelName,
                                },
                            ]}
                        />

                        {/* Processing Status Alert */}
                        {clip &&
                            (clip.status === "processing" || clip.status === "edit_in_progress") && (
                                <Alert
                                    type="info"
                                    header="Video Processing in Progress"
                                    action={
                                        <Button
                                            variant="primary"
                                            onClick={() => {
                                                // Refresh clip data
                                                if (clip.id) {
                                                    fetchClip(clip.id).then(setClip);
                                                }
                                            }}
                                            ariaLabel="Refresh Status"
                                        >
                                            Refresh Status
                                        </Button>
                                    }
                                >
                                    This clip is currently being processed. The editor is
                                    read-only until processing completes. Click "Refresh Status" to
                                    check if processing has finished.
                                </Alert>
                            )}

                        {/* Awaiting harvest: show a clear "what's happening" panel
                            instead of an editor that has nothing to load. */}
                        {clip && isAwaitingHarvest && (
                            <Alert
                                type="info"
                                header="Preparing video for editing"
                                action={
                                    <Button onClick={handleManualRefresh} ariaLabel="Refresh">
                                        Refresh
                                    </Button>
                                }
                            >
                                <SpaceBetween size="s">
                                    <Box variant="p">
                                        This clip hasn't been archived from the live stream yet.
                                        We've started a harvest in the background — editing will
                                        be available once at least one orientation
                                        ({missingOrientations.join(" / ")}) is ready. This usually
                                        takes about a minute.
                                    </Box>
                                    <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                                        <Spinner size="normal" />
                                        <Box variant="small">
                                            Checking automatically every few seconds — you can stay
                                            on this page or come back later.
                                        </Box>
                                    </SpaceBetween>
                                    {harvestError && (
                                        <Box variant="small" color="text-status-error">
                                            {harvestError}
                                        </Box>
                                    )}
                                </SpaceBetween>
                            </Alert>
                        )}

                        {/* Clip Editor — only render once at least one source is available. */}
                        {clip && editorReady && (
                            <ClipEditor
                                clipId={clip.id}
                                clipName={clip.name}
                                videoSrc={editorSource}
                                sourceKey={editorSource}
                                initialStartTime={clip.originalAssetId ? 0 : (clip.startTime || 0)}
                                initialEndTime={undefined}
                                onDiscard={handleDiscard}
                                isProcessing={clip.status === "edit_in_progress"}
                                viewOnly={isViewOnlyMode}
                                originalAssetId={clip.originalAssetId}
                            />
                        )}
                    </SpaceBetween>
                </Container>
            </SpaceBetween>
        </ContentLayout>
    );
};

export default ClipEditorPage;
