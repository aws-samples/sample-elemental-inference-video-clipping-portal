/**
 * Unit tests for ViewClip integration with DualPlayerPreview
 * Validates: Requirements 7.2, 7.3
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Clip } from '../../../types';

// --- Capture DualPlayerPreview props ----------------------------------------
let capturedDualProps: Record<string, any> | null = null;

vi.mock('../../common/DualPlayerPreview', () => {
    const DUAL_PLAYER_MODAL_CLASS = 'dual-player-modal';
    return {
        default: (props: any) => {
            capturedDualProps = props;
            return <div data-testid="dual-player-preview" />;
        },
        DUAL_PLAYER_MODAL_CLASS,
    };
});

vi.mock('../../common/OmakasePlayer/OmakasePlayer', () => ({
    default: vi.fn().mockImplementation((props: any) => (
        <div data-testid="omakase-player" data-src={props.videoSrc} />
    )),
}));

// --- Mock services ----------------------------------------------------------
const mockGetClipsByEventId = vi.fn().mockResolvedValue([]);
const mockGetEvent = vi.fn().mockResolvedValue({ id: 'evt-1', name: 'Test Event' });
const mockGetChannel = vi.fn().mockResolvedValue({
    id: 'ch-1',
    name: 'Test Channel',
    manifestUrl: 'https://example.com/manifest.m3u8',
    landscapeManifestUrl: 'https://example.com/landscape.m3u8',
    verticalManifestUrl: 'https://example.com/portrait.m3u8',
});
const mockUpdateClip = vi.fn().mockResolvedValue({});

vi.mock('../../../services/apiService', () => {
    const mockInstance = {
        getClipsByEventId: (...args: any[]) => mockGetClipsByEventId(...args),
        getEvent: (...args: any[]) => mockGetEvent(...args),
        getChannel: (...args: any[]) => mockGetChannel(...args),
        updateClip: (...args: any[]) => mockUpdateClip(...args),
    };
    return {
        default: {
            getInstance: () => mockInstance,
        },
    };
});

const mockGetVideoAssetsBucket = vi.fn().mockReturnValue('test-bucket');
const mockGetClipHlsUrl = vi.fn().mockResolvedValue('https://example.com/clip.m3u8');
const mockIsWithinTimeShiftWindow = vi.fn().mockReturnValue(false);
const mockGetTimeShiftUrl = vi.fn().mockImplementation(
    (manifestUrl: string, _start: number, _end: number) => `${manifestUrl}?timeshift=true`
);

vi.mock('../../../services/videoService', () => {
    const mockInstance = {
        getVideoAssetsBucket: (...args: any[]) => mockGetVideoAssetsBucket(...args),
        getClipHlsUrl: (...args: any[]) => mockGetClipHlsUrl(...args),
        isWithinTimeShiftWindow: (...args: any[]) => mockIsWithinTimeShiftWindow(...args),
        getTimeShiftUrl: (...args: any[]) => mockGetTimeShiftUrl(...args),
    };
    return {
        default: {
            getInstance: () => mockInstance,
        },
    };
});

vi.mock('../../../services/settingsService', () => ({
    default: {
        getSetting: vi.fn().mockResolvedValue({ settingValue: 'false' }),
    },
}));

vi.mock('../../../services/downloadService.ts', () => ({
    default: {
        downloadClip: vi.fn(),
        createDownloadJobs: vi.fn(),
        getDownloadJobStatus: vi.fn(),
    },
}));

// --- Helpers ----------------------------------------------------------------
const makeClip = (overrides?: Partial<Clip>): Clip => ({
    id: 'clip-1',
    name: 'Test Clip',
    description: 'A test clip',
    eventId: 'evt-1',
    eventName: 'Test Event',
    startTime: 100,
    endTime: 200,
    duration: 100,
    status: 'original',
    resolution: '1080p',
    format: 'HLS',
    mediaPackage: 'mp-1',
    mediaLiveChannel: 'ch-1',
    age: 3600,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    tags: [],
    customTags: [],
    sourceKey: 'clips/clip-1/master.m3u8',
    ...overrides,
});

// --- Import ViewClip AFTER mocks are set up ---------------------------------
import ViewClip from './ViewClip';

beforeEach(() => {
    capturedDualProps = null;
    vi.clearAllMocks();
});

// --- Tests ------------------------------------------------------------------
describe('ViewClip integration with DualPlayerPreview', () => {
    it('renders DualPlayerPreview in time-shift mode with correct URL props', async () => {
        mockIsWithinTimeShiftWindow.mockReturnValue(true);

        const clip = makeClip({ sourceKey: undefined });

        render(
            <ViewClip
                clip={clip}
                showDialog={true}
                setShowDialog={vi.fn()}
                onEditClip={vi.fn()}
                onFeedbackClip={vi.fn()}
                onRefresh={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('dual-player-preview')).toBeInTheDocument();
        });

        expect(capturedDualProps).not.toBeNull();
        expect(capturedDualProps!.landscapeUrl).toBe(
            'https://example.com/landscape.m3u8?timeshift=true',
        );
        expect(capturedDualProps!.portraitUrl).toBe(
            'https://example.com/portrait.m3u8?timeshift=true',
        );
        expect(capturedDualProps!.autoplay).toBe(false);
    });

    it('renders OmakaseVideoPlayer for non-time-shift clips', async () => {
        mockIsWithinTimeShiftWindow.mockReturnValue(false);

        const clip = makeClip({ sourceKey: 'clips/clip-1/master.m3u8' });

        render(
            <ViewClip
                clip={clip}
                showDialog={true}
                setShowDialog={vi.fn()}
                onEditClip={vi.fn()}
                onFeedbackClip={vi.fn()}
                onRefresh={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('omakase-player')).toBeInTheDocument();
        });

        expect(screen.queryByTestId('dual-player-preview')).not.toBeInTheDocument();
    });

    it('does not render ButtonDropdown orientation switcher in time-shift path', async () => {
        mockIsWithinTimeShiftWindow.mockReturnValue(true);

        const clip = makeClip({ sourceKey: undefined });

        render(
            <ViewClip
                clip={clip}
                showDialog={true}
                setShowDialog={vi.fn()}
                onEditClip={vi.fn()}
                onFeedbackClip={vi.fn()}
                onRefresh={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('dual-player-preview')).toBeInTheDocument();
        });

        // ButtonDropdown would render elements with button-dropdown class
        const buttonDropdowns = document.querySelectorAll('[class*="button-dropdown"]');
        expect(buttonDropdowns.length).toBe(0);

        // Old orientation labels should not be present
        expect(screen.queryByText('Landscape View')).not.toBeInTheDocument();
        expect(screen.queryByText('Portrait View')).not.toBeInTheDocument();
    });
});
