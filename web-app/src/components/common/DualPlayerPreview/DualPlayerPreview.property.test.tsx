// Feature: dual-player-preview, Property 1: Layout renders correct number of players based on URL availability
// Validates: Requirements 1.1, 1.2, 1.3

import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import DualPlayerPreview from './DualPlayerPreview';

// --- hls.js mock (same pattern as SimpleHlsPlayer.test.tsx) -----------------
// Track HLS instances so Property 7 can trigger fatal errors on specific players
const hlsInstances: Array<InstanceType<typeof import('hls.js').default>> = [];

vi.mock('hls.js', () => {
    class HlsMock {
        static isSupported = () => true;
        static Events = {
            ERROR: 'hlsError',
            MANIFEST_PARSED: 'hlsManifestParsed',
        };
        static ErrorTypes = {
            NETWORK_ERROR: 'networkError',
            MEDIA_ERROR: 'mediaError',
            OTHER_ERROR: 'otherError',
        };
        _listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        constructor() {
            hlsInstances.push(this as never);
        }
        on(event: string, cb: (...args: unknown[]) => void) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(cb);
        }
        emit(event: string, ...args: unknown[]) {
            (this._listeners[event] ?? []).forEach((cb) => cb(...args));
        }
        loadSource() {}
        attachMedia() {}
        destroy() {}
        startLoad() {}
        recoverMediaError() {}
    }
    return { default: HlsMock };
});

