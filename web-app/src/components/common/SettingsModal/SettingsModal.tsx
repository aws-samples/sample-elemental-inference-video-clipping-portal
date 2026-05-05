import React, { useState, useEffect, useCallback } from "react";
import {
    Modal,
    Header,
    SpaceBetween,
    FormField,
    Toggle,
    Input,
    Button,
    Flashbar,
    Spinner,
    Box,
    Select,
} from "@cloudscape-design/components";
import settingsService from "../../../services/settingsService";

type FlashItem = {
    type: "success" | "error";
    content: string;
    dismissible: boolean;
    id: string;
    onDismiss: () => void;
};

interface SettingsModalProps {
    visible: boolean;
    onDismiss: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onDismiss }) => {
    const [autoHarvestEnabled, setAutoHarvestEnabled] = useState(false);
    const [bufferSeconds, setBufferSeconds] = useState("0");
    const [bufferError, setBufferError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [flashItems, setFlashItems] = useState<FlashItem[]>([]);
    const [retentionDays, setRetentionDays] = useState("30");
    const [retentionError, setRetentionError] = useState<string | null>(null);
    const [autoActivateEnabled, setAutoActivateEnabled] = useState(false);
    const [conflictResolution, setConflictResolution] = useState("prefer_running");

    const removeFlash = useCallback((id: string) => {
        setFlashItems((prev) => prev.filter((item) => item.id !== id));
    }, []);

    const addFlash = useCallback(
        (type: "success" | "error", content: string) => {
            const id = Date.now().toString();
            setFlashItems((prev) => [
                ...prev,
                { type, content, dismissible: true, id, onDismiss: () => removeFlash(id) },
            ]);
        },
        [removeFlash]
    );

    const persistSetting = useCallback(async (key: string, value: string) => {
        try {
            await settingsService.updateSetting(key, value);
        } catch (err: any) {
            addFlash("error", `Failed to save ${key}: ${err?.message ?? "Unknown error"}`);
        }
    }, [addFlash]);

    useEffect(() => {
        if (!visible) return;
        setLoading(true);
        const fetchSettings = async () => {
            try {
                const [autoHarvestSetting, bufferSetting, retentionSetting, autoActivateSetting, conflictResSetting] = await Promise.all([
                    settingsService.getSetting("autoHarvest").catch(() => null),
                    settingsService.getSetting("harvestBufferSeconds").catch(() => null),
                    settingsService.getSetting("harvestRetentionDays").catch(() => null),
                    settingsService.getSetting("autoActivateInference").catch(() => null),
                    settingsService.getSetting("autoActivateConflictResolution").catch(() => null),
                ]);
                setAutoHarvestEnabled((autoHarvestSetting?.settingValue ?? "false") === "true");
                setBufferSeconds(bufferSetting?.settingValue ?? "0");
                setRetentionDays(retentionSetting?.settingValue ?? "30");
                setAutoActivateEnabled((autoActivateSetting?.settingValue ?? "false") === "true");
                setConflictResolution(conflictResSetting?.settingValue ?? "prefer_running");
                setFlashItems([]);
            } catch {
                addFlash("error", "Failed to load settings.");
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, [visible, addFlash]);

    const validateBuffer = (value: string): string | null => {
        const num = Number(value);
        if (!Number.isInteger(num) || num < 0 || num > 5) {
            return "Must be an integer between 0 and 5";
        }
        return null;
    };

    const handleAutoHarvestChange = (checked: boolean) => {
        setAutoHarvestEnabled(checked);
        persistSetting("autoHarvest", String(checked));
    };

    const handleBufferChange = (value: string) => {
        setBufferSeconds(value);
        const error = validateBuffer(value);
        setBufferError(error);
        if (!error) {
            persistSetting("harvestBufferSeconds", value);
        }
    };

    const validateRetention = (value: string): string | null => {
        const num = Number(value);
        if (!Number.isInteger(num) || num < 1 || num > 365) {
            return "Must be an integer between 1 and 365";
        }
        return null;
    };

    const handleRetentionChange = (value: string) => {
        setRetentionDays(value);
        const error = validateRetention(value);
        setRetentionError(error);
        if (!error) {
            persistSetting("harvestRetentionDays", value);
        }
    };

    const handleAutoActivateChange = (checked: boolean) => {
        setAutoActivateEnabled(checked);
        persistSetting("autoActivateInference", String(checked));
    };

    const handleConflictResolutionChange = (value: string) => {
        setConflictResolution(value);
        persistSetting("autoActivateConflictResolution", value);
    };

    return (
        <Modal
            visible={visible}
            onDismiss={onDismiss}
            header={<Header variant="h2">System Settings</Header>}
            size="medium"
            footer={
                <Box float="right">
                    <Button variant="link" onClick={onDismiss} ariaLabel="Close">Close</Button>
                </Box>
            }
        >
            {loading ? (
                <Box textAlign="center" padding="xxl">
                    <Spinner size="large" />
                </Box>
            ) : (
                <SpaceBetween size="l">
                    <Flashbar items={flashItems} />
                    <FormField
                        label="Auto-Harvest"
                        description="When enabled, both landscape and portrait orientations are automatically harvested."
                    >
                        <Toggle
                            checked={autoHarvestEnabled}
                            onChange={({ detail }) => handleAutoHarvestChange(detail.checked)}
                        >
                            Enable auto-harvest
                        </Toggle>
                    </FormField>
                    <FormField
                        label="Harvest Buffer (seconds)"
                        description="Additional seconds of content added before and after each harvested clip. Useful for editing flexibility."
                        errorText={bufferError ?? undefined}
                    >
                        <Input
                            type="number"
                            value={bufferSeconds}
                            onChange={({ detail }) => handleBufferChange(detail.value)}
                            inputMode="numeric"
                        />
                    </FormField>
                    <FormField
                        label="Harvest Retention (days)"
                        description="Number of days to retain harvested clip content in S3 before automatic cleanup. Default is 30 days."
                        errorText={retentionError ?? undefined}
                    >
                        <Input
                            type="number"
                            value={retentionDays}
                            onChange={({ detail }) => handleRetentionChange(detail.value)}
                            inputMode="numeric"
                        />
                    </FormField>
                    <FormField
                        label="Auto-Activate Inference"
                        description="When enabled, events are automatically activated and deactivated for inference based on their scheduled start and end times."
                    >
                        <Toggle
                            checked={autoActivateEnabled}
                            onChange={({ detail }) => handleAutoActivateChange(detail.checked)}
                        >
                            Enable auto-activate
                        </Toggle>
                    </FormField>
                    <FormField
                        label="Conflict Resolution"
                        description="Choose how overlapping events on the same channel are handled."
                    >
                        <Select
                            disabled={!autoActivateEnabled}
                            selectedOption={{
                                value: conflictResolution,
                                label: conflictResolution === "prefer_running" ? "Prefer running events" : "Prefer latest start",
                            }}
                            onChange={({ detail }) => handleConflictResolutionChange(detail.selectedOption.value!)}
                            options={[
                                { value: "prefer_running", label: "Prefer running events" },
                                { value: "prefer_latest_start", label: "Prefer latest start" },
                            ]}
                        />
                    </FormField>
                </SpaceBetween>
            )}
        </Modal>
    );
};

export default SettingsModal;
