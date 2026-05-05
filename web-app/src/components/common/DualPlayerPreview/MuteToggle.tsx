import React from 'react';
import { Button } from '@cloudscape-design/components';

export interface MuteToggleProps {
    isMuted: boolean;
    onToggle(): void;
    label: string;
}

const MuteToggle: React.FC<MuteToggleProps> = ({ isMuted, onToggle, label }) => {
    return (
        <Button
            iconName={isMuted ? 'audio-off' : 'audio-full'}
            variant="icon"
            ariaLabel={isMuted ? `Unmute ${label}` : `Mute ${label}`}
            onClick={onToggle}
        />
    );
};

export default MuteToggle;