// --- rAF mock (needed by useSyncPlayback) -----------------------------------
beforeEach(() => {
    hlsInstances.length = 0;
    vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => 1);
    vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

// --- Arbitraries ------------------------------------------------------------
const optionalUrlArb = fc.oneof(
    fc.constant(undefined),
    fc.webUrl().map((u) => u),
);

// --- Property 1 tests -------------------------------------------------------
describe('Property 1: Layout renders correct number of players based on URL availability', () => {
    /**
     * Validates: Requirements 1.1, 1.2, 1.3
     *
     * For any combination of optional landscape/portrait URL strings,
     * the number of rendered video elements equals the number of
     * non-empty URLs provided.
     */
    it('player count matches non-empty URL count', () => {
        fc.assert(
            fc.property(optionalUrlArb, optionalUrlArb, (landscapeUrl, portraitUrl) => {
                // At least one URL must be provided for the component to render players
                fc.pre(landscapeUrl !== undefined || portraitUrl !== undefined);

                const { container } = render(
                    <DualPlayerPreview landscapeUrl={landscapeUrl} portraitUrl={portraitUrl} />,
                );

                const videoElements = container.querySelectorAll('video');
                const expectedCount =
                    (landscapeUrl !== undefined ? 1 : 0) + (portraitUrl !== undefined ? 1 : 0);

                expect(videoElements.length).toBe(expectedCount);

                cleanup();
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: dual-player-preview, Property 5: Single mode detaches portrait player
// --- Property 5 tests -------------------------------------------------------
describe('Property 5: Single mode detaches portrait player', () => {
    /**
     * Validates: Requirements 5.3
     *
     * For any DualPlayerPreview rendered with both URLs available,
     * switching to single mode should result in only the landscape
     * player being rendered (1 video element) — the portrait player
     * is unmounted/detached.
     */
    const urlArb = fc.webUrl();

    it('switching to single mode leaves only landscape player active', () => {
        fc.assert(
            fc.property(urlArb, urlArb, (landscapeUrl, portraitUrl) => {
                const { container } = render(
                    <DualPlayerPreview landscapeUrl={landscapeUrl} portraitUrl={portraitUrl} />,
                );

                // Initially both players should be rendered
                const initialVideos = container.querySelectorAll('video');
                expect(initialVideos.length).toBe(2);

                // Click the "Single" segment button (Cloudscape renders data-testid={id})
                const singleButton = container.querySelector('button[data-testid="single"]');
                expect(singleButton).not.toBeNull();
                fireEvent.click(singleButton!);

                // After switching to single mode, only landscape player should remain
                const videosAfter = container.querySelectorAll('video');
                expect(videosAfter.length).toBe(1);

                cleanup();
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: dual-player-preview, Property 6: View mode round trip restores dual state
// --- Property 6 tests -------------------------------------------------------
describe('Property 6: View mode round trip restores dual state', () => {
    /**
     * Validates: Requirements 5.3, 5.4
     *
     * For any DualPlayerPreview rendered with both URLs available,
     * switching to single mode and then back to dual mode should
     * result in both players being active (2 video elements) and
     * the portrait player re-attached.
     */
    const urlArb = fc.webUrl();

    it('toggling single then back to dual restores both players', () => {
        fc.assert(
            fc.property(urlArb, urlArb, (landscapeUrl, portraitUrl) => {
                const { container } = render(
                    <DualPlayerPreview landscapeUrl={landscapeUrl} portraitUrl={portraitUrl} />,
                );

                // Initially both players should be rendered in dual mode
                const initialVideos = container.querySelectorAll('video');
                expect(initialVideos.length).toBe(2);

                // Switch to single mode
                const singleButton = container.querySelector('button[data-testid="single"]');
                expect(singleButton).not.toBeNull();
                fireEvent.click(singleButton!);

                // Verify only landscape player remains
                const singleModeVideos = container.querySelectorAll('video');
                expect(singleModeVideos.length).toBe(1);

                // Switch back to dual mode
                const dualButton = container.querySelector('button[data-testid="dual"]');
                expect(dualButton).not.toBeNull();
                fireEvent.click(dualButton!);

                // Both players should be active again
                const restoredVideos = container.querySelectorAll('video');
                expect(restoredVideos.length).toBe(2);

                cleanup();
            }),
            { numRuns: 100 },
        );
    });
});

// Feature: dual-player-preview, Property 7: Single-player error isolation
// --- Property 7 tests -------------------------------------------------------
describe('Property 7: Single-player error isolation', () => {
    /**
     * Validates: Requirements 6.1, 6.2
     *
     * For any player (landscape or portrait) that encounters an HLS fatal error,
     * the other player should continue functioning without interruption.
     * The failed player's error should not propagate to or affect the healthy
     * player's playback state.
     */

    // Arbitrary that picks which player should fail
    const failingPlayerArb = fc.constantFrom<'landscape' | 'portrait'>('landscape', 'portrait');
    const urlArb = fc.webUrl();

    it('non-failing player continues when the other player encounters a fatal error', () => {
        fc.assert(
            fc.property(urlArb, urlArb, failingPlayerArb, (landscapeUrl, portraitUrl, failingPlayer) => {
                // Reset instance tracking for this iteration
                hlsInstances.length = 0;

                const { container } = render(
                    <DualPlayerPreview landscapeUrl={landscapeUrl} portraitUrl={portraitUrl} />,
                );

                // Both players should be rendered initially
                const initialVideos = container.querySelectorAll('video');
                expect(initialVideos.length).toBe(2);

                // Two HLS instances created for this render (landscape=0, portrait=1)
                expect(hlsInstances.length).toBe(2);
                const instanceIndex = failingPlayer === 'landscape' ? 0 : 1;
                const failingInstance = hlsInstances[instanceIndex] as unknown as {
                    emit: (event: string, ...args: unknown[]) => void;
                };

                // Trigger a fatal OTHER_ERROR on the chosen player's HLS instance
                act(() => {
                    failingInstance.emit('hlsError', 'hlsError', {
                        fatal: true,
                        type: 'otherError',
                        details: 'simulated fatal error',
                    });
                });

                // The surviving player should still have its video element
                const videosAfter = container.querySelectorAll('video');
                expect(videosAfter.length).toBe(1);

                // The "both failed" alert should NOT be shown
                const allText = container.textContent ?? '';
                expect(allText).not.toContain('No streams are available');

                if (failingPlayer === 'landscape') {
                    // Landscape pane still renders with label + error badge, but no video
                    // Portrait pane renders normally with video
                    expect(allText).toContain('Landscape');
                    expect(allText).toContain('Error');
                } else {
                    // Portrait pane is fully removed; landscape pane has its video
                    expect(allText).toContain('Landscape');
                }

                cleanup();
            }),
            { numRuns: 100 },
        );
    });
});
