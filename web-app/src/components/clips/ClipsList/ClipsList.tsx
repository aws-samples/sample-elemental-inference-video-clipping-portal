import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Box, Button, Container, Header, Link, Modal, Select, SpaceBetween, StatusIndicator, } from "@cloudscape-design/components";
import { DataTable, TableColumn, useTableState } from "../../common/DataTable";
import { Clip } from "../../../types";
import { Copy, Download, Lock, SquarePen, Tag, Trash2, Unlock } from "lucide-react";
import downloadService, { DownloadStatus } from "../../../services/downloadService";
import dunkIcon from "../../../assets/dunk.jpeg";
import threePointerIcon from "../../../assets/3-pointer.jpeg";
import twoPointerIcon from "../../../assets/2-pointer.jpeg";

const CLIP_TYPE_ICONS: Record<string, string> = {
    dunk: dunkIcon,
    threepointer: threePointerIcon,
    twopointer: twoPointerIcon,
};

function getClipIcon(name: string): string | undefined {
    const lower = name.toLowerCase().replace(/[-_ ]/g, "");
    for (const [key, icon] of Object.entries(CLIP_TYPE_ICONS)) {
        if (lower.includes(key)) return icon;
    }
    return undefined;
}

interface ClipsListProps {
    title?: string;
    clips: Clip[];
    selectedClips: Clip[];
    loading?: boolean;
    tableSelection?: "multi" | "single";
    showActions?: boolean;
    showPublish?: boolean;
    showDownload?: boolean;
    showEditedOnly?: boolean;
    onPublishClips?: () => void;
    onViewClip?: (clip: Clip) => void;
    onEditClip?: (clip: Clip) => void;
    onFeedbackClip?: (clip: Clip) => void;
    onToggleLock?: (clip: Clip) => void;
    onDeleteClip?: (clip: Clip) => void;
    onSelectionChange?: (selectedClips: Clip[]) => void;
    onRefresh?: () => void;
}

