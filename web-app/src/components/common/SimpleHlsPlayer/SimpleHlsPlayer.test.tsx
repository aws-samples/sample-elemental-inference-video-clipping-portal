import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import SimpleHlsPlayer, { type SimpleHlsPlayerRef } from './SimpleHlsPlayer';

// --- hls.js mock -----------------------------------------------------------
// vi.mock is hoisted so the factory must be fully self-contained.
// We store the event listeners on globalThis so tests can emit events.

vi.mock('hls.js', () => {
    const g = globalThis as any;
    // Ensure the listeners map exists (survives across beforeEach resets via reference)
    if (!g.__hlsMockListeners) g.__hlsMockListeners = {};

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

        on(event: string, cb: (...args: any[]) => void) {
            const listeners = (globalThis as any).__hlsMockListeners;
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
        }
        loadSource() {}
        attachMedia() {}
        destroy() {}
        startLoad() {}
        recoverMediaError() {}
    }

    return { default: HlsMock };
});

function emitHlsEvent(event: string, data?: any) {
    const listeners = (globalThis as any).__hlsMockListeners ?? {};
    (listeners[event] ?? []).forEach((cb: any) => cb(event, data));
}

beforeEach(() => {
    vi.clearAllMocks();
    // Clear all registered HLS listeners between tests
    const listeners = (globalThis as any).__hlsMockListeners;
    if (listeners) {
        for (const key of Object.keys(listeners)) {
            delete listeners[key];
        }
    }
});

// --- tests ------------------------------------------------------------------

describe('SimpleHlsPlayer', () => {
    describe('controls prop', () => {
        it('renders video with controls attribute when controls is true (default)', () => {
            render(<SimpleHlsPlayer src="https://example.com/stream.m3u8" />);
            const el = document.querySelector('video')!;
            expect(el).toBeInTheDocument();
            expect(el).toHaveAttribute('controls');
        });

        it('hides native controls when controls={false}', () => {
            render(
                <SimpleHlsPlayer src="https://example.com/stream.m3u8" controls={false} />,
            );
            const el = document.querySelector('video')!;
            expect(el).toBeInTheDocument();
            expect(el).not.toHaveAttribute('controls');
        });
    });

    describe('ref methods delegate to HTMLVideoElement', () => {
        it('pause() calls video.pause()', () => {
            const ref = createRef<SimpleHlsPlayerRef>();
            render(<SimpleHlsPlayer ref={ref} src="https://example.com/stream.m3u8" />);

            const video = document.querySelector('video')!;
            const pauseSpy = vi.spyOn(video, 'pause');

            act(() => ref.current!.pause());
            expect(pauseSpy).toHaveBeenCalled();
        });

        it('seek(t) sets video.currentTime', () => {
            const ref = createRef<SimpleHlsPlayerRef>();
            render(<SimpleHlsPlayer ref={ref} src="https://example.com/stream.m3u8" />);

            act(() => ref.current!.seek(42));
            const video = document.querySelector('video')!;
            expect(video.currentTime).toBe(42);
        });

        it('mute() sets video.muted = true', () => {
            const ref = createRef<SimpleHlsPlayerRef>();
            render(<SimpleHlsPlayer ref={ref} src="https://example.com/stream.m3u8" />);

            act(() => ref.current!.mute());
            const video = document.querySelector('video')!;
            expect(video.muted).toBe(true);
        });

        it('unmute() sets video.muted = false', () => {
            const ref = createRef<SimpleHlsPlayerRef>();
            render(<SimpleHlsPlayer ref={ref} src="https://example.com/stream.m3u8" />);

            const video = document.querySelector('video')!;
            video.muted = true;

            act(() => ref.current!.unmute());
            expect(video.muted).toBe(false);
        });

        it('getCurrentTime() returns video.currentTime', () => {
            const ref = createRef<SimpleHlsPlayerRef>();
            render(<SimpleHlsPlayer ref={ref} src="https://example.com/stream.m3u8" />);

            const video = document.querySelector('video')!;
            Object.defineProperty(video, 'currentTime', {
                value: 10,
                writable: true,
            });

            expect(ref.current!.getCurrentTime()).toBe(10);
        });

        it('getVideoElement() returns the underlying video element', () => {
            const ref = createRef<SimpleHlsPlayerRef>();
            render(<SimpleHlsPlayer ref={ref} src="https://example.com/stream.m3u8" />);

            const video = document.querySelector('video')!;
            expect(ref.current!.getVideoElement()).toBe(video);
        });
    });

    describe('onError callback', () => {
        it('fires onError when HLS emits a non-recoverable fatal error', () => {
            const onError = vi.fn();
            render(
                <SimpleHlsPlayer
                    src="https://example.com/stream.m3u8"
                    onError={onError}
                />,
            );

            act(() => {
                emitHlsEvent('hlsError', {
                    fatal: true,
                    type: 'otherError',
                    details: 'internalException',
                });
            });

            expect(onError).toHaveBeenCalledTimes(1);
            const err = onError.mock.calls[0][0];
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toContain('otherError');
            expect(err.message).toContain('internalException');
        });

        it('does NOT fire onError for non-fatal HLS errors', () => {
            const onError = vi.fn();
            render(
                <SimpleHlsPlayer
                    src="https://example.com/stream.m3u8"
                    onError={onError}
                />,
            );

            act(() => {
                emitHlsEvent('hlsError', {
                    fatal: false,
                    type: 'otherError',
                    details: 'bufferStalledError',
                });
            });

            expect(onError).not.toHaveBeenCalled();
        });

        it('does NOT fire onError for fatal network errors (recovery attempted)', () => {
            const onError = vi.fn();
            render(
                <SimpleHlsPlayer
                    src="https://example.com/stream.m3u8"
                    onError={onError}
                />,
            );

            act(() => {
                emitHlsEvent('hlsError', {
                    fatal: true,
                    type: 'networkError',
                    details: 'manifestLoadError',
                });
            });

            expect(onError).not.toHaveBeenCalled();
        });
    });
});
