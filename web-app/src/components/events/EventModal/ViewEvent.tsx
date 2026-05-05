import React, { useCallback, useEffect, useState } from "react";
import { Badge, Container, FormField, Header, Modal, SegmentedControl, SpaceBetween, StatusIndicator } from "@cloudscape-design/components";
import { Clip, Event } from "../../../types";
import ApiService from "../../../services/apiService";
import DualPlayerPreview, { DUAL_PLAYER_MODAL_CLASS } from "../../common/DualPlayerPreview";

interface ViewEventProps {
    event: Event|undefined;
    channels: any[];
    showDialog: boolean;
    setShowDialog: ( showDialog: boolean ) => void;
}

const ViewEvent: React.FC<ViewEventProps> = ( { event, channels, showDialog, setShowDialog } ) => {
    const [clips, setClips] = useState<Clip[]>([]);
    const [eventChannel, setEventChannel] = useState<any>();
    const [dualMode, setDualMode] = useState(false);
    const [viewMode, setViewMode] = useState<'dual' | 'single'>('dual');
    const apiService = ApiService.getInstance();

    useEffect(() => {
        const loadClips = async () => {
            if (event) {
                try {
                    const eventClips = await apiService.getClipsByEventId(event.id);
                    setClips(eventClips);
                } catch (error) {
                    console.error("Failed to load clips for event:", error);
                }
            }
        };

        loadClips().then();
    }, [event, apiService]);

    const renderStatus = ( status: string|undefined ) => {
        const statusConfig: any = {
            live: { type: "success" as const, text: "Live" },
            ended: { type: "info" as const, text: "Ended" },
            scheduled: { type: "pending" as const, text: "Scheduled" },
            idle: { type: "stopped" as const, text: "Idle" },
        };

        const config = statusConfig[status ?? "ended"];
        return (
            <StatusIndicator type={config.type}>
                {config.text}
            </StatusIndicator>
        );
    };

    const fetchEventChannel = useCallback(() => {
        if (!event?.mediaLiveChannel) return;
        const channel = channels.find((channel) => channel.id === event.mediaLiveChannel);
        setEventChannel(channel);
    }, [channels, event?.mediaLiveChannel]);

    useEffect(() => {
       fetchEventChannel(); 
    }, [fetchEventChannel])

    return (
        <Modal
            size={"large"}
            header={
                <Header
                    variant="h2"
                    description={`${event?.name} - ${event?.startDateTime} `}
                >
                    {event?.name}
                </Header>
            }
            onDismiss={() => setShowDialog(false)}
            visible={showDialog}
            className={`custom-modal${dualMode ? ` ${DUAL_PLAYER_MODAL_CLASS}` : ''}`}
        >
            <Container>
                {event &&
                    <SpaceBetween size={"xxl"}>
                        <div style={{ display: 'flex', justifyContent: 'space-evenly', textAlign: 'center' }}>
                            <FormField label="Key moments" description={"Number of clips generated for the event."}>
                                {clips?.length ?? 2}
                            </FormField>
                            <FormField label="Event Status" description={"Status for the event"}>
                                {renderStatus(event?.status)}
                            </FormField>
                            <FormField label="Generate MP4" description={"Generate clips in mp4 format"}>
                                <StatusIndicator type={event?.generateMP4 ? "success" : "error"}>{event?.generateMP4 ? "Yes" : "No"}</StatusIndicator>
                            </FormField>
                            <FormField label="Media Live Channel" description={"Media channel associated with the feed"}>
                                {eventChannel ? (
                                    <Badge>{eventChannel.name}</Badge>
                                ) : (
                                    <StatusIndicator type="warning">No channel (deleted)</StatusIndicator>
                                )}
                            </FormField>
                            {eventChannel?.verticalManifestUrl && (eventChannel?.landscapeManifestUrl || eventChannel?.manifestUrl) && (
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
                        {(eventChannel?.landscapeManifestUrl || eventChannel?.manifestUrl) && showDialog && (
                            <DualPlayerPreview
                                landscapeUrl={eventChannel.landscapeManifestUrl || eventChannel.manifestUrl}
                                portraitUrl={eventChannel.verticalManifestUrl}
                                autoplay={false}
                                viewMode={viewMode}
                                onViewModeChange={(mode) => {
                                    setViewMode(mode);
                                    setDualMode(mode === 'dual');
                                }}
                            />
                        )}
                    </SpaceBetween>}
            </Container>
        </Modal>
    );
};

export default ViewEvent;