const ClipsList: React.FC<ClipsListProps> = ({
    title = "Key Moments",
    clips,
    selectedClips,
    loading = false,
    tableSelection,
    showActions,
    showPublish=false,
    showDownload=false,
    showEditedOnly=false,
    onPublishClips,
    onViewClip,
    onEditClip,
    onFeedbackClip,
    onToggleLock,
    onDeleteClip,
    onSelectionChange,
    onRefresh,
}) => {
    // Search and filter state
    const [searchText] = useState("");
    const [statusFilter, setStatusFilter] = useState<{ label: string; value: string }>({
        label: "All Key Moments",
        value: "all",
    });
    const [downloadingClips, setDownloadingClips] = useState<Set<string>>(new Set());
    const [downloadStatuses, setDownloadStatuses] = useState<Map<string, DownloadStatus>>(new Map());
    const [requestingDownload, setRequestingDownload] = useState(false);
    const [downloadStatusRefresh, setDownloadStatusRefresh] = useState(0);
    const [alertMessage, setAlertMessage] = useState<{ type: "success" | "info" | "warning"; message: string } | null>(null);
    const [deleteConfirmClip, setDeleteConfirmClip] = useState<Clip | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const handleRefresh = () => {
        onSelectionChange?.([]);
        onRefresh?.();
        setDownloadStatusRefresh(prev => prev + 1);
    };

    const handleRequestDownload = async () => {
        if (selectedClips.length === 0) return;

        setRequestingDownload(true);
        setAlertMessage(null);
        try {
            const items = selectedClips.map(clip => ({ 
                id: clip.id, 
                type: "clip" as const 
            }));
            
            console.log("Sending items to API:", items);
            
            const response = await downloadService.createDownloadJobs(items, "both");
            
            console.log("Download jobs created:", response);
            
            // Build alert message
            const processedCount = response.processed.length;
            const skippedCount = response.skipped.length;
            const harvestingCount = response.processed.filter(p => p.status === "harvesting").length;
            const pendingCount = processedCount - harvestingCount;
            
            let message: string;
            if (harvestingCount > 0 && pendingCount > 0) {
                message = `Download preparation started. ${pendingCount} clip${pendingCount !== 1 ? 's' : ''} queued for transcoding, ${harvestingCount} clip${harvestingCount !== 1 ? 's' : ''} harvesting first.`;
            } else if (harvestingCount > 0) {
                message = `Download preparation started. ${harvestingCount} clip${harvestingCount !== 1 ? 's' : ''} are being harvested first — transcoding will begin automatically.`;
            } else {
                message = `${processedCount} clip${processedCount !== 1 ? 's' : ''} queued for download.`;
            }
            if (skippedCount > 0) {
                const uniqueReasons = [...new Set(response.skipped.map(s => s.reason))];
                message += ` ${skippedCount} skipped: ${uniqueReasons.join(', ')}`;
            }
            
            setAlertMessage({
                type: processedCount > 0 ? "success" : "warning",
                message
            });
            
            // Clear selection
            onSelectionChange?.([]);
            
            // Refresh clips to get updated downloadJobId
            setTimeout(() => {
                onRefresh?.();  
            }, 1000);
            
        } catch (error: any) {
            console.error("Failed to request downloads:", error);
            
            const apiMessage = error?.response?.data?.message;
            setAlertMessage({
                type: "warning",
                message: apiMessage || "Failed to request downloads. Please try again."
            });
        } finally {
            setRequestingDownload(false);
        }
    };

    const handleDownload = async (clip: Clip) => {
        if (!clip.downloadJobId) return;
        
        setDownloadingClips(prev => new Set(prev).add(clip.id));
        try {
            await downloadService.downloadClip(clip.downloadJobId, clip.name);
        } catch (error) {
            console.error("Download failed:", error);
        } finally {
            setDownloadingClips(prev => {
                const next = new Set(prev);
                next.delete(clip.id);
                return next;
            });
        }
    };

    const handleCopyLink = async (clip: Clip) => {
        const url = window.location.href + `?clipId=${clip.id}`;
        await navigator.clipboard.writeText(url);
        setAlertMessage({
            type: "success",
            message: "Link copied to clipboard"
        });
    };

    const handleConfirmDelete = async () => {
        if (!deleteConfirmClip || !onDeleteClip) return;
        setDeleteLoading(true);
        try {
            await onDeleteClip(deleteConfirmClip);
            setDeleteConfirmClip(null);
        } catch (error) {
            console.error("Delete clip failed:", error);
        } finally {
            setDeleteLoading(false);
        }
    };

    // Status filter options
    const statusFilterOptions = [
        { label: "All Key Moments", value: "all" },
        { label: "Processing", value: "processing" },
        { label: "Original", value: "original" },
        { label: "Completed", value: "completed" },
        { label: "Modified", value: "modified" },
        { label: "Review In Progress", value: "review_in_progress" },
        { label: "Discarded", value: "discarded" },
        { label: "Reviewed", value: "reviewed" },
        { label: "Published", value: "published" },
    ];

    // Filter and sort clips based on search text and status filter
    const filteredClips = useMemo(() => {
        let filtered = clips;

        // Apply search filter
        if (searchText) {
            const searchLower = searchText.toLowerCase();
            filtered = filtered.filter((clip) => clip.name.toLowerCase().includes(searchLower));
        }

        // Apply status filter
        if (statusFilter.value !== "all") {
            filtered = filtered.filter((event) => event.status === statusFilter.value);
        }

        // Sort by createdAt (latest first)
        filtered = [...filtered].sort((a, b) => {
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
        });
        if (!showEditedOnly) {
            // Reset children to avoid duplicates on re-render
            filtered.forEach((clip: any) => { clip.children = undefined; });
            filtered = filtered.map(( clip: any ) => {
                if (clip.originalAssetId) {
                    const originalClip: any = clips.find(( c: Clip ) => c.id === clip.originalAssetId);
                    if (originalClip) {
                        if (!originalClip.children) {
                            originalClip.children = [];
                        }
                        originalClip.children.push(clip);
                    }
                }
                return clip;
            }).filter(( clip: Clip ) => !clip.originalAssetId);
        }
        return filtered;
    }, [clips, searchText, showEditedOnly, statusFilter.value]);
    // Status indicator renderer
    const renderStatus = (clip: Clip) => {
        if (clip?.status) {
            const statusConfig = {
                published: { type: "success" as const, text: "Published" },
                reviewed: { type: "success" as const, text: "Reviewed" },
                ended: { type: "info" as const, text: "Ended" },
                processing: { type: "pending" as const, text: "Processing" },
                completed: { type: "success" as const, text: "Completed" },
                modified: { type: "warning" as const, text: "Modified" },
                edit_in_progress: { type: "pending" as const, text: "Editing In Progress" },
                review_in_progress: { type: "pending" as const, text: "Review In Progress" },
                discarded: { type: "error" as const, text: "Discarded" },
                original: { type: "info" as const, text: "Original" },
                detected: { type: "pending" as const, text: "Detected" },
                failed: { type: "error" as const, text: "Failed" },
            };

            const config = statusConfig?.[clip?.status] || { type: "info" as const, text: clip.status };
            return <StatusIndicator type={config.type}>{config.text}</StatusIndicator>;
        }
    };

    // Event name renderer with link
    const renderClipName = (clip: Clip) => {
        const isProcessing = clip.status === "processing";
        const icon = getClipIcon(clip.name);
        
        if (isProcessing) {
            return (
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#5f6b7a", textTransform: "capitalize" }}>
                    {icon && <img src={icon} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover" }} />}
                    {clip.name}
                </span>
            );
        }
        
        if (onViewClip) {
            return (
                <SpaceBetween size={"xxs"}>
                    <Link
                        href="#"
                        onFollow={(e) => {
                            e.preventDefault();
                            onViewClip(clip);
                        }}
                    >
                        <span style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "capitalize"}}>
                            {icon && <img src={icon} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover" }} />}
                            {clip.name} 
                            {clip.originalAssetId && <SquarePen style={{ fill: "#006ce0", color: "white"}} size={20}/>}
                            {clip.orientation && (
                                <Badge color={clip.orientation === "landscape" ? "blue" : "grey"}>
                                    {clip.orientation === "landscape" ? "Landscape" : "Portrait"}
                                </Badge>
                            )}
                        </span>
                    </Link>
                    <Box color="text-body-secondary" fontSize="body-s">{clip?.eventName}</Box>
                </SpaceBetween>
            );
        }
        return clip.name;
    };

    // Define table columns
    const columns: TableColumn<Clip>[] = [
        {
            key: "name",
            header: "Name",
            sortable: true,
            filterable: true,
            render: renderClipName,
        },
        {
            key: "description",
            header: "Description",
            sortable: true,
            render: () => "Video clip generated by AWS Elemental Inference",
        },
        {
            key: "tags",
            header: "Tags",
            sortable: true,
            filterable: true,
            minWidth: 200,
            render: (item) => {
                return (<SpaceBetween direction={"horizontal"} size="xxs">
                    {item.tags?.map((tag: string) => <Badge key={tag} color="blue">
                        <div style={{ display: "flex", alignItems: "center", gap: 4, textTransform: "capitalize" }}>
                            <Tag size={12} />{tag}
                        </div>
                    </Badge>)}
                    {item.customTags?.map((tag: string) => <Badge key={tag} color="green"> 
                        <div style={{ display: "flex", alignItems: "center", gap: 4, textTransform: "capitalize" }}>
                            <Tag size={12} />{tag}
                        </div>
                    </Badge>)}
                    </SpaceBetween>);
            },
        },
        //  {
        //     key: "format",
        //     header: "Format",
        //     filterable: true,
        //     sortable: true,
        //     minWidth: 150,
        //     render: (clip: Clip) => <SpaceBetween direction={"horizontal"} size={"xs"}>
        //          <Badge color={"severity-low"}>HLS</Badge>
        //          {clip.downloadJobId && <Badge color={"green"}>MP4</Badge>}
        //     </SpaceBetween>
        // },
        {
            key: "createdAt",
            header: "Created At",
            sortable: true,
            render: (clip: Clip) => {
                const date = new Date(clip.createdAt);
                return new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "long",
                }).format(date)
            }
        },
        {
            key: "duration",
            header: "Duration",
            sortable: true,
            render: (clip: Clip) => `${clip.duration}s`,
        },
        ...(showDownload ? [{
            key: "downloadStatus",
            header: "Transcode Status",
            sortable: false,
            render: (clip: Clip) => {
                if (!clip.downloadJobId) {
                    return <StatusIndicator type="info">Not Requested</StatusIndicator>;
                }
                
                const status = downloadStatuses.get(clip.downloadJobId);
                
                if (status === "completed") {
                    return <StatusIndicator type="success">Complete</StatusIndicator>;
                }
                if (status === "harvesting") {
                    return <StatusIndicator type="pending">Harvesting</StatusIndicator>;
                }
                if (status === "pending" || status === "processing") {
                    return <StatusIndicator type="in-progress">Processing</StatusIndicator>;
                }
                if (status === "failed") {
                    return <StatusIndicator type="error">Failed</StatusIndicator>;
                }
                return <StatusIndicator type="pending">Queued</StatusIndicator>;
            },
        }] : []),
        {
            key: "status",
            header: "Harvest Status",
            sortable: true,
            filterable: true,
            render: (clip: Clip) => {
                const statusMap: Record<string, { type: "success" | "pending" | "info" | "error"; text: string }> = {
                    archived: { type: "success", text: "Harvested" },
                    detected: { type: "pending", text: "Pending" },
                    processing: { type: "pending", text: "Processing" },
                    failed: { type: "error", text: "Failed" },
                };
                const config = statusMap[clip.status] || { type: "info", text: "Not Requested" };
                return <StatusIndicator type={config.type}>{config.text}</StatusIndicator>;
            },
        },
        {
            key: "actions",
            header: "Actions",
            sortable: false,
            filterable: false,
            minWidth: 150,
            render: (clip: Clip) => {
                const downloadStatus = clip.downloadJobId ? downloadStatuses.get(clip.downloadJobId) : undefined;
                const canDownload = showDownload && downloadStatus === "completed";
                const isDownloading = downloadingClips.has(clip.id);
                const isLocked = clip.locked || false;
                
                return (
                    <SpaceBetween size={"xs"} direction={"horizontal"}>
                        <Button
                            iconSvg={isLocked ? <Lock strokeWidth={3} /> : <Unlock strokeWidth={3} />}
                            variant="inline-icon"
                            ariaLabel={isLocked ? `Unlock ${clip.name}` : `Lock ${clip.name}`}
                            disabled={["processing", "review_in_progress"].includes(clip.status)}
                            onClick={() => onToggleLock?.(clip)}
                        />
                        <Button
                            iconName="edit"
                            variant="inline-icon"
                            ariaLabel={`Edit ${clip.name}`}
                            disabled={isLocked || ["processing", "review_in_progress"].includes(clip.status)}
                            onClick={() => onEditClip?.(clip)}
                        />
                        <Button
                            iconSvg={<Copy strokeWidth={3} />}
                            variant="inline-icon"
                            ariaLabel={`share ${clip.name}`}
                            onClick={() => handleCopyLink(clip)}
                        />
                        {canDownload && (
                            <Button
                                iconSvg={<Download strokeWidth={3} />}
                                variant="inline-icon"
                                ariaLabel={`Download ${clip.name}`}
                                loading={isDownloading}
                                onClick={() => handleDownload(clip)}
                            />
                        )}
                        {onDeleteClip && (
                            <Button
                                iconSvg={<Trash2 strokeWidth={3} />}
                                variant="inline-icon"
                                ariaLabel={`Delete ${clip.name}`}
                                disabled={isLocked}
                                onClick={() => setDeleteConfirmClip(clip)}
                            />
                        )}
                    </SpaceBetween>
                );
            },
        },
    ];

    if (!showActions) {
        columns.pop();
    }

    // Table state management with filtered data
    const {
        paginatedData: paginatedClips,
        pagination,
        sorting,
        filtering,
    } = useTableState({
        data: filteredClips,
        columns,
        pageSize: 10,
        defaultSortColumn: columns.find(col => col.key === 'createdAt') || columns[0],
        defaultSortDescending: true,
        placeholder: "Find available key moments",
    });

    // Fetch download statuses for clips on current page
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchDownloadStatuses = useCallback(async () => {
        const jobIds = paginatedClips
            .map(clip => clip.downloadJobId)
            .filter((id): id is string => !!id);

        if (jobIds.length === 0) {
            return;
        }

        const statusMap = new Map<string, DownloadStatus>();

        await Promise.all(
            jobIds.map(async (jobId) => {
                try {
                    const resp = await downloadService.getDownloadJobStatus(jobId);
                    statusMap.set(jobId, resp.status);
                } catch (error: any) {
                    if (error.response?.status === 404) {
                        statusMap.set(jobId, "failed");
                    } else {
                        statusMap.set(jobId, "pending");
                    }
                }
            })
        );

        setDownloadStatuses(statusMap);
    }, [paginatedClips.map(c => `${c.id}-${c.downloadJobId}`).join(",")]);

    // Initial fetch + polling for non-terminal statuses
    useEffect(() => {
        fetchDownloadStatuses();
    }, [fetchDownloadStatuses, downloadStatusRefresh]);

    useEffect(() => {
        const nonTerminalStatuses: DownloadStatus[] = ["harvesting", "pending", "processing"];
        const hasActiveJobs = Array.from(downloadStatuses.values()).some(s => nonTerminalStatuses.includes(s));

        if (hasActiveJobs) {
            if (!pollingRef.current) {
                pollingRef.current = setInterval(fetchDownloadStatuses, 5000);
            }
        } else {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
        }

        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
        };
    }, [downloadStatuses, fetchDownloadStatuses]);

    return (
        <Container
            header={
                <Header
                    variant="h2"
                    counter={`(${filteredClips.length})`}
                    description={
                        "Key moments generated by Inference for selected events."
                    }
                    actions={
                        <SpaceBetween size={"xs"} direction={"horizontal"}>
                            <Button
                                iconName="refresh"
                                onClick={handleRefresh}
                                loading={loading}
                                ariaLabel="Refresh key moments"
                            >
                                Refresh
                            </Button>
                            {showDownload && <Button
                                disabled={selectedClips.length === 0}
                                iconName="download"
                                onClick={handleRequestDownload}
                                loading={requestingDownload}
                                ariaLabel="Prepare Download"
                            >
                                Prepare Download
                            </Button>}
                            {showPublish && <Button
                                disabled={selectedClips.length === 0 || selectedClips.some((clip: Clip) => !clip.downloadJobId)}
                                variant="primary"
                                iconName={"upload"}
                                onClick={onPublishClips}
                                ariaLabel="Publish Clips"
                            >
                                Publish Clips
                            </Button>}
                        </SpaceBetween>
                    }
                >
                    {title}
                </Header>
            }
        >
            <SpaceBetween size="l">
                {alertMessage && (
                    <Alert
                        type={alertMessage.type}
                        dismissible
                        onDismiss={() => setAlertMessage(null)}
                    >
                        {alertMessage.message}
                    </Alert>
                )}
                <DataTable
                    data={paginatedClips}
                    columns={columns}
                    loading={loading}
                    pagination={pagination}
                    sorting={sorting}
                    selectedItems={selectedClips || []}
                    empty={
                        <Box textAlign="center" color="inherit">
                            <b>No clips found</b>
                            <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                                {searchText || statusFilter.value !== "all"
                                    ? "No clips match your search criteria. Try adjusting your filters."
                                    : "No clips to display."}
                            </Box>
                        </Box>
                    }
                    ariaLabel="Key moments table"
                    filtering={filtering}
                    statusFilter={
                        <div style={{ width: 200 }}>
                            <Select
                                selectedOption={statusFilter}
                                onChange={({ detail }) => {
                                    if (detail.selectedOption) {
                                        setStatusFilter(
                                            detail.selectedOption as {
                                                label: string;
                                                value: string;
                                            },
                                        );
                                    }
                                }}
                                options={statusFilterOptions}
                                placeholder="Filter by status"
                                ariaLabel="Filter clips by status"
                            />
                        </div>
                    }
                    tableSelection={tableSelection ?? "multi"}
                    onSelectionChange={onSelectionChange}
                />
            </SpaceBetween>
            <Modal
                visible={deleteConfirmClip !== null}
                onDismiss={() => setDeleteConfirmClip(null)}
                header="Delete Clip"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={() => setDeleteConfirmClip(null)} disabled={deleteLoading}>
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
                        Are you sure you want to delete <b>{deleteConfirmClip?.name}</b>?
                    </Box>
                </SpaceBetween>
            </Modal>
        </Container>
    );
};

export default ClipsList;
