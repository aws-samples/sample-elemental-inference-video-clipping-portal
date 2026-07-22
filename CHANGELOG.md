# Changelog

## 1.0.28

- Applied non-breaking `npm audit fix` across `web-app`, `deploy`, and `api` (lockfile-only; no `package.json` changes): cleared all fixable high/low advisories, bringing `api` to 0 vulnerabilities and `deploy` to a single upstream-bundled `aws-cdk-lib` transitive
- Left `@byomakase/omakase-player` pinned at `0.20.0` (its axios high is the documented accepted risk in `DEPENDENCY_PINS.md`; the only "fix" is a breaking major upgrade that regresses the clip editor)
- Verified `api`/`deploy`/`web-app` builds and the 51 web-app tests still pass after the updates

## 1.0.27

- Reviewed and corrected the README "How It Works" steps: fixed typos and grammar in the smart subtitles steps, removed a redundant/inaccurate TTML reference, and restored the missing step describing MediaLive sending the landscape and portrait video encodes to MediaPackage

## 1.0.26

- Documented the deliberate architecture choice of grouping the landscape and smart-cropped portrait encodes into a single MediaPackage output group: added an "Architecture Notes" section to the README explaining the trade-off versus the recommended production approach of separating orientations into different MediaLive output groups

## 1.0.25

- Smart Subtitles (web playback): the dual/single channel preview player can now render the TTML caption track carried in the MediaPackage V2 manifest. A CC toggle appears in the player controls only when a subtitle track is detected, and captions default to off until the user opts in
- `SimpleHlsPlayer` exposes subtitle-track discovery (`onSubtitleTracksUpdated`) and imperative `getSubtitleTracks` / `setSubtitleTrack` methods, backed by hls.js IMSC1 rendering (with a native TextTrack fallback for Safari)
- `DualPlayerPreview` keeps caption state in sync across the landscape and portrait panes, re-applying the selection when a pane remounts after a view-mode switch

## 1.0.24

- Refined the Smart Subtitles caption description to match validated MediaLive settings: `TtmlDestinationSettings.StyleControl` set to `USE_CONFIGURED` and added `Accessibility: DOES_NOT_IMPLEMENT_ACCESSIBILITY_FEATURES`
- Backend Smart Subtitles path now confirmed working end-to-end against live MediaLive/MediaPackage V2 (channel creates, TTML caption track ingests, manifest carries subtitles)

## 1.0.23

- Fixed MediaPackage V2 rejecting the caption segment ingest with HTTP 400: switched the Smart Subtitles caption description from WebVTT to TTML (`TtmlDestinationSettings` with `StyleControl: PASSTHROUGH`) — MediaPackage V2 / CMAF Ingest output groups require TTML; WebVTT is only valid for HLS / MediaPackage V1
- Updated `smart_subtitles.py`, its tests, and the Create Channel form wording accordingly

## 1.0.22

- Fixed Smart Subtitles channel creation failing with "Invalid enum value 'DELAY_VIDEO'": corrected `CaptionSynchronizationMode` to the actual MediaLive enum values `VIDEO_ALIGNED_CAPTIONS` (default) and `NO_VIDEO_DELAY` in `smart_subtitles.py` and the `channels-python` validator; updated tests. Live channel creation confirmed the rest of the caption wiring (selector, WebVTT description, caption output) is structurally correct

## 1.0.21

- Smart Subtitles (web form): the Create Channel modal now has an "Enable Smart Subtitles" toggle and a language picker (9 supported languages), shown only when enabled; the selection flows into the `subtitles` object the channels API accepts
- Extended `ChannelFormState` with `subtitlesEnabled` / `subtitleLanguage` and `apiService.createChannel` with an optional `subtitles` param

## 1.0.20

