"""Unit tests for the Smart Subtitles MediaLive channel injection transform."""

import copy

import pytest

from smart_subtitles import (
    apply_smart_subtitles,
    CAPTION_SELECTOR_NAME,
    CAPTION_DESCRIPTION_NAME,
    CAPTION_OUTPUT_NAME,
    SUBTITLING_FEED_OUTPUT,
)


def _input_attachments():
    return [
        {
            "InputAttachmentName": "primary-input",
            "InputId": "input-123",
            "InputSettings": {"SourceEndBehavior": "LOOP"},
        }
    ]


def _encoder_settings():
    return {
        "AudioDescriptions": [{"Name": "audio_main"}],
        "VideoDescriptions": [{"Name": "video_720p"}],
        "OutputGroups": [
            {
                "Name": "harvest-output-group",
                "OutputGroupSettings": {
                    "MediaPackageGroupSettings": {
                        "Destination": {"DestinationRefId": "mediapackage-v2"},
                    }
                },
                "Outputs": [
                    {"OutputName": "video-720p", "VideoDescriptionName": "video_720p"},
                ],
            }
        ],
    }


class TestDisabled:
    def test_none_subtitles_is_noop(self):
        ia, es = _input_attachments(), _encoder_settings()
        out_ia, out_es = apply_smart_subtitles(ia, es, None)
        assert out_ia == ia
        assert out_es == es

    def test_disabled_subtitles_is_noop(self):
        ia, es = _input_attachments(), _encoder_settings()
        out_ia, out_es = apply_smart_subtitles(ia, es, {"enabled": False, "language": "eng-us"})
        assert out_ia == ia
        assert out_es == es

    def test_does_not_mutate_inputs(self):
        ia, es = _input_attachments(), _encoder_settings()
        ia_before, es_before = copy.deepcopy(ia), copy.deepcopy(es)
        apply_smart_subtitles(ia, es, {"enabled": True, "language": "eng-us"})
        assert ia == ia_before
        assert es == es_before


class TestCaptionSelector:
    def test_selector_added_to_input_attachment(self):
        ia, es = apply_smart_subtitles(_input_attachments(), _encoder_settings(),
                                       {"enabled": True, "language": "eng-us"})
        selectors = ia[0]["InputSettings"]["CaptionSelectors"]
        assert len(selectors) == 1
        sel = selectors[0]
        assert sel["Name"] == CAPTION_SELECTOR_NAME
        assert sel["LanguageCode"] == "eng"  # region subtag stripped
        sss = sel["SelectorSettings"]["SmartSubtitleSourceSettings"]
        assert sss["InferenceFeedOutput"] == SUBTITLING_FEED_OUTPUT
        assert sss["CaptionSynchronizationMode"] == "VIDEO_ALIGNED_CAPTIONS"

    def test_existing_input_settings_preserved(self):
        ia, _ = apply_smart_subtitles(_input_attachments(), _encoder_settings(),
                                      {"enabled": True, "language": "fra"})
        assert ia[0]["InputSettings"]["SourceEndBehavior"] == "LOOP"

    def test_sync_mode_override(self):
        ia, _ = apply_smart_subtitles(
            _input_attachments(), _encoder_settings(),
            {"enabled": True, "language": "deu", "captionSynchronizationMode": "NO_VIDEO_DELAY"},
        )
        sss = ia[0]["InputSettings"]["CaptionSelectors"][0]["SelectorSettings"]["SmartSubtitleSourceSettings"]
        assert sss["CaptionSynchronizationMode"] == "NO_VIDEO_DELAY"


class TestCaptionDescriptionAndOutput:
    def test_caption_description_added(self):
        _, es = apply_smart_subtitles(_input_attachments(), _encoder_settings(),
                                      {"enabled": True, "language": "eng-gb"})
        descs = es["CaptionDescriptions"]
        assert len(descs) == 1
        assert descs[0]["Name"] == CAPTION_DESCRIPTION_NAME
        assert descs[0]["CaptionSelectorName"] == CAPTION_SELECTOR_NAME
        assert descs[0]["LanguageCode"] == "eng"
        assert descs[0]["Accessibility"] == "DOES_NOT_IMPLEMENT_ACCESSIBILITY_FEATURES"
        assert "TtmlDestinationSettings" in descs[0]["DestinationSettings"]
        assert descs[0]["DestinationSettings"]["TtmlDestinationSettings"]["StyleControl"] == "USE_CONFIGURED"

    def test_caption_output_added_to_mediapackage_group(self):
        _, es = apply_smart_subtitles(_input_attachments(), _encoder_settings(),
                                      {"enabled": True, "language": "spa"})
        outputs = es["OutputGroups"][0]["Outputs"]
        cap = next(o for o in outputs if o["OutputName"] == CAPTION_OUTPUT_NAME)
        assert cap["CaptionDescriptionNames"] == [CAPTION_DESCRIPTION_NAME]
        assert "MediaPackageOutputSettings" in cap["OutputSettings"]

    def test_existing_outputs_preserved(self):
        _, es = apply_smart_subtitles(_input_attachments(), _encoder_settings(),
                                      {"enabled": True, "language": "ita"})
        names = [o["OutputName"] for o in es["OutputGroups"][0]["Outputs"]]
        assert "video-720p" in names
        assert CAPTION_OUTPUT_NAME in names

    def test_non_mediapackage_group_skipped(self):
        es = _encoder_settings()
        es["OutputGroups"].append({
            "Name": "other",
            "OutputGroupSettings": {"ArchiveGroupSettings": {}},
            "Outputs": [{"OutputName": "archive-out"}],
        })
        _, out_es = apply_smart_subtitles(_input_attachments(), es,
                                          {"enabled": True, "language": "por"})
        other = next(g for g in out_es["OutputGroups"] if g["Name"] == "other")
        assert all(o["OutputName"] != CAPTION_OUTPUT_NAME for o in other["Outputs"])


class TestIdempotency:
    def test_applying_twice_is_stable(self):
        subs = {"enabled": True, "language": "eng-us"}
        ia1, es1 = apply_smart_subtitles(_input_attachments(), _encoder_settings(), subs)
        ia2, es2 = apply_smart_subtitles(ia1, es1, subs)
        # No duplicates on second application
        assert len(ia2[0]["InputSettings"]["CaptionSelectors"]) == 1
        assert len(es2["CaptionDescriptions"]) == 1
        cap_outputs = [o for o in es2["OutputGroups"][0]["Outputs"] if o["OutputName"] == CAPTION_OUTPUT_NAME]
        assert len(cap_outputs) == 1


class TestValidation:
    def test_enabled_without_language_raises(self):
        with pytest.raises(ValueError, match="language"):
            apply_smart_subtitles(_input_attachments(), _encoder_settings(), {"enabled": True})

    def test_invalid_sync_mode_raises(self):
        with pytest.raises(ValueError, match="captionSynchronizationMode"):
            apply_smart_subtitles(
                _input_attachments(), _encoder_settings(),
                {"enabled": True, "language": "eng", "captionSynchronizationMode": "NOPE"},
            )

    def test_no_input_attachments_raises(self):
        with pytest.raises(ValueError, match="input attachments"):
            apply_smart_subtitles([], _encoder_settings(), {"enabled": True, "language": "eng"})

    def test_no_encoder_settings_raises(self):
        with pytest.raises(ValueError, match="encoder settings"):
            apply_smart_subtitles(_input_attachments(), None, {"enabled": True, "language": "eng"})
