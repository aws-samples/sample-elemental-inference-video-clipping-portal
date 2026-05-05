/**
 * Custom hook for managing Jobs
 */

import { useState, useCallback } from 'react';
import { Job, CreateJobRequest } from '../types';
import ApiService from '../services/apiService';

export const useJobs = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiService = ApiService.getInstance();

  const fetchJobs = useCallback(async (filters?: { clipId?: string; eventId?: string; status?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getJobs(filters);
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch Jobs');
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const fetchJob = useCallback(async (id: string) => {
    console.log("fetchJob called with ID:", id);
    setLoading(true);
    setError(null);
    try {
      const job = await apiService.getJob(id);
      console.log("fetchJob result:", job);
      return job;
    } catch (err) {
      console.error("fetchJob error:", err);
      setError(err instanceof Error ? err.message : 'Failed to fetch job');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const createJob = useCallback(async (jobData: CreateJobRequest) => {
    setLoading(true);
    setError(null);
    try {
      const newJob = await apiService.createJob(jobData);
      setJobs(prev => [...prev, newJob]);
      return newJob;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create job');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const updateJob = useCallback(async (jobData: Partial<Job> & { jobId: string }) => {
    setLoading(true);
    setError(null);
    try {
      const updatedJob = await apiService.updateJob(jobData);
      setJobs(prev => 
        prev.map(job => 
          job.jobId === updatedJob.jobId ? updatedJob : job
        )
      );
      return updatedJob;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update job');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const deleteJob = useCallback(async (jobId: string) => {
    setLoading(true);
    setError(null);
    try {
      await apiService.deleteJob(jobId);
      setJobs(prev => prev.filter(job => job.jobId !== jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete job');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const getJobStatus = useCallback(async (jobId: string) => {
    try {
      const jobStatus = await apiService.getJobStatus(jobId);
      
      // Update the job in the local state if it exists
      setJobs(prev => 
        prev.map(job => 
          job.jobId === jobStatus.jobId ? jobStatus : job
        )
      );
      
      return jobStatus;
    } catch (err) {
      console.error("Failed to get job status:", err);
      throw err;
    }
  }, [apiService]);

  // Convenience methods for common filtering scenarios
  const fetchJobsByClip = useCallback(async (clipId: string) => {
    return fetchJobs({ clipId });
  }, [fetchJobs]);

  const fetchJobsByEvent = useCallback(async (eventId: string) => {
    return fetchJobs({ eventId });
  }, [fetchJobs]);

  const fetchJobsByStatus = useCallback(async (status: string) => {
    return fetchJobs({ status });
  }, [fetchJobs]);

  return {
    jobs,
    loading,
    error,
    fetchJobs,
    fetchJob,
    createJob,
    updateJob,
    deleteJob,
    getJobStatus,
    fetchJobsByClip,
    fetchJobsByEvent,
    fetchJobsByStatus,
  };
};

export default useJobs;