- Smart Subtitles (backend, part 2 — channel wiring): channel creation now accepts an optional `subtitles` config that flows through the channels API → CreateChannel state machine → both the inference feed and the MediaLive channel
- Added `api/src/medialive-api-client/smart_subtitles.py`, an idempotent merge transform that injects the caption selector (referencing the feed's subtitling output), a WebVTT caption description, and a caption output into the MediaPackage output group; 15 unit tests
- `channels-python` validates/normalizes the `subtitles` request field and defaults to disabled so the state machine can always reference `$.subtitles`

## 1.0.19

- Smart Subtitles (backend, part 1): `create-feed-lambda` now accepts an optional `subtitles` config and adds an ENABLED Elemental Inference `subtitling-output` (language, aspect ratio, dictionary, profanity filter) alongside the clipping output; preserved across the clipping enable/disable lifecycle
- Pinned `boto3>=1.43.0` in the `create-feed-lambda` and `medialive-api-client` requirements — the verified minimum SDK version that includes the Elemental Inference `SubtitlingConfig` and MediaLive `SmartSubtitleSourceSettings` models (1.42.97 lacks both)
- Added 7 unit tests covering the subtitling output (enable/disable, validation of language/profanity/aspect ratio, backward compatibility)

## 1.0.18

- Standardized all application Node.js Lambdas on ARM64 (Graviton): added `architecture: ARM_64` to JobsApi, Events, Clips, Templates, and SystemSettings functions, and flipped MedialiveStatus from X86_64 to ARM64 — previously 6 of 7 Node functions ran on x86
- Upgraded the two inline Python Lambdas in `amplify-config-lambda-construct.ts` (AuthorizerLambda, AmplifyConfigLambda) from the deprecated Python 3.8 runtime to Python 3.12 and moved them to ARM64
- Verified with `cdk synth --all`: every application Lambda now runs on ARM64 with a current runtime (0 x86_64, 0 python3.8 in the synthesized templates); remaining nodejs22.x/python3.13 entries are CDK-managed custom-resource handlers

## 1.0.17

- Migrated all 13 Python Lambdas off the experimental `@aws-cdk/aws-lambda-python-alpha` package onto a small `createPythonFunction` helper built on stable `aws-cdk-lib` APIs (`lambda.Function` + `Code.fromAsset` bundling); removed the alpha dependency from `deploy/package.json`
- Standardized the MediaLive API client Lambda onto ARM64 — it was the only Python function defaulting to X86_64, so all Python Lambdas now run on Graviton
- Pinned the bundling image platform to the target architecture so any future native-wheel dependency resolves correctly

## 1.0.16

- Removed the "Publish Clips" button from the clips list — it only flipped a `status: "published"` field that nothing else in the app reacted to (no S3 push, no public URL, no downstream notification), and the matching status filter that surfaced it was already removed in v1.0.10
- Cleaned up the related plumbing: `showPublish` / `onPublishClips` props on `ClipsList`, `handlePublishClips` in `HomePage`, the `"published"` entries in `renderClipStatus` (ClipsList, ViewClip, shared columnRenderers), and `"published"` from the `ClipStatus` type union in both `web-app/types/index.ts` and `api/src/clips/index.ts`

## 1.0.15

- Root-level `npm run deploy` now runs `python3 build.py` before invoking CDK so the deployment always picks up the latest web-app/api builds — previously stale `web-app/dist` content could be uploaded if the user forgot to build first
- Added `npm run deploy.skip-build` as an escape hatch retaining the old behavior for cases where nothing has changed since the last build
- Updated `DEPLOYMENT_GUIDE.md` Sections 3 and 4 to reflect that the standalone build step is now optional

## 1.0.14

- Cleared the `api` package npm audit (1 moderate → 0): removed the unused `uuid` and `@types/uuid` declarations — Lambdas use `require("crypto").randomUUID()` directly
- Reduced the `deploy` package npm audit (1 high + 3 moderate → 1 moderate): removed the unused legacy v2 `aws-sdk` declaration (CDK uses bundled v3 `@aws-sdk/*` packages internally), cleared the transitive `uuid` issue, and bumped `aws-cdk-lib` 2.200.1 → 2.257.0 to pull a fixed `fast-uri`
- Added `AwsSolutions-COG8` to the cdk-nag suppression list (new rule introduced with the cdk-nag/cdk-lib bump that requires the Cognito Plus feature plan, not appropriate for a prototype)
- Remaining `deploy` `brace-expansion` moderate is bundled inside `aws-cdk-lib`'s tarball and is not reachable via npm overrides — needs an upstream CDK release

## 1.0.13

- Pinned `@byomakase/omakase-player` to exact version `0.20.0` after bisecting a clip editor playback regression: 0.21–0.22 fail to load duration or play, 0.24+ load duration but show black video. Same MediaPackage V2 CMAF manifests play in other browser players, so the regression is upstream
- Documented the pin and accepted axios transitive-vulnerability exposure in `web-app/DEPENDENCY_PINS.md`, with a bisect table for future revisits
- Ran `npm audit fix` to upgrade `js-cookie` (transitive via Amplify) past advisory GHSA-qjx8-664m-686j, leaving only the documented axios transitive advisories outstanding

## 1.0.12

- Improved the clip editor's behavior when opening a clip that hasn't been harvested yet: instead of rendering a broken Omakase player with a brief "Preparing Content" flash, the page now shows a clear info panel explaining that a harvest has been initiated, what orientations are missing, and roughly how long to wait
- Added 5-second polling of the clip record while the editor is awaiting a harvest, so the editor lights up automatically as soon as the first sourceKey lands in DynamoDB; polling is cleaned up on completion and on unmount
- Added diagnostic logging on the harvest trigger so the browser console makes it clear whether a state machine was actually started or the download API skipped because an existing job was in flight; harvest-trigger errors are also surfaced inline with a manual "Refresh" button on the alert

## 1.0.10

- Removed the redundant "All Key Moments" status filter dropdown from the clips list — the Harvest Status column already exposes a built-in filter, and the dropdown's option list was out of sync with the actual statuses the codebase produces (no entries for `archived` or `detected`, stale entries for `Processing`/`Completed`/`Reviewed`/`Published` etc.)

## 1.0.9

- Fixed clip Harvest Status column staying on "Pending" after manual prepare-download: the download workflow now promotes `clip.status` from a pre-harvest state (`detected`/`original`/`processing`/`failed`) to `archived` once a harvest branch completes, mirroring what auto-harvest already does via `harvest-validate`'s `finalize_auto_harvest` action
- The new `PromoteClipStatusToArchived` state uses a DynamoDB ConditionExpression so it never overwrites later-stage statuses like `modified`, `reviewed`, or `published`, and any failure (including the conditional check) falls through to the next state safely

## 1.0.8

- Added `elemental-inference:PutMedia` to the MediaLive service role and API client Lambda role — this is the runtime call MediaLive uses to push encoded video frames into the Starfish inference feed (paired with the existing `GetMetadata` permission for reading inference results)

## 1.0.7

- Fixed `npm run deploy` failing from inside `deploy/` with "specify which stacks to use or specify --all" — the script now passes `--all` and forwards the `STACK_NAME` env var as CDK context, matching the root-level deploy script
- Added a matching `destroy` script to `deploy/package.json` so cleanup also works from either directory

## 1.0.6

- Fixed orphaned MediaLive inputs after channel deletion: the DeleteChannel state machine now polls DescribeChannel until the channel is fully deleted (or 3-minute cap) before attempting DeleteInput, instead of racing the asynchronous DeleteChannel and hitting `Input <id> is busy, it cannot be deleted`
- Added a distinct `InputBusyError` exception class in the MediaLive API client Lambda; the handler re-raises it so the state machine can apply a targeted `Retry` (4 attempts, 15s base, 1.5x backoff) as a backstop on `DeleteMediaLiveInput`
- Made `describe_channel`, `delete_channel`, and `delete_input` idempotent against `NotFoundException` so the cleanup workflow stays clean if a step has already run

## 1.0.5

- Fixed clip harvest status display: DynamoDB String Set attributes (e.g. `harvestedOrientations` written by the harvest state machine) were being unmarshalled as JS `Set` instances and serialized by `JSON.stringify` as `{}`, so the UI never saw harvested orientations after a prepare-download flow
- Added `api/src/shared/dynamodb-json.ts` with a reusable `jsonReplacer` / `stringifyForApi` helper that converts `Set` instances to arrays during serialization
- Wired `stringifyForApi` into the `createResponse` helper of `clips`, `events`, `templates`, `system-settings`, and `jobs-api` Lambdas so any future Set-typed attributes serialize correctly

## 1.0.4

- Removed unused permissions from the MediaLive service role and API client Lambda role: `mediapackage:*` (v1), `mediastore:*`, `mediaconnect:Managed*`, and the `ec2:*` networking block — none of these match the channel configuration produced by `create-channel.asl.json`
- Added `elemental-inference:GetMetadata` to both roles so MediaLive can fetch Starfish feed metadata at runtime when `StarfishOutputs` are configured on a video description
- Updated the cdk-nag `AwsSolutions-IAM5` suppression in `medialive-lambda-construct.ts` to drop the no-longer-applicable `mediapackage:*` entry
- Reordered the web app primary navigation (Channels now precedes Events) and removed commented-out placeholder items for Highlight Reel Builder, Generated Reels, Feedback, and Notifications

## 1.0.3

- `web-app/vite.config.ts` now throws a clear error at startup when `VITE_CLOUDFRONT_URL` is missing, replacing a silent fallback to a non-existent hardcoded CloudFront domain that caused `/api/*` requests to return Vite's HTML SPA fallback
- `web-app/src/services/apiService.ts` switched from `process.env.VITE_*` to `import.meta.env.VITE_*` for proper Vite-native env var access

## 1.0.2

- Made DEPLOYMENT_GUIDE.md Section 6 (Local Development) consistent: all three steps now run from the project root (no more `cd web-app` hops)

## 1.0.1

- Fixed `scripts/fetch-config.sh` default stack name to match the CDK app default (`sample-clipping-portal`) and added `STACK_NAME` env var fallback
- Rewrote DEPLOYMENT_GUIDE.md Section 6 (Local Development) to document the required `web-app/public/config.json` step and explain why `VITE_CLOUDFRONT_URL` alone causes a `JSON.parse` error
- Corrected DEPLOYMENT_GUIDE.md Section 4 stack name guidance and updated Section 7's manual `aws cloudformation describe-stacks` example

## 1.0.0

- First public release candidate
- Full documentation suite: README, Deployment Guide, User Guide, Data Flow Diagram
- Security review complete: cdk-nag compliant, npm audit clean, ASH scan findings resolved

## 0.1.10

- Added CKV_DOCKER_3 checkov suppression with justification to api/Dockerfile (Lambda base images manage user context internally)
- Removed unused pre-built medialive-client-layer zip files from deploy/assets (native boto3 SDK is sufficient)

## 0.1.9

- Generated comprehensive threat model using STRIDE methodology (9 threats, 9 mitigations, 14 components)
- Exported to .threatmodel/threat-model.json (Threat Composer compatible) and .threatmodel/threat-model.md

## 0.1.8

- Added DATA_FLOW_DIAGRAM.md with 7 detailed data flows, storage summary, trust boundaries, and auth overview

## 0.1.7

- Added SECURITY_REVIEW.md with npm audit and cdk-nag (AwsSolutionsChecks) results for security review

## 0.1.6

- Added evaluation/sample-use disclaimer to README introduction clarifying the project is not intended for production use

## 0.1.5

- Comprehensive documentation review and update: added Navigation and User Preferences sections to USER_GUIDE.md, fixed API endpoint methods and paths, clarified UI vs API-only settings
- Consolidated web-app/CONFIG_MANAGEMENT.md into DEPLOYMENT_GUIDE.md for better discoverability
- Updated in-app DocumentationPage to reflect actual Preferences and System Settings functionality

## 0.1.4

- Resolved all npm audit vulnerabilities across web-app (44→0), api (29→0), and deploy (13→2)
- Upgraded @byomakase/omakase-player to 0.25.3, removed vulnerable axios override
- Removed unused git-repo-name dependency (prototype pollution vuln)
- Upgraded CDK CLI to 2.1121.0 to match aws-cdk-lib 2.253.1 schema version

## 0.1.3

- Resolved 42 of 44 npm audit vulnerabilities via `npm audit fix` (AWS SDK, Amplify, vite, rollup, uuid)
- Remaining 2 high-severity axios vulnerabilities require omakase-player upgrade to 0.25.3

## 0.1.2

- Fixed missing elemental-inference:AssociateFeed and DisassociateFeed permissions on medialive-api-client Lambda execution role

## 0.1.1

- Added versioning system with VERSION file, CHANGELOG.md, and Kiro hook for auto-increment
- Web app now displays current version in the user menu dropdown
- Fixed CloudFormation circular dependency, esbuild pinning, cdk-nag errors, and Elemental Inference IAM permissions

## 0.1.0

- Initial versioned release
- Video clipping portal with Elemental Inference smart-cropping and highlight detection
- Channel management via Step Functions state machines
- Harvest pipeline with auto-harvest workflow
- Download pipeline with MediaConvert transcoding
- Web application with clip editor, event management, and template system
