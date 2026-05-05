import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        // no-op for tests; cleanup is tested via unmount
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

function createNullRef(): React.RefObject<SimpleHlsPlayerRef | null> {
    return { current: null };
}

// --- tests ------------------------------------------------------------------
describe('useSyncPlayback', () => {
    describe('play / pause / seek', () => {
        it('play() calls play on both players when enabled', () => {
            const landscape = createMockPlayerRef();
            const portrait = createMockPlayerRef();

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                }),
            );

            act(() => result.current.play());

            expect(landscape.mock.play).toHaveBeenCalledTimes(1);
            expect(portrait.mock.play).toHaveBeenCalledTimes(1);
            expect(result.current.isPlaying).toBe(true);
        });

        it('pause() calls pause on both players when enabled', () => {
            const landscape = createMockPlayerRef();
            const portrait = createMockPlayerRef();

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                }),
            );

            act(() => result.current.play());
            act(() => result.current.pause());

            expect(landscape.mock.pause).toHaveBeenCalledTimes(1);
            expect(portrait.mock.pause).toHaveBeenCalledTimes(1);
            expect(result.current.isPlaying).toBe(false);
        });

        it('seek() calls seek on both players when enabled', () => {
            const landscape = createMockPlayerRef();
            const portrait = createMockPlayerRef();

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                }),
            );

            act(() => result.current.seek(30));

            expect(landscape.mock.seek).toHaveBeenCalledWith(30);
            expect(portrait.mock.seek).toHaveBeenCalledWith(30);
            expect(result.current.currentTime).toBe(30);
        });

        it('play() only calls landscape when not enabled', () => {
            const landscape = createMockPlayerRef();
            const portrait = createMockPlayerRef();

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: false,
                }),
            );

            act(() => result.current.play());

            expect(landscape.mock.play).toHaveBeenCalledTimes(1);
            expect(portrait.mock.play).not.toHaveBeenCalled();
        });

        it('pause() only calls landscape when not enabled', () => {
            const landscape = createMockPlayerRef();
            const portrait = createMockPlayerRef();

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: false,
                }),
            );

            act(() => result.current.pause());

            expect(landscape.mock.pause).toHaveBeenCalledTimes(1);
            expect(portrait.mock.pause).not.toHaveBeenCalled();
        });

        it('seek() only calls landscape when not enabled', () => {
            const landscape = createMockPlayerRef();
            const portrait = createMockPlayerRef();

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: false,
                }),
            );

            act(() => result.current.seek(15));

            expect(landscape.mock.seek).toHaveBeenCalledWith(15);
            expect(portrait.mock.seek).not.toHaveBeenCalled();
        });
    });

    describe('rAF polling and state updates', () => {
        it('updates currentTime and duration from landscape player', () => {
            const landscape = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 10),
                getDuration: vi.fn(() => 120),
            });
            const portrait = createMockPlayerRef();

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                }),
            );

            act(() => flushRAF());

            expect(result.current.currentTime).toBe(10);
            expect(result.current.duration).toBe(120);
        });

        it('skips frame when landscape ref is null', () => {
            const nullRef = createNullRef();
            const portrait = createMockPlayerRef();

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: nullRef,
                    portraitRef: portrait.ref,
                    enabled: true,
                }),
            );

            // Should not throw, just schedule next frame
            act(() => flushRAF());

            expect(result.current.currentTime).toBe(0);
            expect(result.current.duration).toBe(0);
        });
    });

    describe('drift correction', () => {
        it('seeks portrait when drift exceeds tolerance', () => {
            const landscape = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 20),
                getDuration: vi.fn(() => 60),
            });
            const portrait = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 18), // drift = 2s > 0.5s
            });

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                    driftTolerance: 0.5,
                }),
            );

            // Must be playing for drift correction
            act(() => result.current.play());
            act(() => flushRAF());

            expect(portrait.mock.seek).toHaveBeenCalledWith(20);
        });

        it('does NOT seek portrait when drift is within tolerance', () => {
            const landscape = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 20),
                getDuration: vi.fn(() => 60),
            });
            const portrait = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 19.8), // drift = 0.2s < 0.5s
            });

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                    driftTolerance: 0.5,
                }),
            );

            act(() => result.current.play());
            act(() => flushRAF());

            expect(portrait.mock.seek).not.toHaveBeenCalled();
        });

        it('does NOT seek portrait when not playing', () => {
            const landscape = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 20),
                getDuration: vi.fn(() => 60),
            });
            const portrait = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 10), // big drift but paused
            });

            renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                    driftTolerance: 0.5,
                }),
            );

            act(() => flushRAF());

            expect(portrait.mock.seek).not.toHaveBeenCalled();
        });

        it('does NOT seek portrait when enabled is false', () => {
            const landscape = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 20),
                getDuration: vi.fn(() => 60),
            });
            const portrait = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 10),
            });

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: false,
                    driftTolerance: 0.5,
                }),
            );

            act(() => result.current.play());
            act(() => flushRAF());

            expect(portrait.mock.seek).not.toHaveBeenCalled();
        });

        it('never modifies landscape currentTime during drift correction', () => {
            const landscape = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 20),
                getDuration: vi.fn(() => 60),
            });
            const portrait = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 15),
            });

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                    driftTolerance: 0.5,
                }),
            );

            act(() => result.current.play());
            act(() => flushRAF());

            // landscape.seek should NOT have been called by the sync loop
            // (only portrait gets corrected)
            expect(landscape.mock.seek).not.toHaveBeenCalled();
        });
    });

    describe('null ref guards', () => {
        it('play() does not throw when refs are null', () => {
            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: createNullRef(),
                    portraitRef: createNullRef(),
                    enabled: true,
                }),
            );

            expect(() => act(() => result.current.play())).not.toThrow();
        });

        it('pause() does not throw when refs are null', () => {
            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: createNullRef(),
                    portraitRef: createNullRef(),
                    enabled: true,
                }),
            );

            expect(() => act(() => result.current.pause())).not.toThrow();
        });

        it('seek() does not throw when refs are null', () => {
            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: createNullRef(),
                    portraitRef: createNullRef(),
                    enabled: true,
                }),
            );

            expect(() => act(() => result.current.seek(10))).not.toThrow();
        });

        it('skips drift correction when portrait ref is null', () => {
            const landscape = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 20),
                getDuration: vi.fn(() => 60),
            });

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: createNullRef(),
                    enabled: true,
                }),
            );

            act(() => result.current.play());
            // Should not throw
            expect(() => act(() => flushRAF())).not.toThrow();
        });
    });

    describe('cleanup', () => {
        it('cancels requestAnimationFrame on unmount', () => {
            const cancelSpy = vi.fn();
            vi.stubGlobal('cancelAnimationFrame', cancelSpy);

            const landscape = createMockPlayerRef();
            const portrait = createMockPlayerRef();

            const { unmount } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                }),
            );

            unmount();

            expect(cancelSpy).toHaveBeenCalled();
        });
    });

    describe('default driftTolerance', () => {
        it('defaults to 0.5s drift tolerance', () => {
            const landscape = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 20),
                getDuration: vi.fn(() => 60),
            });
            // Drift of 0.4s — should NOT trigger seek with default 0.5s tolerance
            const portrait = createMockPlayerRef({
                getCurrentTime: vi.fn(() => 19.6),
            });

            const { result } = renderHook(() =>
                useSyncPlayback({
                    landscapeRef: landscape.ref,
                    portraitRef: portrait.ref,
                    enabled: true,
                }),
            );

            act(() => result.current.play());
            act(() => flushRAF());

            expect(portrait.mock.seek).not.toHaveBeenCalled();
        });
    });
});
