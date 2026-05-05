import {
    Badge,
    Box,
    Button,
    Container,
    Header,
    ProgressBar,
    SpaceBetween,
    Spinner,
    StatusIndicator
} from "@cloudscape-design/components";
import { RefreshCw } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import useJobs from "../../../hooks/useJobs";
import { VideoProcessingJob, VideoProcessingStatus } from "../../../types";
import { DataTable, TableColumn, useTableState } from "../DataTable";
import "./VideoProcessingTable.css";

export interface VideoProcessingTableProps {
    showAll?: boolean;
    clipId?: string;
    refreshInterval?: number;
    onJobSelect?: (job: VideoProcessingJob) => void;
}

export const VideoProcessingTable: React.FC<VideoProcessingTableProps> = ({
    showAll = false,
    clipId,
    refreshInterval = 5000,
    onJobSelect,
}) => {
    const { jobs, loading, fetchJobs } = useJobs();
    const [filteredJobs, setFilteredJobs] = useState<VideoProcessingJob[]>([]);
    const jobsRef = useRef<VideoProcessingJob[]>([]);

    const handleRefresh = async () => {
        await fetchJobs();
    };

    useEffect(() => {
        handleRefresh();
    }, [fetchJobs]); // Depend on the memoized fetchJobs function

    useEffect(() => {
        if (!showAll) {
            const filteredJobs = jobs.filter((job) => job.originalAssetId === clipId);
            setFilteredJobs(filteredJobs);
        } else {
            setFilteredJobs(jobs);
        }
    }, [jobs, showAll]);
    // Separate effect for auto-refresh to avoid infinite loops
    useEffect(() => {
        const interval = setInterval(() => {
            // Use ref to get current jobs without causing re-renders
            const hasActiveJobs = jobsRef.current.some(
                (job) => job.status === "pending" || job.status === "processing"
            );
            if (hasActiveJobs) {
                fetchJobs();
            }
        }, refreshInterval);

        return () => clearInterval(interval);
    }, [refreshInterval]); // Only depend on refresh interval

    const getStatusIndicator = (status: VideoProcessingStatus) => {
        switch (status) {
            case "completed":
                return <StatusIndicator type="success">Completed</StatusIndicator>;
            case "processing":
                return <SpaceBetween direction="horizontal" size="xs"><Spinner />Processing</SpaceBetween>;
            case "pending":
                return <StatusIndicator type="pending">Pending</StatusIndicator>;
            case "failed":
                return <StatusIndicator type="error">Failed</StatusIndicator>;
            case "cancelled":
                return <StatusIndicator type="stopped">Cancelled</StatusIndicator>;
            default:
                return <StatusIndicator type="info">Unknown</StatusIndicator>;
        }
    };

    const formatTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
        }
        return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    };

    const formatDateTime = (isoString: string): string => {
        const date = new Date(isoString);
        return date.toLocaleString();
    };

    const getOperationsSummary = (job: VideoProcessingJob): string => {
        if (!job.parameters || !job.parameters.operations) {
            return "Generate Reels";
        }
        
        const operations = job.parameters.operations.filter((op) => op.enabled);
        if (operations.length === 0) return "Generate Reels";

        return operations
            .map((op) => {
                switch (op.type) {
                    case "trim":
                        return `Trim (${formatTime(op.startTime)}-${formatTime(op.endTime)})`;
                    case "split":
                        return `Split at ${formatTime(op.startTime)}`;
                    case "delete":
                        return `Delete (${formatTime(op.startTime)}-${formatTime(op.endTime)})`;
                    default:
                        return op.type;
                }
            })
            .join(", ");
    };

    const handleViewJob = (job: VideoProcessingJob) => {
        onJobSelect?.(job);
    };

    const columns:TableColumn<VideoProcessingJob>[]  = [
        {
            key: "clipName",
            header: "Asset Name",
            filterable: true,
            render: (job: VideoProcessingJob) => (
                <Box>
                    <div style={{ fontWeight: "bold", textTransform: "capitalize" }}>
                        {job.parameters?.clipName || job.parameters?.reelName || "Unnamed Clip"}
                    </div>
                    <div style={{ fontSize: "12px", color: "#666" }}>
                        Job ID: {job.jobId}
                    </div>
                </Box>
            ),
            width: 200,
        },
        {
            key: "assetType",
            header: "Asset Type",
            filterable: true,
            render: (job: VideoProcessingJob) => (
                <Box>
                    <div style={{ fontWeight: "bold", textTransform: "capitalize" }}>
                        {job.assetType ? job.assetType : job.clipId ? "Clip" : "Reel"}
                    </div>
                </Box>
            ),
        },
        {
            key: "operations",
            header: "Operations",
            render: (job: VideoProcessingJob) => (
                <Box>
                    <SpaceBetween direction="horizontal" size={"xxs"}>
                        <Badge color={"red"}>{getOperationsSummary(job)}</Badge>
                        <Badge color="blue">
                            {job.parameters?.outputSettings?.quality || "unknown"} quality
                        </Badge>
                        <Badge color="severity-low">
                            {job.parameters?.outputSettings?.format?.toUpperCase()}
                        </Badge>
                    </SpaceBetween>
                </Box>
            ),
            minWidth: 300,
        },
        {
            key: "created",
            header: "Created",
            render: (job: VideoProcessingJob) => (
                <Box>
                    <div>{formatDateTime(job.createdAt)}</div>
                    {job.updatedAt !== job.createdAt && (
                        <div style={{ fontSize: "12px", color: "#666" }}>
                            Updated: {formatDateTime(job.updatedAt)}
                        </div>
                    )}
                </Box>
            ),
            width: 180,
        },
        {
            key: "status",
            header: "Status",
            render: (job: VideoProcessingJob) => (
                <SpaceBetween direction="vertical" size="xs">
                    {getStatusIndicator(job.status)}
                    {job.status === "processing" && (
                        <ProgressBar
                            value={job.progress}
                            // variant="flash"
                        />
                    )}
                </SpaceBetween>
            ),
            width: 150,
        },
        {
            key: "actions",
            header: "Actions",
            render: (job: VideoProcessingJob) => (
                <SpaceBetween direction="horizontal" size="xs">
                    <Button
                        variant="normal"
                        iconName={"external"}
                        onClick={() => handleViewJob(job)}
                        disabled={job.status !== "completed"}
                        ariaLabel={`View ${job.assetType ? job.assetType : job.clipId ? "clip" : "reel"}`}
                    >View <span style={{ textTransform: "capitalize" }}>{job.assetType ? job.assetType : job.clipId ? "Clip" : "Reel"}</span></Button>
                </SpaceBetween>
            ),
            minWidth: 200,
        },
    ];

    const {
            paginatedData: paginatedClips,
            pagination,
            sorting,
            filtering,
        } = useTableState({
            data: filteredJobs,
            columns,
            pageSize: 5,
            defaultSortColumn: columns[0], // Sort by name by default
            placeholder: "Find processed jobs",
        });

    return (
        <Container
            header={
                <Header
                    counter={`(${filteredJobs.length})`}
                    description="Track the status of your video processing operations"
                    actions={
                        <Button
                            variant="normal"
                            iconSvg={<RefreshCw />}
                            onClick={handleRefresh}
                            loading={loading}
                            ariaLabel="Refresh processing jobs"
                        >
                            Refresh
                        </Button>
                    }
                >
                    Processing Jobs
                </Header>
            }
        >
            <DataTable
                columns={columns}
                pagination={pagination}
                data={paginatedClips}
                loading={loading}
                selectedItems={[]}
                empty={
                    <Box textAlign="center" color="inherit">
                        <b>No video processing jobs</b>
                        <Box variant="p" color="inherit">
                            No video processing jobs found for the selected criteria.
                        </Box>
                    </Box>
                }
                sorting={sorting}
                filtering={filtering}
                ariaLabel="Processing Jobs"
            />
        </Container>
    );
};

export default VideoProcessingTable;