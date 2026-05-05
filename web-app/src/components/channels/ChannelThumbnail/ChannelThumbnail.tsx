import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box } from "@cloudscape-design/components";
import ApiService from "../../../services/apiService";

interface ChannelThumbnailProps {
  channelId: string;
  state: string;
  refreshInterval?: number; // default 10000ms
  onClick?: () => void;
}

const PLACEHOLDER_STYLE: React.CSSProperties = {
  width: 160,
  height: 90,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#1a1a2e",
  borderRadius: 4,
  color: "#888",
  fontSize: 12,
};

const THUMBNAIL_STYLE: React.CSSProperties = {
  width: 160,
  height: 90,
  objectFit: "cover",
  borderRadius: 4,
};

const ChannelThumbnail: React.FC<ChannelThumbnailProps> = ({
  channelId,
  state,
  refreshInterval = 10000,
  onClick,
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiService = ApiService.getInstance();

  const fetchThumbnail = useCallback(async () => {
    if (state !== "RUNNING") {
      setThumbnailUrl(null);
      setError(false);
      return;
    }

    try {
      const response = await apiService.makeRequest<{ thumbnails: Array<{ body: string }> }>(
        `/medialive/channels/${channelId}/thumbnail`
      );

      const body = response?.thumbnails?.[0]?.body;
      if (body) {
        setThumbnailUrl(`data:image/jpeg;base64,${body}`);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
  }, [channelId, state, apiService]);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (state === "RUNNING") {
      // Fetch immediately, then set up interval
      fetchThumbnail();
      intervalRef.current = setInterval(fetchThumbnail, refreshInterval);
    } else {
      // Reset state for non-running channels
      setThumbnailUrl(null);
      setError(false);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state, refreshInterval, fetchThumbnail]);

  // Show placeholder for non-running channels or on error
  if (state !== "RUNNING" || error || !thumbnailUrl) {
    return (
      <Box>
        <div style={PLACEHOLDER_STYLE} data-testid="thumbnail-placeholder">
          {state !== "RUNNING" ? "No preview" : "Loading..."}
        </div>
      </Box>
    );
  }

  const clickable = Boolean(onClick) && state === "RUNNING";

  return (
    <Box>
      <img
        src={thumbnailUrl}
        alt={`Channel ${channelId} thumbnail`}
        style={{ ...THUMBNAIL_STYLE, ...(clickable ? { cursor: "pointer" } : {}) }}
        data-testid="channel-thumbnail"
        onError={() => setError(true)}
        onClick={clickable ? onClick : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") onClick?.(); } : undefined}
      />
    </Box>
  );
};

export default ChannelThumbnail;
