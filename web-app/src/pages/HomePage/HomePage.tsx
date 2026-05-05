import { ContentLayout, Header, SpaceBetween, Modal, Box, Button, Checkbox, Spinner, Select, FormField } from "@cloudscape-design/components";
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ViewClip } from "../../components/clips/ClipModal";
import { ClipsList } from "../../components/clips/ClipsList";
import { CreateEvent, ViewEvent } from "../../components/events/EventModal";
import { EventsList } from "../../components/events/EventsList";
import { useClips } from "../../hooks/useClips";
import { useEvents } from "../../hooks/useEvents";
import { usePreferences } from "../../contexts/PreferencesContext";
import { Clip, Event } from "../../types";
import ApiService from "../../services/apiService.ts";

const HomePage: React.FC = () => {
    const navigate = useNavigate();
    const apiService = ApiService.getInstance();
    const { demoMode } = usePreferences();
    const [selectedEvent, setSelectedEvent] = useState<Event | undefined>(undefined);
    const [selectedClip, setSelectedClip] = useState<Clip | undefined>(undefined);
    const [selectedEvents, setSelectedEvents] = useState<Event[]>([]);
    const [selectedClips, setSelectedClips] = useState<Clip[]>([]);
    const [showCreateEventDialog, setShowCreateEventDialog] = useState(false);
    const [showViewEventDialog, setShowViewEventDialog] = useState(false);
    const [showViewClipDialog, setShowViewClipDialog] = useState(false);
    const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; event: Event | null; deleteClips: boolean; loading: boolean }>({ 
        open: false, 
        event: null, 
        deleteClips: true,
        loading: false
    });
    const [channels, setChannels] = useState<any[]>([]);
    const [channelStatus, setChannelStatus] = useState<{[key: string]: string}>({});

    // Quick schedule state
    const [quickSchedulePending, setQuickSchedulePending] = useState<number | null>(null);
    const [quickScheduleChannel, setQuickScheduleChannel] = useState<{ label: string; value: string } | null>(null);
    const [quickScheduleLoading, setQuickScheduleLoading] = useState(false);

    const { events, loading: loadingEvents, fetchEvents, deleteEvent } = useEvents();
    const { clips, loading: loadingClips, fetchClips, clearClips, deleteClip } = useClips();

    const fetchChannelStatus = useCallback(async () => {
        try {
            if (!channels || channels.length === 0 || !events || events.length  === 0) return;
            // Test MediaLive status API
            const promises: Promise<any>[] = channels.map((channel: any) => {
                return apiService.getChannelStatus(channel.id);
            });

            const results = await Promise.all(promises);
            // Build a key value pair for channel id and channel status
            const channelStatus: {[key: string]: string} = {};
            results.forEach((result: any) => {
                channelStatus[result.id] = result.state;
            });
            setChannelStatus(channelStatus);
        } catch (error) {
            console.error("Failed to get channel status:", error);
        }
    }, [apiService, channels, events]);

    useEffect(() => {
        fetchChannelStatus().then();
    }, [fetchChannelStatus]);

    // Load events and auto-select first active/live event
    useEffect(() => {
        fetchEvents().then();
    }, [fetchEvents]);

    // Auto-select first live event on initial load only
    const [initialSelectionDone, setInitialSelectionDone] = useState(false);
    useEffect(() => {
        if (events.length > 0 && !initialSelectionDone) {
            const liveEvent = events.find(event => event.status === 'live');
            const defaultEvent = liveEvent || events[0];
            
            setSelectedEvent(defaultEvent);
            setSelectedEvents([defaultEvent]);
            fetchClips(defaultEvent.id);
            setInitialSelectionDone(true);
        }
    }, [events, initialSelectionDone, fetchClips]);

    const handleCreateEvent = () => {
        setShowCreateEventDialog(true);
    };

    const handleViewEvent = (event: Event) => {
        setSelectedEvent(event);
        setShowViewEventDialog(true);
    };

    const handlePublishClips = () => {
      if (selectedClips && selectedClips.length > 0) {
        const promises: Promise<any>[] = [];
        selectedClips.forEach((clip: Clip) => {
          const promise = apiService.updateClip({...clip, status: "published" })
          promises.push(promise);
        });
        Promise.all(promises).then(() => {
            fetchClips(selectedEvent!.id);
        })
      }
    };

    const handleViewClip = (clip: Clip) => {
        setShowViewClipDialog(true);
        setSelectedClip(clip);
    };

    const handleEditClip = (clip: Clip | undefined) => {
        if (clip)
            navigate(`video-editor?videoId=${clip.id}`);
    };

    const handleFeedbackClip = (_clip: Clip | undefined) => {
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
            if (selectedEvent) {
                fetchClips(selectedEvent.id);
            }
        } catch (error) {
            console.error("Failed to toggle lock:", error);
        }
    };

    const handleDeleteClip = async (clip: Clip | undefined) => {
        if (!clip) return;
        try {
            await deleteClip(clip.id);
            setShowViewClipDialog(false);
            setSelectedClip(undefined);
        } catch (error) {
            console.error("Failed to delete clip:", error);
        }
    };

    const onSubmitEvent = () => {
        setShowCreateEventDialog(false);
        fetchEvents().then();
        // Refresh clips for the current selection
        if (selectedEvent) {
            fetchClips(selectedEvent.id);
        }
    };

    const handleDeleteEvent = async (id: string) => {
        const event = events.find(e => e.id === id);
        if (!event) return;

        setDeleteDialog({ 
            open: true, 
            event, 
            deleteClips: true,
            loading: false
        });
    };

    const confirmDeleteEvent = async () => {
        if (!deleteDialog.event) return;
        
        const eventToDelete = deleteDialog.event;
        setDeleteDialog(prev => ({ ...prev, loading: true }));
        
        try {
            await deleteEvent(eventToDelete.id, deleteDialog.deleteClips);
            setDeleteDialog({ open: false, event: null, deleteClips: true, loading: false });
            
            if (selectedEvent?.id === eventToDelete.id) {
                clearClips();
                setSelectedEvent(undefined);
            }
            
            await fetchEvents();
        } catch (error) {
            console.error('Delete failed:', error);
            setDeleteDialog(prev => ({ ...prev, loading: false }));
        }
    };

    const handleEventSelection = (events: Event[]) => {
        setSelectedEvents(events);
        // Keep selectedEvent as the most recently selected for backward compatibility
        const newSelectedEvent = events.length > 0 ? events[events.length - 1] : undefined;
        setSelectedEvent(newSelectedEvent);
        
        // Fetch clips for all selected events
        if (events.length > 0) {
            const eventIds = events.map(e => e.id);
            fetchClips(undefined, eventIds);
        } else {
            clearClips();
        }
    };

    const handleClipSelection = (clips: Clip[]) => {
        setSelectedClips(clips);
    };

    const loadChannels = useCallback(async () => {
        try {
            const channelsData: any[] = await apiService.getChannels();
            setChannels(channelsData);
        } catch (error) {
            console.error("Failed to load channels:", error);
        }
    }, [apiService]);

    // Use event-specific clips from server-side queries
    const clipsByEvent = clips;

    useEffect(() => {
            loadChannels().then();
    }, [loadChannels]);

    useEffect(() => {
        // check if clipId is in query param, if so then open the clip modal
        const queryParams = new URLSearchParams(window.location.search);
        const clipId = queryParams.get("clipId");
        if (clipId) {
            const clip = clips.find((clip: Clip) => clip.id === clipId);
            if (clip) {
                handleViewClip(clip);
            }
        }
    }, [clips]);

    const handleQuickSchedule = useCallback(async (durationMinutes: number, channelId?: string) => {
        // Filter to available (non-provisioning) channels
        const availableChannels = channels.filter(
            (ch) => ch.provisioningStatus !== "CREATING" && ch.provisioningStatus !== "FAILED" && ch.provisioningStatus !== "DELETING"
        );

        if (availableChannels.length === 0) return;

        // If multiple channels and no channel selected yet, show picker
        if (availableChannels.length > 1 && !channelId) {
            setQuickSchedulePending(durationMinutes);
            setQuickScheduleChannel({ label: availableChannels[0].name || availableChannels[0].id, value: availableChannels[0].id });
            return;
        }

        const resolvedChannelId = channelId || availableChannels[0].id;

        // Build start time: top of the next minute
        const now = new Date();
        const start = new Date(now);
        start.setSeconds(0, 0);
        start.setMinutes(start.getMinutes() + 1);

        const end = new Date(start);
        end.setMinutes(end.getMinutes() + durationMinutes);

        const pad = (n: number) => String(n).padStart(2, "0");
        const timeName = `${pad(start.getHours())}${pad(start.getMinutes())}`;
        const eventName = `Quick-${durationMinutes}m-${timeName}`;

        setQuickScheduleLoading(true);
        try {
            await apiService.createEvent({
                name: eventName,
                description: `Quick scheduled ${durationMinutes} minute event`,
                startDateTime: start.toISOString(),
                endDateTime: end.toISOString(),
                duration: durationMinutes,
                mediaLiveChannel: resolvedChannelId,
                autoGenerateHighlight: true,
                generateMP4: true,
                sportsType: "soccer",
            });
            await fetchEvents();
        } catch (error) {
            console.error("Quick schedule failed:", error);
        } finally {
            setQuickScheduleLoading(false);
            setQuickSchedulePending(null);
        }
    }, [channels, apiService, fetchEvents]);

    const confirmQuickSchedule = useCallback(async () => {
        if (quickSchedulePending && quickScheduleChannel) {
            await handleQuickSchedule(quickSchedulePending, quickScheduleChannel.value);
        }
    }, [quickSchedulePending, quickScheduleChannel, handleQuickSchedule]);

    return (
        <ContentLayout
            defaultPadding
            headerVariant="high-contrast"
            header={
                <Header
                    variant="h2"
                    description="Manage events and create highlight clips from streaming content."
                >
                    Events
                </Header>
            }
        >
            <SpaceBetween size="l">
                <EventsList
                    events={events}
                    channels={channels}
                    loading={loadingEvents}
                    selectedEvent={selectedEvent}
                    selectedEvents={selectedEvents}
                    channelStatus={channelStatus}
                    onCreateEvent={handleCreateEvent}
                    onViewEvent={handleViewEvent}
                    onDelete={handleDeleteEvent}
                    onSelectionChange={handleEventSelection}
                    onRefresh={fetchEvents}
                    showQuickSchedule={demoMode}
                    onQuickSchedule={(duration) => handleQuickSchedule(duration)}
                />
                <ClipsList
                    clips={clipsByEvent}
                    selectedClips={selectedClips}
                    loading={loadingClips}
                    showActions={true}
                    showPublish={true}
                    showDownload={true}
                    onPublishClips={handlePublishClips}
                    onViewClip={handleViewClip}
                    onEditClip={handleEditClip}
                    onFeedbackClip={handleFeedbackClip}
                    onToggleLock={handleToggleLock}
                    onDeleteClip={handleDeleteClip}
                    onSelectionChange={handleClipSelection}
                    onRefresh={() => selectedEvent ? fetchClips(selectedEvent.id) : undefined}
                />
            </SpaceBetween>
            <CreateEvent
                channels={channels}
                onSubmit={onSubmitEvent}
                showDialog={showCreateEventDialog}
                setShowDialog={setShowCreateEventDialog}
            />
            {showViewEventDialog && selectedEvent && (
                <ViewEvent
                    event={selectedEvent}
                    channels={channels}
                    showDialog={true}
                    setShowDialog={setShowViewEventDialog}
                />
            )}
            {showViewClipDialog && selectedClip && (
                <ViewClip
                    clip={selectedClip}
                    showDialog={true}
                    setShowDialog={setShowViewClipDialog}
                    onFeedbackClip={handleFeedbackClip}
                    onEditClip={handleEditClip}
                    onToggleLock={handleToggleLock}
                    onDeleteClip={handleDeleteClip}
                    onRefresh={() => selectedEvent ? fetchClips(selectedEvent.id) : undefined}
                />
            )}
            
            <Modal
                visible={deleteDialog.open}
                onDismiss={() => setDeleteDialog({ open: false, event: null, deleteClips: true, loading: false })}
                header="Delete Event"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button 
                                variant="link" 
                                onClick={() => setDeleteDialog({ open: false, event: null, deleteClips: true, loading: false })}
                                disabled={deleteDialog.loading}
                            >
                                Cancel
                            </Button>
                            <Button 
                                variant="primary" 
                                onClick={confirmDeleteEvent}
                                disabled={deleteDialog.loading}
                            >
                                {deleteDialog.loading && <Spinner />} {deleteDialog.loading ? 'Deleting...' : 'Delete Event'}
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                <SpaceBetween size="m">
                    <Box>
                        Delete "{deleteDialog.event?.name}"?
                    </Box>
                    {deleteDialog.event && (
                        <Checkbox
                            checked={deleteDialog.deleteClips}
                            onChange={({ detail }) => 
                                setDeleteDialog(prev => ({ ...prev, deleteClips: detail.checked }))
                            }
                            disabled={deleteDialog.loading}
                        >
                            Delete associated clips
                        </Checkbox>
                    )}
                </SpaceBetween>
            </Modal>

            <Modal
                visible={quickSchedulePending !== null}
                onDismiss={() => setQuickSchedulePending(null)}
                header="Select Channel"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={() => setQuickSchedulePending(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={confirmQuickSchedule}
                                loading={quickScheduleLoading}
                            >
                                Create Event
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                <FormField
                    label="Channel"
                    description={`Quick schedule a ${quickSchedulePending} minute event on the selected channel.`}
                >
                    <Select
                        selectedOption={quickScheduleChannel}
                        onChange={({ detail }) =>
                            setQuickScheduleChannel(detail.selectedOption as { label: string; value: string })
                        }
                        options={channels
                            .filter((ch) => ch.provisioningStatus !== "CREATING" && ch.provisioningStatus !== "FAILED" && ch.provisioningStatus !== "DELETING")
                            .map((ch) => ({ label: ch.name || ch.id, value: ch.id }))}
                    />
                </FormField>
            </Modal>

        </ContentLayout>
    );
};

export default HomePage;
