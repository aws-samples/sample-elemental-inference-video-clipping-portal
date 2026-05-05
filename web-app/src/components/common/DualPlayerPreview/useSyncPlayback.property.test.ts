// Feature: dual-player-preview, Property 4: Playback synchronization with landscape as reference
// Validates: Requirements 4.1, 4.2, 4.3

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { useSyncPlayback } from './useSyncPlayback';
import type { SimpleHlsPlayerRef } from '../SimpleHlsPlayer';

// --- rAF mock ---------------------------------------------------------------
let rafCallbacks: Array<FrameRequestCallback> = [];
let rafIdCounter = 1;

function flushRAF() {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach((cb) => cb(performance.now()));
}

beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafIdCounter++;
    });
    vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
        // no-op for tests
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

// --- helpers ----------------------------------------------------------------
function createMockPlayerRef(overrides: Partial<SimpleHlsPlayerRef> = {}): {
    ref: React.RefObject<SimpleHlsPlayerRef | null>;
    mock: SimpleHlsPlayerRef;
} {
    const mock: SimpleHlsPlayerRef = {
        play: vi.fn(),
        pause: vi.fn(),
        seek: vi.fn(),
        mute: vi.fn(),
        unmute: vi.fn(),
        getCurrentTime: vi.fn(() => 0),
        getDuration: vi.fn(() => 60),
        getVideoElement: vi.fn(() => null),
        ...overrides,
    };
    return { ref: { current: mock }, mock };
}

// --- Property 4 tests -------------------------------------------------------
describe('Property 4: Playback synchronization with landscape as reference', () => {
    it('seeks portrait to landscape time when drift exceeds tolerance', () => {
        const DRIFT_TOLERANCE = 0.5;

        fc.assert(
            fc.property(
                // Generate landscape time in a reasonable video range
                fc.double({ min: 0, max: 3600, noNaN: true, noDefaultInfinity: true }),
                // Generate portrait time in a reasonable video range
                fc.double({ min: 0, max: 3600, noNaN: true, noDefaultInfinity: true }),
                (landscapeTime, portraitTime) => {
                    // Pre-condition: drift must exceed tolerance
                    fc.pre(Math.abs(landscapeTime - portraitTime) > DRIFT_TOLERANCE);

                    const landscape = createMockPlayerRef({
                        getCurrentTime: vi.fn(() => landscapeTime),
                        getDuration: vi.fn(() => 3600),
                    });
                    const portrait = createMockPlayerRef({
                        getCurrentTime: vi.fn(() => portraitTime),
                    });

                    const { result, unmount } = renderHook(() =>
                        useSyncPlayback({
                            landscapeRef: landscape.ref,
                            portraitRef: portrait.ref,
                            enabled: true,
                            driftTolerance: DRIFT_TOLERANCE,
                        }),
                    );

                    // Must be playing for drift correction to activate
                    act(() => result.current.play());
                    act(() => flushRAF());

                    // Portrait should be seeked to landscape's time
                    expect(portrait.mock.seek).toHaveBeenCalledWith(landscapeTime);

                    unmount();
                },
            ),
            { numRuns: 100 },
        );
    });

    it('landscape time is never modified by the sync engine', () => {
        const DRIFT_TOLERANCE = 0.5;

        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 3600, noNaN: true, noDefaultInfinity: true }),
                fc.double({ min: 0, max: 3600, noNaN: true, noDefaultInfinity: true }),
                (landscapeTime, portraitTime) => {
                    fc.pre(Math.abs(landscapeTime - portraitTime) > DRIFT_TOLERANCE);

                    const landscape = createMockPlayerRef({
                        getCurrentTime: vi.fn(() => landscapeTime),
                        getDuration: vi.fn(() => 3600),
                    });
                    const portrait = createMockPlayerRef({
                        getCurrentTime: vi.fn(() => portraitTime),
                    });

                    const { result, unmount } = renderHook(() =>
                        useSyncPlayback({
                            landscapeRef: landscape.ref,
                            portraitRef: portrait.ref,
                            enabled: true,
                            driftTolerance: DRIFT_TOLERANCE,
                        }),
                    );

                    // Reset seek call count after initial render
                    (landscape.mock.seek as ReturnType<typeof vi.fn>).mockClear();

                    act(() => result.current.play());
                    act(() => flushRAF());

                    // Landscape seek should never be called by the sync loop
                    expect(landscape.mock.seek).not.toHaveBeenCalled();

                    unmount();
                },
            ),
            { numRuns: 100 },
        );
    });

    it('does not seek portrait when drift is within tolerance', () => {
        const DRIFT_TOLERANCE = 0.5;

        fc.assert(
            fc.property(
                fc.double({ min: 1, max: 3600, noNaN: true, noDefaultInfinity: true }),
                // Generate a small offset within tolerance
                fc.double({ min: -0.49, max: 0.49, noNaN: true, noDefaultInfinity: true }),
                (landscapeTime, offset) => {
                    const portraitTime = landscapeTime + offset;
                    // Pre-condition: drift must be within tolerance
                    fc.pre(Math.abs(landscapeTime - portraitTime) <= DRIFT_TOLERANCE);
                    fc.pre(portraitTime >= 0);

                    const landscape = createMockPlayerRef({
                        getCurrentTime: vi.fn(() => landscapeTime),
                        getDuration: vi.fn(() => 3600),
                    });
                    const portrait = createMockPlayerRef({
                        getCurrentTime: vi.fn(() => portraitTime),
                    });

                    const { result, unmount } = renderHook(() =>
                        useSyncPlayback({
                            landscapeRef: landscape.ref,
                            portraitRef: portrait.ref,
                            enabled: true,
                            driftTolerance: DRIFT_TOLERANCE,
                        }),
                    );

                    act(() => result.current.play());
                    act(() => flushRAF());

                    // Portrait should NOT be seeked when within tolerance
                    expect(portrait.mock.seek).not.toHaveBeenCalled();

                    unmount();
                },
            ),
            { numRuns: 100 },
        );
    });
});
