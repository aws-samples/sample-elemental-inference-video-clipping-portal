import {
    Alert,
    Box,
    Button,
    ButtonDropdown,
    Container,
    ExpandableSection,
    Header,
    Link,
    Modal,
    Popover,
    Select,
    SpaceBetween,
    StatusIndicator
} from "@cloudscape-design/components";
import { Sparkles, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ApiService from "../../../services/apiService";
import settingsService from "../../../services/settingsService";
import { Event } from "../../../types";
import { DataTable, TableColumn, useTableState } from "../../common/DataTable";

interface EventsListProps {
    events: Event[];
    channels: any[];
    loading?: boolean;
    selectedEvent: Event | undefined;
    selectedEvents: Event[] | undefined;
    channelStatus?: {[key: string]: string};
    onCreateEvent?: () => void;
    onCreateClip?: () => void;
    onViewEvent?: (event: Event) => void;
    onDelete: (id: string) => void;
    onSelectionChange?: (selectedEvents: Event[]) => void;
    onRefresh?: () => void;
    onQuickSchedule?: (durationMinutes: number) => void;
    showQuickSchedule?: boolean;
}

const EventsList: React.FC<EventsListProps> = ({
    events,
    channels,
    loading = false,
    selectedEvents,
    channelStatus,
    onCreateEvent,
    onViewEvent,
    onDelete,
    onSelectionChange,
    onRefresh,
    onQuickSchedule,
    showQuickSchedule = false,
}) => {
    const apiService = ApiService.getInstance();
    const navigate = useNavigate();
    
    // Search and filter state
    const [searchText] = useState("");
    const [statusFilter, setStatusFilter] = useState<{ label: string; value: string }>({
        label: "All Events",
        value: "all",
    });

    // Manual override modal state
    const [showOverrideModal, setShowOverrideModal] = useState(false);
    const [pendingToggleEvent, setPendingToggleEvent] = useState<Event | null>(null);
    const [autoActivateEnabled, setAutoActivateEnabled] = useState(false);
    const [expanded, setExpanded] = useState(true);
    const [activationError, setActivationError] = useState<string | null>(null);

    // Fetch autoActivateInference setting on mount
    useEffect(() => {
        const fetchAutoActivateSetting = async () => {
            try {
                const setting = await settingsService.getSetting("autoActivateInference");
                setAutoActivateEnabled(setting.settingValue === "true");
            } catch {
                // Setting missing or fetch failed — treat as false
                setAutoActivateEnabled(false);
            }
        };
        fetchAutoActivateSetting();
    }, []);

    // Handle toggle activate/deactivate event for Inference
    const handleToggleActivation = async (event: any) => {
        setActivationError(null);
        try {
            if (event.isActiveForStarfish) {
                const response = await apiService.deactivateEvent(event.id);
                if (response?.warning) {
                    setActivationError(response.warning);
                }
            } else {
                await apiService.activateEvent(event.id);
            }
            if (onRefresh) {
                onRefresh();
            }
        } catch (error: any) {
            const message = error?.response?.data?.message
                || error?.message
                || "Failed to toggle event activation. Please try again.";
            setActivationError(message);
            if (onRefresh) {
                onRefresh();
            }
        }
    };

    // Handle sparkle button click — show confirmation if auto-activate is enabled
    const handleSparkleClick = (event: Event) => {
        if (autoActivateEnabled) {
            setPendingToggleEvent(event);
            setShowOverrideModal(true);
        } else {
            handleToggleActivation(event);
        }
    };

    // Confirm manual override: toggle event and disable auto-activate
    const handleConfirmOverride = async () => {
        if (pendingToggleEvent) {
            await handleToggleActivation(pendingToggleEvent);
            await settingsService.updateSetting("autoActivateInference", "false");
            setAutoActivateEnabled(false);
        }
        setShowOverrideModal(false);
        setPendingToggleEvent(null);
    };

    // Cancel manual override: close modal, no changes
    const handleCancelOverride = () => {
        setShowOverrideModal(false);
        setPendingToggleEvent(null);
    };

    // Status filter options
    const statusFilterOptions = [
        { label: "All Events", value: "all" },
        { label: "Live Events", value: "live" },
        { label: "Idle Events", value: "idle" },
        { label: "Ended Events", value: "ended" },
        { label: "Scheduled Events", value: "scheduled" },
    ];

    // Filter events based on search text and status filter
    const filteredEvents = useMemo(() => {
        let filtered = events;

        // Apply search filter
        if (searchText) {
            const searchLower = searchText.toLowerCase();
            filtered = filtered.filter((event) => event.name.toLowerCase().includes(searchLower));
        }

        // Apply status filter
        if (statusFilter.value !== "all") {
            filtered = filtered.filter((event) => event.status === statusFilter.value);
        }

        return filtered;
    }, [events, searchText, statusFilter]);
    // Status indicator renderer
    const renderStatus = (event: Event) => {
        const statusConfig = {
            live: { type: "success" as const, text: "Live" },
            ended: { type: "info" as const, text: "Ended" },
            scheduled: { type: "pending" as const, text: "Scheduled" },
            idle: { type: "stopped" as const, text: "Idle" },
        };
        const currentDate = new Date();
        const startDateTime = new Date(event.startDateTime);
        const endDateTime = new Date(event.endDateTime);
        // set the status if the current date and time is between the start and end time of the event
        if (channelStatus && channelStatus[event.mediaLiveChannel] === "IDLE") {
            event.status = "idle";
        } else {
            if (currentDate >= startDateTime && currentDate <= endDateTime) {
                event.status = "live";
            } else if (currentDate > endDateTime) {
                event.status = "ended";
            } else {
                event.status = "scheduled";
            }
        }

        const config = statusConfig[event.status];
        return <StatusIndicator type={config.type}>{config.text}</StatusIndicator>;
    };

    const renderChannelName = ( channelId: string|undefined ) => {
        if (!channelId) return "N/A";
        const channel = channels.find((channel) => channel.id === channelId);
        if (!channel) return <StatusIndicator type="warning">No channel (deleted)</StatusIndicator>;

        const name = channel.name || channelId;
        const channelLink = <Link onFollow={(e) => { e.preventDefault(); navigate("/channels"); }}>{name}</Link>;

        if (channel.provisioningStatus === "CREATING") {
            return (
                <SpaceBetween direction="horizontal" size="xs">
                    {channelLink}
                    <StatusIndicator type="loading">Creating</StatusIndicator>
                </SpaceBetween>
            );
        }

        if (channel.provisioningStatus === "FAILED") {
            return (
                <SpaceBetween direction="horizontal" size="xs">
                    {channelLink}
                    <Popover
                        dismissButton={false}
                        position="top"
                        size="small"
                        triggerType="custom"
                        content={channel.provisioningError || "Channel provisioning failed"}
                    >
                        <StatusIndicator type="error">Failed</StatusIndicator>
                    </Popover>
                </SpaceBetween>
            );
        }

        return channelLink;
    };

    // Format date/time for display
    const formatDateTime = (dateTimeString: string) => {
        const date = new Date(dateTimeString);
        return date.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    // Format duration in minutes to readable format
    const formatDuration = (startTime: string, endTime: string) => {
        if (!startTime || !endTime) return "N/A";
        const startDate: any = new Date(startTime); // 12:00 AM on Sept 23, 2025
        const endDate: any = new Date(endTime); // 11:59 PM on Sept 24, 2025

        // Calculate the difference in milliseconds.
        let diffInMs = endDate - startDate;

        // Calculate days, hours, and minutes
        const days = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
        diffInMs -= days * (1000 * 60 * 60 * 24);

        const hours = Math.floor(diffInMs / (1000 * 60 * 60));
        diffInMs -= hours * (1000 * 60 * 60);

        const minutes = Math.floor(diffInMs / (1000 * 60));
        return `${days}d ${hours}h ${minutes}m`;
    };

    // Event name renderer with link
    const renderEventName = (event: Event) => {
        if (onViewEvent) {
            return (
                <Link
                    href="#"
                    onFollow={(e) => {
                        e.preventDefault();
                        onViewEvent(event);
                    }}
                >
                    {event.name}
                </Link>
            );
        }
        return event.name;
    };

    // Define table columns
    const columns: TableColumn<Event>[] = [
        {
            key: "name",
            header: "Event Name",
            sortable: true,
            filterable: true,
            render: renderEventName,
        },
        {
            key: "status",
            header: "Status",
            sortable: true,
            filterable: true,
            render: renderStatus,
        },
        {
            key: "isActiveForStarfish",
            header: "Inference Clipping",
            sortable: true,
            filterable: true,
            render: (event) =>
                event.isActiveForStarfish ? (
                    <StatusIndicator type={"success"}> Active</StatusIndicator>
                ) : (
                    <StatusIndicator type={"stopped"}> Inactive</StatusIndicator>
                ),
        },
        {
            key: "startDateTime",
            header: "Start Date/Time",
            sortable: true,
            render: (event) => formatDateTime(event.startDateTime),
        },
        {
            key: "endDateTime",
            header: "End Date/Time",
            sortable: true,
            render: (event) => formatDateTime(event.endDateTime),
        },
        {
            key: "duration",
            header: "Duration",
            sortable: true,
            render: (event) => formatDuration(event.startDateTime, event.endDateTime),
        },
        {
            key: "mediaLiveChannel",
            header: "Media Live Channel",
            sortable: true,
            filterable: true,
            render: (event) => renderChannelName(event.mediaLiveChannel),
        },
        // {
        //     key: "autoGenerateHighlight",
        //     header: "Auto Generate Highlights",
        //     sortable: true,
        //     filterable: true,
        //     render: (event) =>
        //         event.autoGenerateHighlight ? (
        //             <StatusIndicator type={"success"}> Yes</StatusIndicator>
        //         ) : (
        //             <StatusIndicator type={"error"}> No</StatusIndicator>
        //         ),
        // },
        {
            key: "actions",
            header: "Actions",
            sortable: true,
            render: (event) => (
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <Button
                            onClick={() => handleSparkleClick(event)}
                            variant="inline-link"
                            ariaLabel={event.isActiveForStarfish ? "Deactivate inference clipping" : "Activate inference clipping"}
                            iconSvg={
                                <Sparkles 
                                    style={{ 
                                        height: "18px", 
                                        width: "18px",
                                        fill: event.isActiveForStarfish ? "currentColor" : "none"
                                    }} 
                                />
                            }
                        />
                    <Button
                        onClick={() => onDelete(event.id)}
                        variant="inline-link"
                        ariaLabel="Delete event"
                        iconSvg={<Trash2 style={{ height: "18px", width: "18px" }} />}
                    />
                </div>
            ),
        },
    ];

    // Table state management with filtered data
    const {
        paginatedData: paginatedEvents,
        pagination,
        sorting,
        filtering,
    } = useTableState({
        data: filteredEvents,
        columns,
        pageSize: 10,
        defaultSortColumn: columns[0], // Sort by name by default
        placeholder: "Find available events",
    });

    return (
        <ExpandableSection
            expanded={expanded}
            onChange={({ detail }) => setExpanded(detail.expanded)}
            headerText={`Available Events (${filteredEvents.length})`}
            headerActions={
                <SpaceBetween size={"xs"} direction={"horizontal"}>
                    {onRefresh && (
                        <Button
                            iconName={"refresh"}
                            onClick={onRefresh}
                            ariaLabel="Refresh events"
                        >
                            Refresh
                        </Button>
                    )}
                    {showQuickSchedule && onQuickSchedule && (
                        <ButtonDropdown
                            items={[
                                { id: "10", text: "10 min event" },
                                { id: "20", text: "20 min event" },
                                { id: "30", text: "30 min event" },
                                { id: "60", text: "60 min event" },
                            ]}
                            onItemClick={({ detail }) => onQuickSchedule(parseInt(detail.id))}
                            ariaLabel="Quick schedule event"
                        >
                            Quick Schedule
                        </ButtonDropdown>
                    )}
                    {onCreateEvent && (
                        <Button
                            variant="primary"
                            iconName={"add-plus"}
                            onClick={onCreateEvent}
                            ariaLabel="Create Event"
                        >
                            Create Event
                        </Button>
                    )}
                </SpaceBetween>
            }
            headerDescription="Create and manage events. Key moments will be generated using Live streaming content."
            variant="container"
        >
            <SpaceBetween size="l">
                {activationError && (
                    <Alert
                        type="error"
                        dismissible
                        onDismiss={() => setActivationError(null)}
                    >
                        {activationError}
                    </Alert>
                )}
                <DataTable
                    data={paginatedEvents}
                    columns={columns}
                    loading={loading}
                    pagination={pagination}
                    sorting={sorting}
                    tableSelection={"multi"}
                    selectedItems={selectedEvents || []}
                    empty={
                        <Box textAlign="center" color="inherit">
                            <b>No events found</b>
                            <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                                {searchText || statusFilter.value !== "all"
                                    ? "No events match your search criteria. Try adjusting your filters."
                                    : "No events to display."}
                            </Box>
                        </Box>
                    }
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
                                ariaLabel="Filter events by status"
                            />
                        </div>
                    }
                    ariaLabel="Events table"
                    onSelectionChange={onSelectionChange}
                />
            </SpaceBetween>
            <Modal
                visible={showOverrideModal}
                onDismiss={handleCancelOverride}
                header="Manual Override"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={handleCancelOverride}>
                                Cancel
                            </Button>
                            <Button variant="primary" onClick={handleConfirmOverride}>
                                Confirm
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                Auto-activate inference is currently enabled. Proceeding with this manual
                action will disable auto-activate system-wide. Future events will no longer
                be automatically activated or deactivated by the scheduler.
            </Modal>
        </ExpandableSection>
    );
};

export default EventsList;
