#!/usr/bin/env python3
"""
Smart Subtitles wiring for MediaLive channels.

Given a channel's input attachments and encoder settings, this module injects the
three pieces MediaLive needs to consume Elemental Inference Smart Subtitles:

1. A caption selector on each input attachment, whose SmartSubtitleSourceSettings
   references the Inference feed's subtitling output by name.
2. A caption description in the encoder settings that references that selector and
   emits WebVTT.
3. A caption output in each MediaPackage output group referencing the description.

The transform is an *idempotent merge*: it operates on deep copies, skips pieces
that are already present (by stable name), and leaves everything else untouched.
Writing it as a merge (rather than assuming an empty/templated structure) keeps it
correct if the encoder settings are ever user-supplied rather than the standard
template.

The subtitling feed output name must match SUBTITLING_OUTPUT_NAME in the
create-feed Lambda.
"""

import copy
from typing import Any, Dict, List, Optional, Tuple

# Must match SUBTITLING_OUTPUT_NAME in api/src/create-feed-lambda/main.py
SUBTITLING_FEED_OUTPUT = "subtitling-output"

# Stable names so the merge is idempotent across repeated applications.
CAPTION_SELECTOR_NAME = "smart-subtitles"
CAPTION_DESCRIPTION_NAME = "smart-subtitles"
CAPTION_OUTPUT_NAME = "captions"

DEFAULT_SYNC_MODE = "DELAY_VIDEO"
VALID_SYNC_MODES = {"DELAY_VIDEO", "SYNCED"}


def _iso639_2(language: str) -> str:
    """
    Reduce an Inference transcription language (e.g. 'eng-us') to the ISO 639-2
    three-letter code MediaLive's LanguageCode expects (e.g. 'eng').
    """
    return language.split("-", 1)[0]


def _add_caption_selector(
    input_attachments: List[Dict[str, Any]],
    language_code: str,
    sync_mode: str,
) -> List[Dict[str, Any]]:
    """Add the Smart Subtitles caption selector to every input attachment (idempotent)."""
    selector = {
        "Name": CAPTION_SELECTOR_NAME,
        "LanguageCode": language_code,
        "SelectorSettings": {
            "SmartSubtitleSourceSettings": {
                "InferenceFeedOutput": SUBTITLING_FEED_OUTPUT,
                "CaptionSynchronizationMode": sync_mode,
            }
        },
    }

    for attachment in input_attachments:
        settings = attachment.setdefault("InputSettings", {})
        selectors = settings.setdefault("CaptionSelectors", [])
        if not any(s.get("Name") == CAPTION_SELECTOR_NAME for s in selectors):
            selectors.append(copy.deepcopy(selector))

    return input_attachments


def _add_caption_description(
    encoder_settings: Dict[str, Any],
    language_code: str,
) -> Dict[str, Any]:
    """Add a WebVTT caption description referencing the selector (idempotent)."""
    descriptions = encoder_settings.setdefault("CaptionDescriptions", [])
    if not any(d.get("Name") == CAPTION_DESCRIPTION_NAME for d in descriptions):
        descriptions.append(
            {
                "Name": CAPTION_DESCRIPTION_NAME,
                "CaptionSelectorName": CAPTION_SELECTOR_NAME,
                "LanguageCode": language_code,
                "DestinationSettings": {"WebvttDestinationSettings": {}},
            }
        )
    return encoder_settings


def _add_caption_output(encoder_settings: Dict[str, Any]) -> Dict[str, Any]:
    """
    Add a caption output referencing the caption description to every MediaPackage
    output group (idempotent). Only MediaPackage output groups are targeted, since
    that is the destination this portal uses.
    """
    for group in encoder_settings.get("OutputGroups", []):
        group_settings = group.get("OutputGroupSettings", {})
        if "MediaPackageGroupSettings" not in group_settings:
            continue

        outputs = group.setdefault("Outputs", [])
        if any(o.get("OutputName") == CAPTION_OUTPUT_NAME for o in outputs):
            continue

        outputs.append(
            {
                "OutputName": CAPTION_OUTPUT_NAME,
                "CaptionDescriptionNames": [CAPTION_DESCRIPTION_NAME],
                "OutputSettings": {"MediaPackageOutputSettings": {}},
            }
        )

    return encoder_settings


def apply_smart_subtitles(
    input_attachments: Optional[List[Dict[str, Any]]],
    encoder_settings: Optional[Dict[str, Any]],
    subtitles: Optional[Dict[str, Any]],
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[Dict[str, Any]]]:
    """
    Return (input_attachments, encoder_settings) with Smart Subtitles wiring merged in.

    No-op (returns the inputs unchanged) when subtitles is falsy or not enabled.
    Operates on deep copies; the originals are not mutated.

    subtitles shape:
        {
            "enabled": true,
            "language": "eng-us",                        # required when enabled
            "captionSynchronizationMode": "DELAY_VIDEO"  # optional; DELAY_VIDEO | SYNCED
        }
    """
    if not subtitles or not subtitles.get("enabled"):
        return input_attachments, encoder_settings

    language = subtitles.get("language")
    if not language:
        raise ValueError("subtitles.enabled is true but subtitles.language is missing")

    sync_mode = subtitles.get("captionSynchronizationMode", DEFAULT_SYNC_MODE)
    if sync_mode not in VALID_SYNC_MODES:
        raise ValueError(
            f"Invalid captionSynchronizationMode: {sync_mode!r}. "
            f"Must be one of {sorted(VALID_SYNC_MODES)}"
        )

    if not input_attachments:
        raise ValueError("Cannot enable subtitles: channel has no input attachments")
    if not encoder_settings:
        raise ValueError("Cannot enable subtitles: channel has no encoder settings")

    language_code = _iso639_2(language)

    input_attachments = copy.deepcopy(input_attachments)
    encoder_settings = copy.deepcopy(encoder_settings)

    input_attachments = _add_caption_selector(input_attachments, language_code, sync_mode)
    encoder_settings = _add_caption_description(encoder_settings, language_code)
    encoder_settings = _add_caption_output(encoder_settings)

    return input_attachments, encoder_settings
