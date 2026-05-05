// Feature: dual-player-preview, Property 2: Unified control commands are forwarded to all active players
// Validates: Requirements 3.2, 3.3, 3.4

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { useSyncPlayback } from './useSyncPlayback';
import type { SimpleHlsPlayerRef } from '../SimpleHlsPlayer';

// --- rAF mock ---------------------------------------------------------------
let rafCallbacks: Array<FrameRequestCallback> = [];
let rafIdCounter = 1;

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

// --- command arbitraries ----------------------------------------------------
type Command =
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'seek'; position: number };

const commandArb: fc.Arbitrary<Command> = fc.oneof(
    fc.constant<Command>({ type: 'play' }),
    fc.constant<Command>({ type: 'pause' }),
    fc.double({ min: 0, max: 3600, noNaN: true, noDefaultInfinity: true }).map(
        (position): Command => ({ type: 'seek', position }),
    ),
);

const commandSequenceArb = fc.array(commandArb, { minLength: 1, maxLength: 20 });

// --- Property 2 tests -------------------------------------------------------
describe('Property 2: Unified control commands are forwarded to all active players', () => {
    /**
     * Validates: Requirements 3.2, 3.3, 3.4
     *
     * For any random sequence of play/pause/seek commands, when enabled=true
     * (dual mode), both landscape and portrait player refs receive every
     * corresponding call.
     */
    it('forwards all commands to both players when enabled (dual mode)', () => {
        fc.assert(
            fc.property(commandSequenceArb, (commands) => {
                const landscape = createMockPlayerRef();
                const portrait = createMockPlayerRef();

                const { result, unmount } = renderHook(() =>
                    useSyncPlayback({
                        landscapeRef: landscape.ref,
                        portraitRef: portrait.ref,
                        enabled: true,
                    }),
                );

                let expectedPlayCalls = 0;
                let expectedPauseCalls = 0;
                const expectedSeekPositions: number[] = [];

                for (const cmd of commands) {
                    act(() => {
                        switch (cmd.type) {
                            case 'play':
                                result.current.play();
                                expectedPlayCalls++;
                                break;
                            case 'pause':
                                result.current.pause();
                                expectedPauseCalls++;
                                break;
                            case 'seek':
                                result.current.seek(cmd.position);
                                expectedSeekPositions.push(cmd.position);
                                break;
                        }
                    });
                }

                // Both players should have received every play call
                expect(landscape.mock.play).toHaveBeenCalledTimes(expectedPlayCalls);
                expect(portrait.mock.play).toHaveBeenCalledTimes(expectedPlayCalls);

                // Both players should have received every pause call
                expect(landscape.mock.pause).toHaveBeenCalledTimes(expectedPauseCalls);
                expect(portrait.mock.pause).toHaveBeenCalledTimes(expectedPauseCalls);

                // Both players should have received every seek call with correct positions
                expect(landscape.mock.seek).toHaveBeenCalledTimes(expectedSeekPositions.length);
                expect(portrait.mock.seek).toHaveBeenCalledTimes(expectedSeekPositions.length);
                for (const pos of expectedSeekPositions) {
                    expect(landscape.mock.seek).toHaveBeenCalledWith(pos);
                    expect(portrait.mock.seek).toHaveBeenCalledWith(pos);
                }

                unmount();
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Validates: Requirements 3.2, 3.3, 3.4
     *
     * For any random sequence of play/pause/seek commands, when enabled=false
     * (single mode), only the landscape player receives the commands; the
     * portrait player receives none.
     */
    it('forwards commands only to landscape when not enabled (single mode)', () => {
        fc.assert(
            fc.property(commandSequenceArb, (commands) => {
                const landscape = createMockPlayerRef();
                const portrait = createMockPlayerRef();

                const { result, unmount } = renderHook(() =>
                    useSyncPlayback({
                        landscapeRef: landscape.ref,
                        portraitRef: portrait.ref,
                        enabled: false,
                    }),
                );

                let expectedPlayCalls = 0;
                let expectedPauseCalls = 0;
                const expectedSeekPositions: number[] = [];

                for (const cmd of commands) {
                    act(() => {
                        switch (cmd.type) {
                            case 'play':
                                result.current.play();
                                expectedPlayCalls++;
                                break;
                            case 'pause':
                                result.current.pause();
                                expectedPauseCalls++;
                                break;
                            case 'seek':
                                result.current.seek(cmd.position);
                                expectedSeekPositions.push(cmd.position);
                                break;
                        }
                    });
                }

                // Landscape should have received all commands
                expect(landscape.mock.play).toHaveBeenCalledTimes(expectedPlayCalls);
                expect(landscape.mock.pause).toHaveBeenCalledTimes(expectedPauseCalls);
                expect(landscape.mock.seek).toHaveBeenCalledTimes(expectedSeekPositions.length);

                // Portrait should have received NO commands
                expect(portrait.mock.play).not.toHaveBeenCalled();
                expect(portrait.mock.pause).not.toHaveBeenCalled();
                expect(portrait.mock.seek).not.toHaveBeenCalled();

                unmount();
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Validates: Requirements 3.2, 3.3, 3.4
     *
     * After the last command in any sequence, the hook's isPlaying state
     * should reflect the final command: true after play, false after pause,
     * unchanged after seek.
     */
    it('isPlaying state reflects the last play/pause command in any sequence', () => {
        fc.assert(
            fc.property(commandSequenceArb, (commands) => {
                const landscape = createMockPlayerRef();
                const portrait = createMockPlayerRef();

                const { result, unmount } = renderHook(() =>
                    useSyncPlayback({
                        landscapeRef: landscape.ref,
                        portraitRef: portrait.ref,
                        enabled: true,
                    }),
                );

                // Track expected isPlaying — starts false
                let expectedIsPlaying = false;

                for (const cmd of commands) {
                    act(() => {
                        switch (cmd.type) {
                            case 'play':
                                result.current.play();
                                expectedIsPlaying = true;
                                break;
                            case 'pause':
                                result.current.pause();
                                expectedIsPlaying = false;
                                break;
                            case 'seek':
                                result.current.seek(cmd.position);
                                // seek does not change isPlaying
                                break;
                        }
                    });
                }

                expect(result.current.isPlaying).toBe(expectedIsPlaying);

                unmount();
            }),
            { numRuns: 100 },
        );
    });
});
