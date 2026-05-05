import React, { useState } from "react";
import { Container, Header, Modal, SegmentedControl, SpaceBetween } from "@cloudscape-design/components";
import DualPlayerPreview, { DUAL_PLAYER_MODAL_CLASS } from "../../common/DualPlayerPreview";
import type { ChannelWithStatus } from "../../../types/channels";

interface PreviewChannelModalProps {
    channel: ChannelWithStatus | null;
    visible: boolean;
    onDismiss: () => void;
}

const PreviewChannelModal: React.FC<PreviewChannelModalProps> = ({ channel, visible, onDismiss }) => {
    const [dualMode, setDualMode] = useState(false);
    const [viewMode, setViewMode] = useState<"dual" | "single">("dual");

    const landscapeUrl = channel?.landscapeManifestUrl || channel?.manifestUrl;
    const portraitUrl = channel?.verticalManifestUrl;
    const hasBoth = Boolean(landscapeUrl) && Boolean(portraitUrl);

    return (
        <Modal
            size="large"
            visible={visible}
            onDismiss={onDismiss}
            className={`custom-modal${dualMode ? ` ${DUAL_PLAYER_MODAL_CLASS}` : ""}`}
            header={
                <Header variant="h2" description={`Channel ID: ${channel?.id ?? ""}`}>
                    {channel?.name ?? "Channel Preview"}
                </Header>
            }
        >
            <Container>
                <SpaceBetween size="l">
                    {hasBoth && (
                        <div style={{ display: "flex", justifyContent: "center" }}>
                            <SegmentedControl
                                selectedId={viewMode}
                                onChange={({ detail }) => {
                                    const mode = detail.selectedId as "dual" | "single";
                                    setViewMode(mode);
                                    setDualMode(mode === "dual");
                                }}
                                options={[
                                    { id: "dual", text: "Dual" },
                                    { id: "single", text: "Single" },
                                ]}
                            />
                        </div>
                    )}
                    {landscapeUrl && visible && (
                        <DualPlayerPreview
                            landscapeUrl={landscapeUrl}
                            portraitUrl={portraitUrl}
                            autoplay={false}
                            viewMode={viewMode}
                            onViewModeChange={(mode) => {
                                setViewMode(mode);
                                setDualMode(mode === "dual");
                            }}
                        />
                    )}
                </SpaceBetween>
            </Container>
        </Modal>
    );
};

export default PreviewChannelModal;
