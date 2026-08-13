/**
 * Ring 3 — the real clock. The only file in this package that reads wall time or
 * schedules a timer; everything else takes the `Clock` port instead, which is
 * what makes the 120-second cap testable in microseconds.
 */
import type { Clock } from '../ports.js';

export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}
