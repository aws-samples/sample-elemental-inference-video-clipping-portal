import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ContentLayout,
  Header,
  Table,
  Box,
  SpaceBetween,
  Button,
  StatusIndicator,
  Alert,
  Modal,
} from "@cloudscape-design/components";
import ApiService from "../../services/apiService";
import ChannelThumbnail from "../../components/channels/ChannelThumbnail/ChannelThumbnail";
import CreateChannelModal from "../../components/channels/CreateChannelModal/CreateChannelModal";
import PreviewChannelModal from "../../components/channels/PreviewChannelModal/PreviewChannelModal";
import type { ChannelWithStatus, ChannelState } from "../../types/channels";

const STATE_REFRESH_INTERVAL = 30000;
const DELETE_POLL_INTERVAL = 4000;

function stateIndicatorType(state: ChannelState | string): "success" | "info" | "loading" | "warning" | "error" | "stopped" {
  switch (state) {
    case "RUNNING":
      return "success";
    case "STARTING":
    case "STOPPING":
      return "loading";
    case "IDLE":
      return "info";
    case "STOPPED":
      return "stopped";
    default:
      return "warning";
  }
}

const ChannelsPage: React.FC = () => {
  const [channels, setChannels] = useState<ChannelWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [deleteConfirmChannel, setDeleteConfirmChannel] = useState<ChannelWithStatus | null>(null);
  const [previewChannel, setPreviewChannel] = useState<ChannelWithStatus | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deletePollingRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const apiService = ApiService.getInstance();

  // Cleanup all delete polling on unmount
  useEffect(() => {
    return () => {
      Object.values(deletePollingRef.current).forEach(clearInterval);
    };
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      setError(null);
      const channelsData: any[] = await apiService.getChannels();
      const enriched: ChannelWithStatus[] = await Promise.all(
        channelsData.map(async (ch) => {
          // If provisioningStatus is CREATING or DELETING, use that as state
          if (ch.provisioningStatus === "CREATING") {
            return { ...ch, state: "CREATING" as ChannelState };
          }
          if (ch.provisioningStatus === "DELETING") {
            return { ...ch, state: "DELETING" as ChannelState };
          }
          try {
            const status = await apiService.getChannelStatus(ch.id);
            return { ...ch, state: status.state as ChannelState };
          } catch {
            return { ...ch, state: "IDLE" as ChannelState };
          }
        })
      );
      setChannels(enriched);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const refreshChannelStates = useCallback(async () => {
    if (channels.length === 0) return;
    try {
      const updated = await Promise.all(
        channels.map(async (ch) => {
          if (ch.provisioningStatus === "CREATING" || ch.provisioningStatus === "DELETING") {
            return ch; // Don't poll MediaLive for channels being provisioned/deleted
          }
          try {
            const status = await apiService.getChannelStatus(ch.id);
            return { ...ch, state: status.state as ChannelState };
          } catch {
            return ch;
          }
        })
      );
      setChannels(updated);
    } catch {
      // Silently fail on background refresh
    }
  }, [apiService, channels]);

  const startChannel = useCallback(
    async (channelId: string) => {
      setActionLoading((prev) => ({ ...prev, [channelId]: true }));
      try {
        await apiService.startChannel(channelId);
        setChannels((prev) =>
          prev.map((ch) => (ch.id === channelId ? { ...ch, state: "STARTING" as ChannelState } : ch))
        );
      } catch (err: any) {
        setError(`Failed to start channel: ${err?.message ?? "Unknown error"}`);
      } finally {
        setActionLoading((prev) => ({ ...prev, [channelId]: false }));
      }
    },
    [apiService]
  );

  const stopChannel = useCallback(
    async (channelId: string) => {
      setActionLoading((prev) => ({ ...prev, [channelId]: true }));
      try {
        await apiService.stopChannel(channelId);
        setChannels((prev) =>
          prev.map((ch) => (ch.id === channelId ? { ...ch, state: "STOPPING" as ChannelState } : ch))
        );
      } catch (err: any) {
        setError(`Failed to stop channel: ${err?.message ?? "Unknown error"}`);
      } finally {
        setActionLoading((prev) => ({ ...prev, [channelId]: false }));
      }
    },
    [apiService]
  );

  const pollDeletionStatus = useCallback((channelId: string, executionArn: string) => {
    deletePollingRef.current[channelId] = setInterval(async () => {
      try {
        const statusResponse = await apiService.getChannelCreationStatus(executionArn);
        if (statusResponse.status === "ACTIVE" || statusResponse.status === "FAILED") {
          clearInterval(deletePollingRef.current[channelId]);
          delete deletePollingRef.current[channelId];
          fetchChannels(); // Refresh — channel will be gone or show error
        }
      } catch {
        clearInterval(deletePollingRef.current[channelId]);
        delete deletePollingRef.current[channelId];
        fetchChannels();
      }
    }, DELETE_POLL_INTERVAL);
  }, [apiService, fetchChannels]);

  const deleteChannel = useCallback(
    async (channel: ChannelWithStatus) => {
      setDeleteLoading(true);
      try {
        const response = await apiService.deleteChannel(channel.id);
        setDeleteConfirmChannel(null);

        // Optimistically set to DELETING
        setChannels((prev) =>
          prev.map((ch) =>
            ch.id === channel.id
              ? { ...ch, state: "DELETING" as ChannelState, provisioningStatus: "DELETING" }
              : ch
          )
        );

        if (response?.executionArn) {
          pollDeletionStatus(channel.id, response.executionArn);
        }
      } catch (err: any) {
        setError(`Failed to delete channel: ${err?.message ?? "Unknown error"}`);
        setDeleteConfirmChannel(null);
      } finally {
        setDeleteLoading(false);
      }
    },
    [apiService, pollDeletionStatus]
  );

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  useEffect(() => {
    if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    refreshIntervalRef.current = setInterval(refreshChannelStates, STATE_REFRESH_INTERVAL);
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [refreshChannelStates]);

  const renderState = (channel: ChannelWithStatus) => {
    if (channel.provisioningStatus === "CREATING") {
      return <StatusIndicator type="loading">Creating</StatusIndicator>;
    }
    if (channel.provisioningStatus === "DELETING") {
      return <StatusIndicator type="loading">Deleting</StatusIndicator>;
    }
    if (channel.provisioningStatus === "FAILED") {
      return <StatusIndicator type="error">Failed</StatusIndicator>;
    }
    return (
      <StatusIndicator type={stateIndicatorType(channel.state)}>
        {channel.state}
      </StatusIndicator>
    );
  };

  const renderActions = (channel: ChannelWithStatus) => {
    const isLoading = actionLoading[channel.id] ?? false;
    const isTransitioning = channel.state === "STARTING" || channel.state === "STOPPING";
    const isProvisioning = channel.provisioningStatus === "CREATING" || channel.provisioningStatus === "DELETING";

    if (isProvisioning) return null;

    return (
      <SpaceBetween direction="horizontal" size="xs">
        {channel.state === "IDLE" && (
          <>
            <Button
              variant="normal"
              loading={isLoading}
              disabled={isTransitioning}
              onClick={() => startChannel(channel.id)}
              ariaLabel="Start"
            >
              Start
            </Button>
            <Button
              variant="normal"
              onClick={() => setDeleteConfirmChannel(channel)}
              ariaLabel="Delete"
            >
              Delete
            </Button>
          </>
        )}
        {channel.state === "RUNNING" && (
          <Button
            variant="normal"
            loading={isLoading}
            disabled={isTransitioning}
            onClick={() => stopChannel(channel.id)}
            ariaLabel="Stop"
          >
            Stop
          </Button>
        )}
        {isTransitioning && (
          <Button variant="normal" disabled ariaLabel={channel.state === "STARTING" ? "Starting…" : "Stopping…"}>
            {channel.state === "STARTING" ? "Starting…" : "Stopping…"}
          </Button>
        )}
      </SpaceBetween>
    );
  };

  return (
    <ContentLayout
      defaultPadding
      headerVariant="high-contrast"
      header={
        <Header
          variant="h2"
          description="View and manage your MediaLive channels."
          actions={
            <SpaceBetween size="xs" direction="horizontal">
              <Button iconName="refresh" onClick={fetchChannels} loading={loading} ariaLabel="Refresh channels">
                Refresh
              </Button>
              <Button variant="primary" onClick={() => setShowCreateChannelModal(true)} ariaLabel="Create Channel">
                Create Channel
              </Button>
            </SpaceBetween>
          }
        >
          Channels
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Table
          loading={loading}
          loadingText="Loading channels…"
          items={channels}
          trackBy="id"
          empty={
            <Box textAlign="center" color="inherit" padding="l">
              <SpaceBetween size="m">
                <b>No channels</b>
                <Box variant="p" color="inherit">
                  No channels have been created yet. Use the "Create Channel" button above to get started.
                </Box>
              </SpaceBetween>
            </Box>
          }
          columnDefinitions={[
            {
              id: "name",
              header: "Name",
              cell: (item) => {
                const canPreview = item.state === "RUNNING";
                return canPreview ? (
                  <Button variant="inline-link" onClick={() => setPreviewChannel(item)} ariaLabel={`Preview ${item.name}`}>
                    {item.name ?? "—"}
                  </Button>
                ) : (
                  item.name ?? "—"
                );
              },
              sortingField: "name",
            },
            { id: "id", header: "ID", cell: (item) => item.id },
            { id: "state", header: "State", cell: (item) => renderState(item) },
            { id: "actions", header: "Actions", cell: (item) => renderActions(item) },
            {
              id: "thumbnail",
              header: "Thumbnail",
              cell: (item) => (
                <ChannelThumbnail
                  channelId={item.id}
                  state={item.state}
                  onClick={item.state === "RUNNING" ? () => setPreviewChannel(item) : undefined}
                />
              ),
            },
          ]}
        />
      </SpaceBetween>

      <CreateChannelModal
        visible={showCreateChannelModal}
        onDismiss={() => setShowCreateChannelModal(false)}
        onSuccess={fetchChannels}
      />

      <PreviewChannelModal
        channel={previewChannel}
        visible={previewChannel !== null}
        onDismiss={() => setPreviewChannel(null)}
      />

      <Modal
        visible={deleteConfirmChannel !== null}
        onDismiss={() => setDeleteConfirmChannel(null)}
        header="Delete Channel"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDeleteConfirmChannel(null)} disabled={deleteLoading} ariaLabel="Cancel">
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={deleteLoading}
                onClick={() => deleteConfirmChannel && deleteChannel(deleteConfirmChannel)}
                ariaLabel="Delete"
              >
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Alert type="warning">
            This action cannot be undone. All AWS resources associated with this channel will be permanently deleted.
          </Alert>
          <Box>
            Are you sure you want to delete channel <b>{deleteConfirmChannel?.name ?? deleteConfirmChannel?.id}</b>?
          </Box>
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  );
};

export default ChannelsPage;
