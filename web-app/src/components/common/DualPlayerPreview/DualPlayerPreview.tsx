import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, SegmentedControl, SpaceBetween } from '@cloudscape-design/components';
import SimpleHlsPlayer from '../SimpleHlsPlayer';
import type { SimpleHlsPlayerRef, SubtitleTrackInfo } from '../SimpleHlsPlayer';
import { useSyncPlayback } from './useSyncPlayback';
import UnifiedControls from './UnifiedControls';
import MuteToggle from './MuteToggle';
import './DualPlayerPreview.css';

export interface DualPlayerPreviewProps {
    landscapeUrl?: string;
    portraitUrl?: string;
    autoplay?: boolean;
    /** Called when the view mode changes, so the parent can apply the wider modal CSS class in dual mode. */
    onViewModeChange?: (mode: 'dual' | 'single') => void;
    /** When provided, the parent controls the view mode and the built-in toggle is hidden. */
    viewMode?: 'dual' | 'single';
}

const DualPlayerPreview: React.FC<DualPlayerPreviewProps> = ({
    landscapeUrl,
    portraitUrl,
    autoplay = false,
    onViewModeChange,
    viewMode: controlledViewMode,
}) => {
    const landscapeRef = useRef<SimpleHlsPlayerRef | null>(null);
    const portraitRef = useRef<SimpleHlsPlayerRef | null>(null);

    const [viewMode, setViewMode] = useState<'dual' | 'single'>('dual');
    const effectiveViewMode = controlledViewMode ?? viewMode;
    const [mutedState, setMutedState] = useState({ landscape: true, portrait: true });
    const [landscapeError, setLandscapeError] = useState(false);
    const [portraitError, setPortraitError] = useState(false);
    const [landscapeLive, setLandscapeLive] = useState<boolean | null>(null);
    const [portraitLive, setPortraitLive] = useState<boolean | null>(null);
    const [captionsAvailable, setCaptionsAvailable] = useState(false);
    const [captionsOn, setCaptionsOn] = useState(false);
    const captionsOnRef = useRef(false);
    captionsOnRef.current = captionsOn;

    const hasBothUrls = Boolean(landscapeUrl) && Boolean(portraitUrl);
    const showPortrait = hasBothUrls && effectiveViewMode === 'dual' && !portraitError;
    const syncEnabled = hasBothUrls && effectiveViewMode === 'dual' && !landscapeError && !portraitError;

    const { currentTime, duration, isPlaying, play, pause, seek } = useSyncPlayback({
        landscapeRef,
        portraitRef,
        enabled: syncEnabled,
    });

    const handleLandscapeMuteToggle = useCallback(() => {
        const newLandscapeMuted = !mutedState.landscape;
        if (newLandscapeMuted) {
            // Muting landscape — both become muted
            setMutedState({ landscape: true, portrait: true });
            landscapeRef.current?.mute();
            portraitRef.current?.mute();
        } else {
            // Unmuting landscape — mute portrait
            setMutedState({ landscape: false, portrait: true });
            landscapeRef.current?.unmute();
            portraitRef.current?.mute();
        }
    }, [mutedState.landscape]);

    const handlePortraitMuteToggle = useCallback(() => {
        const newPortraitMuted = !mutedState.portrait;
        if (newPortraitMuted) {
            // Muting portrait — both become muted
            setMutedState({ landscape: true, portrait: true });
            landscapeRef.current?.mute();
            portraitRef.current?.mute();
        } else {
            // Unmuting portrait — mute landscape
            setMutedState({ landscape: true, portrait: false });
            landscapeRef.current?.mute();
            portraitRef.current?.unmute();
        }
    }, [mutedState.portrait]);

    const handleSubtitleTracksUpdated = useCallback((tracks: SubtitleTrackInfo[]) => {
        if (tracks.length === 0) return;
        setCaptionsAvailable(true);
        // If captions are already toggled on (e.g. a pane just (re)mounted after a
        // view-mode switch), apply the current selection so both panes stay in sync.
        if (captionsOnRef.current) {
            landscapeRef.current?.setSubtitleTrack(0);
            portraitRef.current?.setSubtitleTrack(0);
        }
    }, []);

    const handleToggleCaptions = useCallback(() => {
        setCaptionsOn(prev => {
            const next = !prev;
            const trackId = next ? 0 : -1;
            landscapeRef.current?.setSubtitleTrack(trackId);
            portraitRef.current?.setSubtitleTrack(trackId);
            return next;
        });
    }, []);

    const handleLandscapeError = useCallback(() => {
        setLandscapeError(true);
    }, []);

    const handlePortraitError = useCallback(() => {
        setPortraitError(true);
    }, []);

    const handleViewModeChange = useCallback(({ detail }: { detail: { selectedId: string } }) => {
        const newMode = detail.selectedId as 'dual' | 'single';
        setViewMode(newMode);
        onViewModeChange?.(newMode);
    }, [onViewModeChange]);

    // Notify parent of initial view mode (dual when both URLs, single otherwise)
    const effectiveMode = hasBothUrls ? effectiveViewMode : 'single';
    useEffect(() => {
        onViewModeChange?.(effectiveMode);
    }, [effectiveMode, onViewModeChange]);

    const bothFailed = landscapeError && portraitError;
    const hasLandscape = Boolean(landscapeUrl) && !landscapeError;
    const hasPortrait = Boolean(portraitUrl) && !portraitError;

    if (bothFailed) {
        return (
            <Alert type="error" header="Playback Error">
                No streams are available for preview.
            </Alert>
        );
    }

    return (
        <SpaceBetween size="s">
            {hasBothUrls && !controlledViewMode && (
                <SegmentedControl
                    selectedId={effectiveViewMode}
                    onChange={handleViewModeChange}
                    options={[
                        { id: 'dual', text: 'Dual' },
                        { id: 'single', text: 'Single' },
                    ]}
                />
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'stretch' }}>
                {/* Landscape Pane */}
                {landscapeUrl && (
                    <div style={{ flex: hasPortrait && showPortrait ? '1 1 0' : '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <SpaceBetween size="xxs">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 'bold' }}>Landscape</span>
                                {landscapeLive !== null && (
                                    <Badge color={landscapeLive ? 'red' : 'blue'}>
                                        {landscapeLive ? 'LIVE' : 'On-Demand'}
                                    </Badge>
                                )}
                                {landscapeError && <Badge color="red">Error</Badge>}
                            </div>
                            {!landscapeError && (
                                <div style={{ position: 'relative', aspectRatio: '16 / 9', backgroundColor: '#000', border: '5px solid #414d5c', borderRadius: '5px', overflow: 'hidden' }}>
                                    <SimpleHlsPlayer
                                        ref={landscapeRef}
                                        src={landscapeUrl}
                                        autoplay={autoplay}
                                        controls={false}
                                        muted={mutedState.landscape}
                                        onError={handleLandscapeError}
                                        onStreamTypeDetected={setLandscapeLive}
                                        onSubtitleTracksUpdated={handleSubtitleTracksUpdated}
                                    />
                                </div>
                            )}
                            {!landscapeError && (
                                <MuteToggle
                                    isMuted={mutedState.landscape}
                                    onToggle={handleLandscapeMuteToggle}
                                    label="Landscape"
                                />
                            )}
                        </SpaceBetween>
                        {(hasLandscape || hasPortrait) && (
                            <div style={{ marginTop: 'auto' }}>
                                <UnifiedControls
                                    isPlaying={isPlaying}
                                    currentTime={currentTime}
                                    duration={duration}
                                    onPlay={play}
                                    onPause={pause}
                                    onSeek={seek}
                                    captionsAvailable={captionsAvailable}
                                    captionsOn={captionsOn}
                                    onToggleCaptions={handleToggleCaptions}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Portrait Pane — unmounted in single mode to detach HLS */}
                {portraitUrl && (showPortrait || !landscapeUrl) && (
                    <div style={{ flex: '0 0 auto', width: '30%', minWidth: 0 }}>
                        <SpaceBetween size="xxs">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 'bold' }}>Portrait</span>
                                {portraitLive !== null && (
                                    <Badge color={portraitLive ? 'red' : 'blue'}>
                                        {portraitLive ? 'LIVE' : 'On-Demand'}
                                    </Badge>
                                )}
                                {portraitError && <Badge color="red">Error</Badge>}
                            </div>
                            {!portraitError && (
                                <div style={{ position: 'relative', aspectRatio: '9 / 16', backgroundColor: '#000', border: '5px solid #414d5c', borderRadius: '5px', overflow: 'hidden' }}>
                                    <SimpleHlsPlayer
                                        ref={portraitRef}
                                        src={portraitUrl}
                                        autoplay={autoplay}
                                        controls={false}
                                        muted={mutedState.portrait}
                                        onError={handlePortraitError}
                                        onStreamTypeDetected={setPortraitLive}
                                        onSubtitleTracksUpdated={handleSubtitleTracksUpdated}
                                    />
                                </div>
                            )}
                            {!portraitError && (
                                <MuteToggle
                                    isMuted={mutedState.portrait}
                                    onToggle={handlePortraitMuteToggle}
                                    label="Portrait"
                                />
                            )}
                        </SpaceBetween>
                    </div>
                )}
            </div>
        </SpaceBetween>
    );
};

export default DualPlayerPreview;
