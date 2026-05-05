// Feature: dual-player-preview, Property 3: Mute exclusivity invariant
// Validates: Requirements 3.8, 3.9, 3.10

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// --- Mute state machine (pure logic) ----------------------------------------
// This models the mute exclusivity rules that DualPlayerPreview will manage:
// 1. Both players start muted
// 2. Unmuting a player mutes the other (at most one unmuted at any time)
// 3. Muting the currently unmuted player leaves both muted

interface MuteState {
    landscape: boolean; // true = muted
    portrait: boolean;  // true = muted
}

type ToggleTarget = 'landscape' | 'portrait';

function initialMuteState(): MuteState {
    return { landscape: true, portrait: true };
}

function applyToggle(state: MuteState, target: ToggleTarget): MuteState {
    const isMuted = state[target];
    if (isMuted) {
        // Unmuting this player → mute the other
        return {
            landscape: target === 'landscape' ? false : true,
            portrait: target === 'portrait' ? false : true,
        };
    } else {
        // Muting the currently unmuted player → both muted
        return { landscape: true, portrait: true };
    }
}

// --- Arbitraries -------------------------------------------------------------
const toggleTargetArb: fc.Arbitrary<ToggleTarget> = fc.oneof(
    fc.constant<ToggleTarget>('landscape'),
    fc.constant<ToggleTarget>('portrait'),
);

const toggleSequenceArb = fc.array(toggleTargetArb, { minLength: 1, maxLength: 30 });


// --- Property 3 tests -------------------------------------------------------
describe('Property 3: Mute exclusivity invariant', () => {
    /**
     * Validates: Requirements 3.8, 3.9, 3.10
     *
     * Both players start muted.
     */
    it('both players are muted initially', () => {
        const state = initialMuteState();
        expect(state.landscape).toBe(true);
        expect(state.portrait).toBe(true);
    });

    /**
     * Validates: Requirements 3.8, 3.9, 3.10
     *
     * For any random sequence of toggle operations, at most one player
     * is unmuted after each operation.
     */
    it('at most one player is unmuted after any sequence of toggles', () => {
        fc.assert(
            fc.property(toggleSequenceArb, (toggles) => {
                let state = initialMuteState();

                for (const target of toggles) {
                    state = applyToggle(state, target);

                    // Invariant: at most one player unmuted at any time
                    const unmutedCount =
                        (state.landscape ? 0 : 1) + (state.portrait ? 0 : 1);
                    expect(unmutedCount).toBeLessThanOrEqual(1);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Validates: Requirement 3.10
     *
     * Muting the currently unmuted player leaves both muted.
     */
    it('muting the active player leaves both muted', () => {
        fc.assert(
            fc.property(
                toggleSequenceArb,
                toggleTargetArb,
                (setupToggles, finalTarget) => {
                    // Build up an arbitrary state
                    let state = initialMuteState();
                    for (const target of setupToggles) {
                        state = applyToggle(state, target);
                    }

                    // Pre-condition: finalTarget must currently be unmuted
                    fc.pre(!state[finalTarget]);

                    // Toggle (mute) the active player
                    state = applyToggle(state, finalTarget);

                    // Both should now be muted
                    expect(state.landscape).toBe(true);
                    expect(state.portrait).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Validates: Requirement 3.9
     *
     * Unmuting a player always mutes the other.
     */
    it('unmuting one player mutes the other', () => {
        fc.assert(
            fc.property(
                toggleSequenceArb,
                toggleTargetArb,
                (setupToggles, finalTarget) => {
                    // Build up an arbitrary state
                    let state = initialMuteState();
                    for (const target of setupToggles) {
                        state = applyToggle(state, target);
                    }

                    // Pre-condition: finalTarget must currently be muted
                    fc.pre(state[finalTarget]);

                    // Toggle (unmute) the target player
                    state = applyToggle(state, finalTarget);

                    // The target should be unmuted
                    expect(state[finalTarget]).toBe(false);

                    // The other player should be muted
                    const other: ToggleTarget =
                        finalTarget === 'landscape' ? 'portrait' : 'landscape';
                    expect(state[other]).toBe(true);
                },
            ),
            { numRuns: 100 },
        );
    });
});
