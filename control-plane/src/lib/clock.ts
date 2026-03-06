export interface Clock {
  now(): number;
  isoNow(): string;
}

export const realClock: Clock = {
  now: () => Date.now(),
  isoNow: () => new Date().toISOString(),
};
