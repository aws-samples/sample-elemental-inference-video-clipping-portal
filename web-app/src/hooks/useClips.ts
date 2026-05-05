/**
 * Custom hook for managing clips
 */

import { useState, useCallback } from 'react';
import { Clip, CreateClipRequest } from '../types';
import ApiService from '../services/apiService';

export const useClips = () => {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiService = ApiService.getInstance();

  const fetchClips = useCallback(async (eventId?: string, eventIds?: string[]) => {
    setLoading(true);
    setError(null);
    try {
      if (eventIds && eventIds.length > 0) {
        // Multi-event query — fetch clips for each event and merge
        const allResults = await Promise.all(
          eventIds.map(id => apiService.getClipsByEventId(id))
        );
        // Flatten and deduplicate by clip ID
        const seen = new Set<string>();
        const merged: Clip[] = [];
        for (const batch of allResults) {
          for (const clip of batch) {
            if (!seen.has(clip.id)) {
              seen.add(clip.id);
              merged.push(clip);
            }
          }
        }
        setClips(merged);
      } else if (eventId) {
        // Single event query
        const data = await apiService.getClipsByEventId(eventId);
        setClips(data);
      } else {
        // All clips query - handle pagination to get ALL clips
        let allClips: Clip[] = [];
        let nextToken: string | undefined;
        
        do {
          const response = await apiService.makeRequest<{ clips: Clip[], count: number, nextToken?: string }>(
            nextToken ? `/clips?nextToken=${encodeURIComponent(nextToken)}` : '/clips'
          );
          allClips = [...allClips, ...response.clips];
          nextToken = response.nextToken;
        } while (nextToken);
        
        setClips(allClips);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch clips');
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const fetchClip = useCallback(async (id: string) => {
    console.log("fetchClip called with ID:", id);
    setLoading(true);
    setError(null);
    try {
      const clip = await apiService.getClip(id);
      console.log("fetchClip result:", clip);
      return clip;
    } catch (err) {
      console.error("fetchClip error:", err);
      setError(err instanceof Error ? err.message : 'Failed to fetch clip');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const createClip = useCallback(async (clipData: CreateClipRequest) => {
    setLoading(true);
    setError(null);
    try {
      const newClip = await apiService.createClip(clipData);
      setClips(prev => [...prev, newClip]);
      return newClip;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create clip');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const updateClip = useCallback(async (clipData: Partial<Clip> & { id: string }) => {
    setLoading(true);
    setError(null);
    try {
      const updatedClip = await apiService.updateClip(clipData);
      setClips(prev => 
        prev.map(clip => 
          clip.id === updatedClip.id ? updatedClip : clip
        )
      );
      return updatedClip;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update clip');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const deleteClip = useCallback(async (clipId: string) => {
    setLoading(true);
    setError(null);
    try {
      await apiService.deleteClip(clipId);
      setClips(prev => prev.filter(clip => clip.id !== clipId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete clip');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const clearClips = useCallback(() => {
    setClips([]);
  }, []);

  return {
    clips,
    loading,
    error,
    fetchClips,
    fetchClip,
    clearClips,
    createClip,
    updateClip,
    deleteClip,
  };
};

export default useClips;