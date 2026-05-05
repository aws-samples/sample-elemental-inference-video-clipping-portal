/**
 * Timecode Converter
 *
 * Pure utility module for converting between zero-based floating-point seconds
 * and SMPTE timecodes (HH:MM:SS:FF) required by MediaConvert InputClippings.
 */

export const DEFAULT_FRAME_RATE = 30;

/**
 * Convert zero-based floating-point seconds to SMPTE timecode (HH:MM:SS:FF).
 * Negative values are clamped to 0. Frame component is clamped to [0, frameRate - 1].
 */
export function secondsToSmpte(seconds: number, frameRate: number = DEFAULT_FRAME_RATE): string {
  const clamped = Math.max(0, seconds);

  const totalFrames = Math.round(clamped * frameRate);
  const ff = Math.min(Math.max(0, totalFrames % frameRate), frameRate - 1);
  const totalSeconds = Math.floor(totalFrames / frameRate);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);

  return [hh, mm, ss, ff].map((v) => String(v).padStart(2, "0")).join(":");
}

/**
 * Convert SMPTE timecode (HH:MM:SS:FF) back to zero-based floating-point seconds.
 */
export function smpteToSeconds(smpte: string, frameRate: number = DEFAULT_FRAME_RATE): number {
  const parts = smpte.split(":").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    throw new Error(`Invalid SMPTE timecode: ${smpte}`);
  }

  const [hh, mm, ss, ff] = parts;
  return hh * 3600 + mm * 60 + ss + ff / frameRate;
}
