import type { Random } from "../../../src/lib/random";

/**
 * xoshiro256** PRNG — deterministic, seedable, high quality.
 * Used for reproducible simulations.
 */
export class DeterministicRandom implements Random {
  private s: BigInt64Array;

  constructor(seed: number) {
    // Initialize state from seed using splitmix64
    this.s = new BigInt64Array(4);
    let s = BigInt(seed);
    for (let i = 0; i < 4; i++) {
      s += 0x9e3779b97f4a7c15n;
      let z = s;
      z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
      z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
      z = z ^ (z >> 31n);
      this.s[i] = z;
    }
  }

  private next(): bigint {
    const result = this.rotl(this.s[1] * 5n, 7n) * 9n;
    const t = this.s[1] << 17n;

    this.s[2] ^= this.s[0];
    this.s[3] ^= this.s[1];
    this.s[1] ^= this.s[2];
    this.s[0] ^= this.s[3];
    this.s[2] ^= t;
    this.s[3] = this.rotl(this.s[3], 45n);

    return result;
  }

  private rotl(x: bigint, k: bigint): bigint {
    return (x << k) | (x >> (64n - k));
  }

  /** Generate a float in [0, 1) */
  float(): number {
    const bits = this.next() & 0xfffffffffffffn; // 52 bits
    return Number(bits) / 2 ** 52;
  }

  /** Generate an integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** Generate a prefixed ID */
  id(prefix: string): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = prefix;
    for (let i = 0; i < 20; i++) {
      result += chars[this.int(0, chars.length - 1)];
    }
    return result;
  }

  /** Pick a random element from an array */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) throw new Error("Cannot pick from empty array");
    return arr[this.int(0, arr.length - 1)];
  }

  /** Returns true with the given probability (0-1) */
  chance(probability: number): boolean {
    return this.float() < probability;
  }

  /** Shuffle array in place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
