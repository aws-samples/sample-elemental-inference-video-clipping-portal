# Changelog

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
