import type { DeterministicRandom } from "./deterministic-random";

export interface FaultProfile {
  storageReadFailure: number;   // probability 0-1
  storageWriteFailure: number;  // probability 0-1
  alarmFailure: number;         // probability 0-1
  nodeCrash: number;            // probability 0-1
  messageReorder: number;       // probability 0-1
  messageDelay: number;         // probability 0-1
  messageDrop: number;          // probability 0-1
}

/** Conservative fault profile: 1-2% failure rates */
export const CONSERVATIVE_PROFILE: FaultProfile = {
  storageReadFailure: 0.01,
  storageWriteFailure: 0.01,
  alarmFailure: 0.02,
  nodeCrash: 0.01,
  messageReorder: 0.01,
  messageDelay: 0.02,
  messageDrop: 0.005,
};

/** No faults — for debugging */
export const NO_FAULTS: FaultProfile = {
  storageReadFailure: 0,
  storageWriteFailure: 0,
  alarmFailure: 0,
  nodeCrash: 0,
  messageReorder: 0,
  messageDelay: 0,
  messageDrop: 0,
};

/**
 * Fault injector that uses deterministic randomness to decide when faults occur.
 */
export class FaultInjector {
  constructor(
    private random: DeterministicRandom,
    private profile: FaultProfile
  ) {}

  shouldFailStorageRead(): boolean {
    return this.random.chance(this.profile.storageReadFailure);
  }

  shouldFailStorageWrite(): boolean {
    return this.random.chance(this.profile.storageWriteFailure);
  }

  shouldFailAlarm(): boolean {
    return this.random.chance(this.profile.alarmFailure);
  }

  shouldCrashNode(): boolean {
    return this.random.chance(this.profile.nodeCrash);
  }

  shouldReorderMessage(): boolean {
    return this.random.chance(this.profile.messageReorder);
  }

  shouldDelayMessage(): boolean {
    return this.random.chance(this.profile.messageDelay);
  }

  shouldDropMessage(): boolean {
    return this.random.chance(this.profile.messageDrop);
  }

  /** Get delay duration in ms when a message is delayed */
  getDelayMs(): number {
    return this.random.int(100, 5000);
  }

  getProfile(): FaultProfile {
    return { ...this.profile };
  }
}
