import { Alert, Badge, Box, Button, Container, FormField, Header, Input, Modal, SegmentedControl, SpaceBetween, StatusIndicator } from "@cloudscape-design/components";
import { Lock, Save, Tag, Trash2, Unlock, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ApiService from "../../../services/apiService";
import VideoService from "../../../services/videoService";
import settingsService from "../../../services/settingsService";
import { Clip, Event } from "../../../types";
import OmakaseVideoPlayer from "../../common/OmakasePlayer/OmakasePlayer";
import { OmakaseVideoPlayerRef } from "../../common/OmakasePlayer/OmakasePlayer.tsx";
import DualPlayerPreview, { DUAL_PLAYER_MODAL_CLASS } from "../../common/DualPlayerPreview";
import downloadService, { DownloadStatus } from "../../../services/downloadService.ts";

interface OrientationDownloadState {
    jobId: string;
    orientation: string;
    status: DownloadStatus;
    errorMessage?: string;
    executionArn?: string;
}

interface ViewClipProps {
    clip: Clip | undefined;
    showDialog: boolean;
    viewOnly?: boolean;
    setShowDialog: (showDialog: boolean) => void;
    onEditClip: (clip: Clip | undefined) => void;
    onFeedbackClip: (clip: Clip | undefined) => void;
    onToggleLock?: (clip: Clip | undefined) => void;
    onDeleteClip?: (clip: Clip | undefined) => void;
    onRefresh: () => void;
}

const POLL_INTERVAL_MS = 5000;

const ViewClip: React.FC<ViewClipProps> = ({
    clip,
    showDialog,
    viewOnly = false,
    setShowDialog,
    onEditClip,
    onFeedbackClip,
    onToggleLock,
    onDeleteClip,
    onRefresh,
}) => {
    const [event, setEvent] = useState<Event | undefined>();
    const [tagText, setTagText] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [videoUrl, setVideoUrl] = useState<string>("");
    const [landscapeVideoUrl, setLandscapeVideoUrl] = useState<string>("");
    const [verticalVideoUrl, setVerticalVideoUrl] = useState<string>("");
    const [dualMode, setDualMode] = useState(false);
    const [viewMode, setViewMode] = useState<'dual' | 'single'>('dual');
    const [isLoadingVideo, setIsLoadingVideo] = useState(false);
    const [isUsingTimeShift, setIsUsingTimeShift] = useState(false);
    const omakaseVideoPlayerRef = useRef<OmakaseVideoPlayerRef>(null);
    const [requestingDownload, setRequestingDownload] = useState(false);
    const [currentClip, setCurrentClip] = useState<Clip | undefined>(clip);
    const apiService = ApiService.getInstance();
    const videoService = VideoService.getInstance();

    // New download state for per-orientation tracking
    const [orientationDownloads, setOrientationDownloads] = useState<OrientationDownloadState[]>([]);
    const [downloadError, setDownloadError] = useState<string | undefined>();
    const [executionArn, setExecutionArn] = useState<string | undefined>();
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const [autoHarvestEnabled, setAutoHarvestEnabled] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);

    // Update local clip state when prop changes
    useEffect(() => {
        setCurrentClip(clip);
    }, [clip]);

    // Cleanup polling on unmount or dialog close
    useEffect(() => {
        if (!showDialog) {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            setOrientationDownloads([]);
            setDownloadError(undefined);
            setExecutionArn(undefined);
        }
        return () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [showDialog]);

    const commitTag = () => {
        const trimmed = tagText.trim();
        if (trimmed && !tags.includes(trimmed)) {
            setTags([...tags, trimmed]);
        }
        setTagText("");
    };

    const handleAddTag = ({ detail }: any) => {
        if (detail.key === "Enter" || detail.key === ",") {
            commitTag();
        }
    };

    const handleTagBlur = () => {
        if (tagText.trim()) {
            commitTag();
        }
    };

    // Fetch auto-harvest setting when dialog opens
    useEffect(() => {
        if (!showDialog) return;
        const loadSettings = async () => {
            try {
                const result = await settingsService.getSetting("autoHarvest").catch(() => null);
                setAutoHarvestEnabled(result?.settingValue === "true");
            } catch (e) {
                console.warn("Failed to load auto-harvest setting:", e);
            }
        };
        loadSettings();
    }, [showDialog]);

    // Build S3 path for a specific clip + orientation
    const getClipHarvestPath = (orientation: "landscape" | "portrait"): string | null => {
        if (!currentClip?.mediaLiveChannel || !currentClip?.id) return null;
        const createdDate = currentClip.createdAt
            ? new Date(currentClip.createdAt).toISOString().slice(0, 10)
            : "unknown-date";
        try {
            const bucket = videoService.getVideoAssetsBucket();
            return `s3://${bucket}/harvested-clips/${currentClip.mediaLiveChannel}/${createdDate}/${currentClip.id}/${orientation}/`;
        } catch {
            return `harvested-clips/${currentClip.mediaLiveChannel}/${createdDate}/${currentClip.id}/${orientation}/`;
        }
    };

    // Legacy download for clips that already have a downloadJobId
    const handleLegacyDownload = async (clip: Clip) => {
        if (!clip.downloadJobId) return;
        try {
            setRequestingDownload(true);
            await downloadService.downloadClip(clip.downloadJobId, clip.name);
        } catch (error) {
            console.error("Download failed:", error);
        } finally {
            setRequestingDownload(false);
        }
    };

    // Poll download status for all in-progress orientation jobs
    const pollDownloadStatuses = useCallback(async (downloads: OrientationDownloadState[]) => {
        const inProgress = downloads.filter(d => d.status === "processing" || d.status === "harvesting");
        if (inProgress.length === 0) {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            return;
        }

        const updated = await Promise.all(
            downloads.map(async (dl) => {
                if (dl.status === "completed" || dl.status === "failed") return dl;
                try {
                    const statusResp = await downloadService.getDownloadJobStatus(dl.jobId);
                    return { ...dl, status: statusResp.status, errorMessage: statusResp.errorMessage };
                } catch {
                    return dl;
                }
            })
        );
        setOrientationDownloads(updated);

        // Stop polling if all done
        const stillInProgress = updated.some(d => d.status === "processing" || d.status === "harvesting");
        if (!stillInProgress && pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }
    }, []);

    // Start a new download via the Download API
    const handlePrepareDownload = async (orientation: 'landscape' | 'portrait' | 'both') => {
        if (!currentClip) return;
        setDownloadError(undefined);
        setRequestingDownload(true);

        console.log(`Download initiated for clip ${currentClip.id}, orientation: ${orientation}`);

        try {
            const response = await downloadService.createDownloadJobs(
                [{ id: currentClip.id, type: "clip" }],
                orientation
            );

            if (response.processed.length > 0) {
                const jobId = response.processed[0].jobId;
                const execArn = response.processed[0].executionArn;

                // Create separate tracking entries for each orientation
                const orientations = orientation === "both" ? ["landscape", "portrait"] : [orientation];
                const newDownloads: OrientationDownloadState[] = orientations.map(o => ({
                    jobId,
                    orientation: o,
                    status: "processing" as DownloadStatus,
                    executionArn: execArn,
                }));

                if (execArn) {
                    setExecutionArn(execArn);
                }

                setOrientationDownloads(prev => {
                    return [...newDownloads];
                });

                // Start polling
                if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                pollTimerRef.current = setInterval(() => {
                    pollDownloadStatuses(newDownloads);
                }, POLL_INTERVAL_MS);
            }

            if (response.skipped.length > 0) {
                setDownloadError(response.skipped.map(s => `${s.id}: ${s.reason}`).join(", "));
            }
        } catch (error: any) {
            console.error("Prepare download failed:", error);
            setDownloadError(error.message || "Failed to start download");
        } finally {
            setRequestingDownload(false);
        }
    };

    // Download a completed orientation's MP4
    const handleOrientationDownload = async (dl: OrientationDownloadState) => {
        try {
            const orientationLabel = dl.orientation === "landscape" ? "landscape" : "portrait";
            await downloadService.downloadClip(dl.jobId, `${currentClip?.name}-${orientationLabel}`);
        } catch (error) {
            console.error("Download failed:", error);
        }
    };

    // Retry a failed download
    const handleRetry = async (dl: OrientationDownloadState) => {
        const orientation = dl.orientation as 'landscape' | 'portrait';
        await handlePrepareDownload(orientation);
    };

    const handleToggleLock = async () => {
        if (!currentClip) return;
        setCurrentClip({ ...currentClip, locked: !currentClip.locked });
        await onToggleLock?.(currentClip);
    };

    const handleConfirmDelete = async () => {
        if (!currentClip || !onDeleteClip) return;
        setDeleteLoading(true);
        try {
            await onDeleteClip(currentClip);
            setShowDeleteConfirm(false);
            setShowDialog(false);
        } catch (error) {
            console.error("Delete clip failed:", error);
        } finally {
            setDeleteLoading(false);
        }
    };

    // Render per-orientation download status indicator
    const renderOrientationStatus = (status: DownloadStatus) => {
        switch (status) {
            case "harvesting":
                return <StatusIndicator type="in-progress">Harvesting</StatusIndicator>;
            case "processing":
                return <StatusIndicator type="in-progress">Transcoding</StatusIndicator>;
            case "completed":
                return <StatusIndicator type="success">Completed</StatusIndicator>;
            case "failed":
                return <StatusIndicator type="error">Failed</StatusIndicator>;
            default:
                return <StatusIndicator type="pending">Pending</StatusIndicator>;
        }
    };

    // Status indicator renderer
    const renderClipStatus = (status: string | undefined) => {
        const statusConfig: any = {
            reviewed: { type: "success" as const, text: "Reviewed" },
            ended: { type: "info" as const, text: "Ended" },
            scheduled: { type: "pending" as const, text: "Scheduled" },
            processing: { type: "pending" as const, text: "Processing" },
            completed: { type: "success" as const, text: "Completed" },
            modified: { type: "warning" as const, text: "Modified" },
            review_in_progress: { type: "pending" as const, text: "Review In Progress" },
            discarded: { type: "error" as const, text: "Discarded" },
            original: { type: "info" as const, text: "Original" },
            detected: { type: "pending" as const, text: "Detected" },
            archived: { type: "info" as const, text: "Archived" },
        };
        const config = statusConfig[status ?? "original"] || {
            type: "info" as const,
            text: status || "Unknown",
        };
        return <StatusIndicator type={config.type}>{config.text}</StatusIndicator>;
    };

    // Render harvest status badges from harvestedOrientations
    const renderHarvestStatus = () => {
        const harvested = Array.from(currentClip?.harvestedOrientations ?? []);
        return (
            <SpaceBetween direction="horizontal" size="xs">
                <Badge color={harvested.includes("landscape") ? "green" : "grey"}>
                    Landscape {harvested.includes("landscape") ? "✓" : "—"}
                </Badge>
                <Badge color={harvested.includes("portrait") ? "green" : "grey"}>
                    Portrait {harvested.includes("portrait") ? "✓" : "—"}
                </Badge>
            </SpaceBetween>
        );
    };

    // Render the per-orientation download section
    const renderDownloadSection = () => {
        if (viewOnly || currentClip?.status === "review_in_progress") return null;

        const hasActiveDownloads = orientationDownloads.length > 0;

        return (
            <SpaceBetween size="s">
                {/* Execution ARN reference */}
                {executionArn && (
                    <FormField label="Tracking Reference" description="Step Functions execution ARN">
                        <Box variant="code" fontSize="body-s">
                            {executionArn}
                        </Box>
                    </FormField>
                )}

                {/* Error alert with retry */}
                {downloadError && (
                    <Alert type="error" dismissible onDismiss={() => setDownloadError(undefined)}>
                        {downloadError}
                    </Alert>
                )}

                {/* Per-orientation status display */}
                {hasActiveDownloads && (
                    <SpaceBetween size="xs">
                        {orientationDownloads.map((dl) => (
                            <div key={dl.jobId} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <Badge color="blue">{dl.orientation}</Badge>
                                {renderOrientationStatus(dl.status)}
                                {dl.status === "completed" && (
                                    <Button
                                        variant="inline-link"
                                        iconName="download"
                                        onClick={() => handleOrientationDownload(dl)}
                                        ariaLabel={`Download ${dl.orientation}`}
                                    >
                                        Download
                                    </Button>
                                )}
                                {dl.status === "failed" && (
                                    <SpaceBetween direction="horizontal" size="xs">
                                        {dl.errorMessage && (
                                            <Box variant="small" color="text-status-error">{dl.errorMessage}</Box>
                                        )}
                                        <Button
                                            variant="inline-link"
                                            iconName="refresh"
                                            onClick={() => handleRetry(dl)}
                                            ariaLabel={`Retry ${dl.orientation}`}
                                        >
                                            Retry
                                        </Button>
                                    </SpaceBetween>
                                )}
                            </div>
                        ))}
                    </SpaceBetween>
                )}

                {/* Create MP4 / Download buttons rendered in footer */}
            </SpaceBetween>
        );
    };

    const onSaveClip = () => {
        if (!currentClip) return;
        const updatedClip: Clip = { ...currentClip, customTags: tags };
        apiService.updateClip(updatedClip).then(() => {
            setShowDialog(false);
            onRefresh();
        });
    };

    useEffect(() => {
        setTags(currentClip?.customTags || []);
        const getEvent = async () => {
            if (!currentClip?.eventId || currentClip.eventId === "unknown") {
                setEvent(undefined);
                return;
            }
            try {
                const event = await apiService.getEvent(currentClip.eventId);
                setEvent(event);
            } catch {
                console.warn("Event not found for clip:", currentClip.eventId);
                setEvent(undefined);
            }
        };
        getEvent().then();
    }, [currentClip, apiService]);

    // Retrieve the timeshifted manifest URL for viewing clip
    useEffect(() => {
        const getVideoUrl = async () => {
            if (!showDialog || !currentClip) {
                setVideoUrl("");
                setIsUsingTimeShift(false);
                return;
            }
            if (!currentClip.sourceKey && !currentClip.startTime) {
                setVideoUrl("");
                setIsUsingTimeShift(false);
                return;
            }
            setIsLoadingVideo(true);
            try {
                let url: string | undefined;
                let usingTimeShift = false;

                if (currentClip.status === "modified" && currentClip.sourceKey) {
                    url = await videoService.getClipHlsUrl(currentClip.sourceKey);
                    usingTimeShift = false;
                } else if (currentClip.startTime && videoService.isWithinTimeShiftWindow(currentClip.startTime)) {
                    try {
                        const channel = await apiService.getChannel(currentClip.mediaLiveChannel);
                        if (channel?.manifestUrl || channel?.landscapeManifestUrl) {
                            const landscapeUrl = channel.landscapeManifestUrl || channel.manifestUrl;
                            url = videoService.getTimeShiftUrl(landscapeUrl, currentClip.startTime, currentClip.endTime);
                            if (channel.verticalManifestUrl) {
                                const vertUrl = videoService.getTimeShiftUrl(channel.verticalManifestUrl, currentClip.startTime, currentClip.endTime);
                                setVerticalVideoUrl(vertUrl);
                            }
                            setLandscapeVideoUrl(url);
                            usingTimeShift = true;
                        } else {
                            throw new Error("Channel manifest URL not available");
                        }
                    } catch (timeShiftError) {
                        console.warn("Time-shift failed, falling back to S3:", timeShiftError);
                        if (currentClip.sourceKey) {
                            url = await videoService.getClipHlsUrl(currentClip.sourceKey);
                        }
                        usingTimeShift = false;
                    }
                } else if (currentClip.sourceKey) {
                    url = await videoService.getClipHlsUrl(currentClip.sourceKey);
                    usingTimeShift = false;
                }
                setVideoUrl(url || "");
                setIsUsingTimeShift(usingTimeShift);
            } catch (error) {
                console.error("Failed to get video URL:", error);
            } finally {
                setIsLoadingVideo(false);
            }
        };
        getVideoUrl().then();
    }, [currentClip?.id, currentClip?.sourceKey, currentClip?.status, showDialog, videoService, apiService]);

    return (
        <>
        <Modal
            size={"large"}
            header={
                <Header variant="h2" description={"This Video clip was generated by AWS Elemental Inference"}>
                    <span style={{ textTransform: "capitalize"}}>{currentClip?.name}</span>
                </Header>
            }
            footer={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    {viewOnly && (
                        <>
                            <div />
                            <Button variant="normal" iconName="close" onClick={() => setShowDialog(false)} ariaLabel="Close">
                                Close
                            </Button>
                        </>
                    )}
                    {!viewOnly && currentClip?.status !== "review_in_progress" && (
                        <>
                            <SpaceBetween direction="horizontal" size="xs">
                                {/* Download MP4 — direct presigned URL download when mp4Key exists */}
                                {currentClip?.mp4Key && (
                                    <Button
                                        variant="primary"
                                        iconName="download"
                                        onClick={() => downloadService.downloadMp4Direct(currentClip.mp4Key!, currentClip.name)}
                                        ariaLabel="Download MP4"
                                    >
                                        Download MP4
                                    </Button>
                                )}
                                {/* Create MP4 — triggers Download Workflow state machine */}
                                {orientationDownloads.length === 0 && (
                                    <Button
                                        loading={requestingDownload}
                                        variant="normal"
                                        iconName="download"
                                        onClick={() => handlePrepareDownload("both")}
                                        disabled={!!currentClip?.mp4Key}
                                        ariaLabel="Create MP4"
                                    >
                                        Create MP4
                                    </Button>
                                )}
                                {/* Legacy download button for backward compatibility */}
                                {currentClip?.downloadJobId && orientationDownloads.length === 0 && (
                                    <Button
                                        loading={requestingDownload}
                                        variant="normal"
                                        iconName="download"
                                        onClick={() => handleLegacyDownload(currentClip)}
                                        ariaLabel="Download"
                                    >
                                        Download
                                    </Button>
                                )}
                                <Button
                                    variant="normal"
                                    iconSvg={currentClip?.locked ? <Unlock size={18} /> : <Lock size={18} />}
                                    onClick={handleToggleLock}
                                    ariaLabel={currentClip?.locked ? "Unlock" : "Lock"}
                                >
                                    {currentClip?.locked ? "Unlock" : "Lock"}
                                </Button>
                                <Button
                                    variant="normal"
                                    iconName="edit"
                                    onClick={() => onEditClip(currentClip)}
                                    disabled={currentClip?.locked}
                                    ariaLabel="Edit"
                                >
                                    Edit
                                </Button>
                                {onDeleteClip && (
                                    <Button
                                        variant="normal"
                                        iconSvg={<Trash2 size={18} />}
                                        onClick={() => setShowDeleteConfirm(true)}
                                        disabled={currentClip?.locked}
                                        ariaLabel="Delete"
                                    >
                                        Delete
                                    </Button>
                                )}
                            </SpaceBetween>
                            <Button variant="normal" iconSvg={<Save size={18} />} onClick={onSaveClip} ariaLabel="Close">
                                Close
                            </Button>
                        </>
                    )}
                </div>
            }
            onDismiss={() => setShowDialog(false)}
            visible={showDialog}
            className={`custom-modal${dualMode ? ` ${DUAL_PLAYER_MODAL_CLASS}` : ''}`}
        >
            <SpaceBetween size="s">
                <Container>
                    <SpaceBetween size="l">
                        <div style={{ display: 'flex', justifyContent: 'space-evenly', textAlign: 'center' }}>
                            {event && (
                                <FormField label="Event Name" description="Source event of the clip.">
                                    {event.name}
                                </FormField>
                            )}
                            <FormField label="Clip Status" description="Status for the clip.">
                                {renderClipStatus(currentClip?.status)}
                            </FormField>
                            <FormField label="Harvest Status" description="Orientations archived to S3.">
                                {renderHarvestStatus()}
                            </FormField>
                            <FormField label="Available Formats" description="Generated clip in listed formats.">
                                <SpaceBetween direction="horizontal" size="xs">
                                    <Badge color="severity-low">HLS</Badge>
                                    <Badge color={currentClip?.mp4Key ? "green" : "grey"}>MP4</Badge>
                                </SpaceBetween>
                            </FormField>
                            {isUsingTimeShift && verticalVideoUrl && (
                                <FormField label="Preview Mode">
                                    <SegmentedControl
                                        selectedId={viewMode}
                                        onChange={({ detail }) => {
                                            const mode = detail.selectedId as 'dual' | 'single';
                                            setViewMode(mode);
                                            setDualMode(mode === 'dual');
                                        }}
                                        options={[
                                            { id: 'dual', text: 'Dual' },
                                            { id: 'single', text: 'Single' },
                                        ]}
                                    />
                                </FormField>
                            )}
                        </div>

                        {/* Download section */}
                        {!viewOnly && renderDownloadSection()}

                        {/* Video player */}
                        {videoUrl && showDialog && !isLoadingVideo && (
                            isUsingTimeShift ? (
                                <DualPlayerPreview
                                    landscapeUrl={landscapeVideoUrl}
                                    portraitUrl={verticalVideoUrl}
                                    autoplay={false}
                                    viewMode={viewMode}
                                    onViewModeChange={(mode) => {
                                        setViewMode(mode);
                                        setDualMode(mode === 'dual');
                                    }}
                                />
                            ) : (
                                <OmakaseVideoPlayer
                                    videoSrc={videoUrl}
                                    ref={omakaseVideoPlayerRef}
                                    segments={[]}
                                />
                            )
                        )}
                        {isLoadingVideo && showDialog && (
                            <Box textAlign="center" padding="l">
                                <StatusIndicator type="loading">Loading video...</StatusIndicator>
                            </Box>
                        )}

                        {/* Tags section */}
                        <SpaceBetween size="xs">
                            {!viewOnly && currentClip?.status !== "review_in_progress" && (
                                <FormField label="Tags" description="Type a tag and press Enter, comma, or click away to add">
                                    <Input
                                        placeholder="Add a tag"
                                        value={tagText}
                                        onChange={({ detail }) => {
                                            if (detail.value.includes(",")) {
                                                const val = detail.value.replace(",", "").trim();
                                                if (val && !tags.includes(val)) {
                                                    setTags([...tags, val]);
                                                }
                                                setTagText("");
                                            } else {
                                                setTagText(detail.value);
                                            }
                                        }}
                                        onKeyDown={handleAddTag}
                                        onBlur={handleTagBlur}
                                    />
                                </FormField>
                            )}
                            {(viewOnly || currentClip?.status === "review_in_progress") && (
                                <FormField label="Tags" description="Available tags for the clip" />
                            )}
                            <SpaceBetween size="xxs" direction="horizontal">
                                {[...(currentClip?.tags ?? [])].map((tag: string, index: number) => (
                                    <div key={`clip-tag-${index}-${tag}`} style={{
                                        fontSize: 12, display: "flex", alignItems: "center",
                                        background: "#006ce0", borderRadius: 8, color: "#fff",
                                        padding: "4px 8px", gap: 2, marginBottom: 2, textTransform: "capitalize"
                                    }}>
                                        <Tag size={14} /> {tag}
                                    </div>
                                ))}
                                {[...tags].map((tag: string, index: number) => (
                                    <div key={`custom-tag-${index}-${tag}`} style={{
                                        fontSize: 12, display: "flex", alignItems: "center",
                                        background: "#1a7302", borderRadius: 8, color: "#fff",
                                        padding: "4px 8px", cursor: "pointer", marginBottom: 2, gap: 8
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 2, textTransform: "capitalize" }}>
                                            <Tag size={14} />{tag}
                                        </div>
                                        {currentClip?.status !== "review_in_progress" && (
                                            <X size={14} onClick={() => {
                                                setTags(tags.filter((t) => t !== tag));
                                                setTagText("");
                                            }} />
                                        )}
                                    </div>
                                ))}
                            </SpaceBetween>
                        </SpaceBetween>
                    </SpaceBetween>
                </Container>
            </SpaceBetween>
        </Modal>
        <Modal
            visible={showDeleteConfirm}
            onDismiss={() => setShowDeleteConfirm(false)}
            header="Delete Clip"
            footer={
                <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                        <Button variant="link" onClick={() => setShowDeleteConfirm(false)} disabled={deleteLoading}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={handleConfirmDelete} loading={deleteLoading}>
                            Delete
                        </Button>
                    </SpaceBetween>
                </Box>
            }
        >
            <SpaceBetween size="m">
                <Alert type="warning">
                    This will remove the clip record. Harvested video files in S3 will be cleaned up by lifecycle policies.
                </Alert>
                <Box>
                    Are you sure you want to delete <b>{currentClip?.name}</b>?
                </Box>
            </SpaceBetween>
        </Modal>
        </>
    );
};

export default ViewClip;
