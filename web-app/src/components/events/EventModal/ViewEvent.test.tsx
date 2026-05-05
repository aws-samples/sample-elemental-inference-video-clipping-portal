/**
 * Unit tests for ViewEvent integration with DualPlayerPreview
 * Validates: Requirement 7.1
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Event } from '../../../types';

// --- Capture DualPlayerPreview props ----------------------------------------
let capturedProps: Record<string, any> | null = null;

vi.mock('../../common/DualPlayerPreview', () => {
    const DUAL_PLAYER_MODAL_CLASS = 'dual-player-modal';
    return {
        default: (props: any) => {
            capturedProps = props;
            return <div data-testid="dual-player-preview" />;
        },
        DUAL_PLAYER_MODAL_CLASS,
    };
});

// --- Mock services ----------------------------------------------------------
vi.mock('../../../services/apiService', () => {
    const mockInstance = {
        getClipsByEventId: vi.fn().mockResolvedValue([]),
    };
    return {
        default: {
            getInstance: () => mockInstance,
        },
    };
});

vi.mock('../../../services/videoService', () => {
    const mockInstance = {
        getVideoAssetsBucket: vi.fn().mockReturnValue('test-bucket'),
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

// --- Helpers ----------------------------------------------------------------
const makeEvent = (overrides?: Partial<Event>): Event => ({
    id: 'evt-1',
    name: 'Test Event',
    description: 'A test event',
    status: 'live',
    startDateTime: '2025-01-01T00:00:00Z',
    endDateTime: '2025-01-01T01:00:00Z',
    duration: 60,
    mediaLiveChannel: 'ch-1',
    generateMP4: false,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    clips: 0,
    autoGenerateHighlight: false,
    ...overrides,
});

const makeChannel = (overrides?: Record<string, any>) => ({
    id: 'ch-1',
    name: 'Test Channel',
    landscapeManifestUrl: 'https://example.com/landscape.m3u8',
    verticalManifestUrl: 'https://example.com/portrait.m3u8',
    manifestUrl: 'https://example.com/default.m3u8',
    ...overrides,
});

// --- Import ViewEvent AFTER mocks are set up --------------------------------
import ViewEvent from './ViewEvent';

beforeEach(() => {
    capturedProps = null;
});

// --- Tests ------------------------------------------------------------------
describe('ViewEvent integration with DualPlayerPreview', () => {
    it('renders DualPlayerPreview with correct landscapeUrl and portraitUrl from eventChannel', async () => {
        const event = makeEvent();
        const channel = makeChannel();

        render(
            <ViewEvent
                event={event}
                channels={[channel]}
                showDialog={true}
                setShowDialog={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(capturedProps).not.toBeNull();
        });

        expect(capturedProps!.landscapeUrl).toBe('https://example.com/landscape.m3u8');
        expect(capturedProps!.portraitUrl).toBe('https://example.com/portrait.m3u8');
    });

    it('falls back to manifestUrl when landscapeManifestUrl is not available', async () => {
        const event = makeEvent();
        const channel = makeChannel({
            landscapeManifestUrl: undefined,
        });

        render(
            <ViewEvent
                event={event}
                channels={[channel]}
                showDialog={true}
                setShowDialog={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(capturedProps).not.toBeNull();
        });

        expect(capturedProps!.landscapeUrl).toBe('https://example.com/default.m3u8');
        expect(capturedProps!.portraitUrl).toBe('https://example.com/portrait.m3u8');
    });

    it('does not render ButtonDropdown orientation switcher', async () => {
        const event = makeEvent();
        const channel = makeChannel();

        render(
            <ViewEvent
                event={event}
                channels={[channel]}
                showDialog={true}
                setShowDialog={vi.fn()}
            />,
        );

        // ButtonDropdown would render a button with a dropdown indicator.
        // Verify no element with the Cloudscape ButtonDropdown test pattern exists.
        const buttonDropdowns = document.querySelectorAll('[class*="button-dropdown"]');
        expect(buttonDropdowns.length).toBe(0);

        // Also verify the old orientation labels are not present
        expect(screen.queryByText('Landscape View')).not.toBeInTheDocument();
        expect(screen.queryByText('Portrait View')).not.toBeInTheDocument();
    });

    it('renders DualPlayerPreview (not the old SimpleHlsPlayer directly)', async () => {
        const event = makeEvent();
        const channel = makeChannel();

        render(
            <ViewEvent
                event={event}
                channels={[channel]}
                showDialog={true}
                setShowDialog={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId('dual-player-preview')).toBeInTheDocument();
        });
    });
});
