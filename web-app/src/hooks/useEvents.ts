/**
 * Custom hook for managing events
 */

import { useState, useCallback } from 'react';
import { Event, CreateEventRequest, UpdateEventRequest } from '../types';
import ApiService from '../services/apiService';

export const useEvents = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiService = ApiService.getInstance();

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getEvents();
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const fetchEvent = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const event = await apiService.getEvent(id);
      return event;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch event');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const createEvent = useCallback(async (eventData: CreateEventRequest) => {
    setLoading(true);
    setError(null);
    try {
      const newEvent = await apiService.createEvent(eventData);
      setEvents(prev => [...prev, newEvent]);
      return newEvent;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const updateEvent = useCallback(async (eventData: UpdateEventRequest) => {
    setLoading(true);
    setError(null);
    try {
      const updatedEvent = await apiService.updateEvent(eventData);
      setEvents(prev => 
        prev.map(event => 
          event.id === updatedEvent.id ? updatedEvent : event
        )
      );
      return updatedEvent;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const deleteEvent = useCallback(async (eventId: string, deleteClips: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      await apiService.deleteEvent(eventId, deleteClips);
      setEvents(prev => prev.filter(event => event.id !== eventId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  return {
    events,
    loading,
    error,
    fetchEvents,
    fetchEvent,
    createEvent,
    updateEvent,
    deleteEvent,
  };
};

export default useEvents;