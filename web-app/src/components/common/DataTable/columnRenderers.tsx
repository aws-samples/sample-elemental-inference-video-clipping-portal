import React from 'react';
import { Badge, Button, SpaceBetween, Link } from '@cloudscape-design/components';
import { EventStatus, ClipStatus } from '../../../types';

// Status badge renderer for events
export const renderEventStatus = (status: EventStatus) => {
  const statusConfig = {
    live: { color: 'green' as const, text: 'Live' },
    ended: { color: 'blue' as const, text: 'Ended' },
    scheduled: { color: 'grey' as const, text: 'Scheduled' },
    idle: { color: 'severity-neutral' as const, text: 'Idle' },
  };

  const config = statusConfig[status] || { color: 'grey' as const, text: status };
  return <Badge color={config.color}>{config.text}</Badge>;
};

// Status badge renderer for clips
export const renderClipStatus = (status: ClipStatus) => {
  const statusConfig: any = {
    original: { color: 'blue' as const, text: 'Original' },
    modified: { color: 'severity-medium' as const, text: 'Modified' },
    edit_in_progress: { color: 'severity-low' as const, text: 'Processing' },
    review_in_progress: { color: 'severity-medium' as const, text: 'Review In Progress' },
    discarded: { color: 'red' as const, text: 'Discarded' },
    reviewed: { color: 'green' as const, text: 'Reviewed' },
    scheduled: { color: 'grey' as const, text: 'Scheduled' },
    processing: { color: 'severity-low' as const, text: 'Processing' },
  };

  const config: any = statusConfig[status] || { color: 'grey' as const, text: status };
  return <Badge color={config.color ?? "blue"}>{config.text}</Badge>;
};

// Date/time formatter
export const renderDateTime = (dateString: string) => {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString;
    }
    return date.toLocaleString();
  } catch {
    return dateString;
  }
};

// Duration formatter (converts seconds to readable format)
export const renderDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

// Action buttons renderer
export const renderActions = (
  actions: Array<{
    text: string;
    onClick: () => void;
    variant?: 'primary' | 'normal' | 'link';
    disabled?: boolean;
  }>
) => {
  return (
    <SpaceBetween direction="horizontal" size="xs">
      {actions.map((action, index) => (
        <Button
          key={index}
          variant={action.variant || 'link'}
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.text}
        </Button>
      ))}
    </SpaceBetween>
  );
};

// Link renderer
export const renderLink = (text: string, href: string, external?: boolean) => {
  return (
    <Link href={href} external={external}>
      {text}
    </Link>
  );
};

// Boolean renderer (Yes/No)
export const renderBoolean = (value: boolean) => {
  return value ? 'Yes' : 'No';
};

// Age formatter (converts seconds to human readable age)
export const renderAge = (ageInSeconds: number) => {
  const minutes = Math.floor(ageInSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${ageInSeconds}s`;
};