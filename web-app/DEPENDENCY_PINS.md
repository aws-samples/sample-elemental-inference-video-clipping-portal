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

## `react-router` / `react-router-dom` — held at `7.x` (not upgraded to `8.x`)

**Open Dependabot alert:** "React Router: RSC Mode CSRF Bypass Allows Action
Execution Before 400 Response" (GHSA-qwww-vcr4-c8h2), high severity.

**Why not fixed:** The advisory's vulnerable range is `>= 7.12.0, < 8.3.0` and the
first patched version is `8.3.0` — a **major** upgrade from our `7.x`. There is no
`7.x` patch. More importantly, the advisory explicitly notes it *"only affects your
application if you are using the unstable RSC APIs."* This portal is a client-side
Vite SPA using `react-router-dom` in classic/data-router mode and does **not** use
the unstable React Server Components APIs, so the CSRF path is not reachable in our
usage. The exposure is effectively nil.

Upgrading to `react-router@8` solely to clear this non-applicable alert would be a
breaking major change with no security benefit for our configuration, so we are
leaving it open and documented.

**To revisit when:**

- We independently decide to move to React Router 8 for other reasons; or
- A future advisory affects the classic (non-RSC) data-router APIs we actually use.
