/**
 * Segment Calculator
 *
 * Pure utility functions for computing keep-segments from video edit operations.
 * Extracted from api/src/video-processor/index.ts.
 */

export interface Segment {
  start: number;
  end: number;
}

export type VideoEditOperationType = "trim" | "split" | "delete" | "merge";

export interface VideoEditOperation {
  id: string;
  type: VideoEditOperationType;
  startTime: number;
  endTime: number;
  order: number;
  enabled: boolean;
  description?: string;
}

/**
 * Merge overlapping or adjacent segments. Segments are sorted by start time.
 */
export function mergeOverlappingSegments(segments: Segment[]): Segment[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged: Segment[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Calculate keep-segments as the inverse of remove-segments within video bounds.
 * Assumes removeSegments are already sorted and merged.
 */
export function calculateKeepSegments(
  removeSegments: Segment[],
  videoBounds: Segment
): Segment[] {
  const keepSegments: Segment[] = [];
  let currentTime = videoBounds.start;

  for (const removeSegment of removeSegments) {
    if (currentTime < removeSegment.start) {
      keepSegments.push({ start: currentTime, end: removeSegment.start });
    }
    currentTime = Math.max(currentTime, removeSegment.end);
  }

  if (currentTime < videoBounds.end) {
    keepSegments.push({ start: currentTime, end: videoBounds.end });
  }

  return keepSegments;
}

/**
 * Convert VideoEditOperations to keep-segments in seconds.
 *
 * 1. Extract video bounds from trim operations (or default to 0–999999)
 * 2. Collect delete ranges
 * 3. Merge overlapping delete ranges
 * 4. Calculate inverse (keep segments)
 */
export function operationsToKeepSegments(operations: VideoEditOperation[]): Segment[] {
  const enabledOps = operations.filter((op) => op.enabled);

  // Step 1: Determine video bounds
  let videoBounds: Segment = { start: 0, end: 999999 };

  const trimOps = enabledOps.filter((op) => op.type === "trim");
  if (trimOps.length > 0) {
    const earliestStart = Math.min(...trimOps.map((op) => op.startTime));
    const latestEnd = Math.max(...trimOps.map((op) => op.endTime));
    videoBounds = { start: earliestStart, end: latestEnd };
  }

  // Step 2: Collect segments to remove
  const segmentsToRemove: Segment[] = [];

  const deleteOps = enabledOps.filter((op) => op.type === "delete");
  deleteOps.forEach((op) => {
    segmentsToRemove.push({ start: op.startTime, end: op.endTime });
  });

  // For trim operations, everything outside the trim range is removed
  if (trimOps.length > 0) {
    if (videoBounds.start > 0) {
      segmentsToRemove.push({ start: 0, end: videoBounds.start });
    }
    segmentsToRemove.push({ start: videoBounds.end, end: 999999 });
  }

  // Step 3: Merge overlapping remove segments
  const mergedRemoveSegments = mergeOverlappingSegments(segmentsToRemove);

  // Step 4: Calculate keep segments (inverse of remove)
  return calculateKeepSegments(mergedRemoveSegments, videoBounds);
}
