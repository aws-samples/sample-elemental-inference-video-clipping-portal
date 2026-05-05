# API Service Usage

The `ApiService` provides a unified interface for making API calls to the backend Lambda functions using AWS Amplify API.

## Setup

The API service automatically switches between development mode (using mock data) and production mode (using real API Gateway endpoints) based on the `VITE_DEV_MODE` environment variable.

### Environment Variables

- `VITE_DEV_MODE`: Set to "false" to use real API endpoints, "true" for mock data (default: true)

### Amplify Configuration

Make sure your `amplifyconfiguration.json` includes the REST API configuration:

```json
{
  "API": {
    "REST": {
      "api": {
        "endpoint": "https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/prod",
        "region": "us-east-1"
      }
    }
  }
}
```

## Usage

### Basic Usage

```typescript
import ApiService from '../services/apiService';

const apiService = ApiService.getInstance();

// Get all events
const events = await apiService.getEvents();

// Get specific event
const event = await apiService.getEvent('event-id');

// Create new event
const newEvent = await apiService.createEvent({
  name: 'My Event',
  startDateTime: '2024-01-01T00:00:00Z',
  duration: 90,
  mediaLiveChannel: 'channel-001',
  generateMP4: true
});
```

### Available Methods

#### Events
- `getEvents()` - Get all events
- `getEvent(id)` - Get specific event
- `createEvent(event)` - Create new event
- `updateEvent(event)` - Update existing event
- `deleteEvent(id)` - Delete event

#### Clips
- `getClips()` - Get all clips
- `getClipsByEventId(eventId)` - Get clips for specific event
- `getClip(id)` - Get specific clip
- `createClip(clip)` - Create new clip
- `updateClip(clip)` - Update existing clip
- `deleteClip(id)` - Delete clip

#### Segments
- `getSegments()` - Get all segments
- `getSegmentsByClipId(clipId)` - Get segments for specific clip
- `getSegment(id)` - Get specific segment
- `createSegment(segment)` - Create new segment
- `updateSegment(segment)` - Update existing segment
- `deleteSegment(id)` - Delete segment

#### Reels
- `getReels()` - Get all reels
- `getReel(id)` - Get specific reel
- `createReel(reel)` - Create new reel
- `updateReel(reel)` - Update existing reel
- `deleteReel(id)` - Delete reel

#### Feedback
- `getFeedback()` - Get all feedback
- `getFeedbackForVideo(videoId)` - Get feedback for specific video
- `submitFeedback(feedback)` - Submit new feedback

#### Templates
- `getTemplates()` - Get all templates
- `getTemplate(id)` - Get specific template
- `createTemplate(template)` - Create new template
- `updateTemplate(template)` - Update existing template
- `deleteTemplate(id)` - Delete template

### Error Handling

All API methods throw errors that should be caught and handled appropriately:

```typescript
try {
  const events = await apiService.getEvents();
  // Handle success
} catch (error) {
  console.error('Failed to load events:', error);
  // Handle error - show user message, retry, etc.
}
```

### Component Integration

Use the API service in React components with proper error handling:

```typescript
import React, { useEffect, useState } from 'react';
import ApiService from '../services/apiService';
import { Event } from '../types';

const MyComponent: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiService = ApiService.getInstance();

  useEffect(() => {
    const loadEvents = async () => {
      try {
        setLoading(true);
        const eventsData = await apiService.getEvents();
        setEvents(eventsData);
        setError(null);
      } catch (err) {
        setError('Failed to load events');
        console.error('Error loading events:', err);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [apiService]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {events.map(event => (
        <div key={event.id}>{event.name}</div>
      ))}
    </div>
  );
};
```

The service automatically handles authentication using AWS Cognito tokens when making requests to the real API endpoints.