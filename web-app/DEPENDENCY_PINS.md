# Dependency Pins

Notes about why specific dependencies in `package.json` are pinned to non-current
versions. Anything pinned here should have a tracking entry so we can revisit
when upstream issues are resolved.

## `@byomakase/omakase-player` — pinned to exact `0.20.0`

**Why pinned:** Versions `0.21.x` through `0.25.x` introduce a regression that
breaks playback in our clip editor.

**Symptoms by version (bisected):**

| Version | Result |
|---|---|
| `0.20.0` | Plays correctly ✓ |
| `0.21.1` | Manifest + segments fetched, no duration loaded, no playback |
| `0.22.1` | Manifest + segments fetched, no duration loaded, no playback |
| `0.24.3` | Duration loads, segments fetched, video stays black |
| `0.25.4` | Duration loads, segments fetched, video stays black |

The same MediaPackage V2 CMAF/HLS manifest plays correctly in other browser
players (hls.js reference, video.js, native Safari). The change in failure mode
between `0.22.x` and `0.24.x` suggests at least two distinct regressions: an
API change that breaks our wrapper around `loadVideo` (0.21+), and a separate
rendering regression in 0.24+.

**Security implication:** `omakase-player@0.20.0` carries a transitive
dependency on `axios@1.0.0–1.15.1`, which has multiple high-severity advisories.
The advisories are predominantly server-side (SSRF, cloud metadata exfiltration,
NO_PROXY bypasses) or require attacker-controlled JSON input flowing through
the HTTP client. The player uses axios only to fetch HLS manifests and binary
segments from URLs we control (CloudFront → S3 with OAC). The exposure is low
in this context, but documented so it's not silently inherited.

**To revisit when:**

- Upstream fixes the playback regression in a release > 0.25.x; or
- We update `OmakasePlayer.tsx` wrapper code to match the newer `loadVideo` API
  contract used by 0.21+ (this only addresses the 0.21–0.22 failure mode; the
  0.24+ rendering regression would still need an upstream fix).

**Tracking:** open an issue at https://github.com/byomakase/omakase-player
describing the regression with a sample CMAF manifest from MediaPackage V2.
