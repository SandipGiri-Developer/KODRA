// Time and duration formatting utilities for human-readable display.
/**
 * Formats a duration in seconds into a human-readable string.
 *
 * Requirements:
 * - Less than 60 seconds: `${s}s` (e.g. 0s, 1s, 42s, 59s)
 * - 60 seconds to < 3600 seconds: `${m}m ${s}s` (e.g. 1m 0s, 1m 23s, 7m 19s)
 * - 3600 seconds and above: `${h}h ${m}m ${s}s` (e.g. 1h 0m 0s, 1h 1m 1s)
 */
export function formatDuration(seconds: number): string {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds <= 0) {
    return '0s';
  }
  const totalSeconds = Math.floor(seconds);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}
