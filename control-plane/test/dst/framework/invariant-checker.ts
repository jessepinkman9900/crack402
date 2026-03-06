import type { SimulationWorld } from "./simulation-world";

export interface InvariantViolation {
  invariant: string;
  message: string;
  details: Record<string, unknown>;
}

export type InvariantFn = (world: SimulationWorld) => InvariantViolation | null;

/**
 * Runs all registered invariants after every simulation step.
 */
export class InvariantChecker {
  private invariants: Map<string, InvariantFn> = new Map();

  register(name: string, fn: InvariantFn): void {
    this.invariants.set(name, fn);
  }

  /** Check all invariants. Returns first violation found, or null. */
  check(world: SimulationWorld): InvariantViolation | null {
    for (const [name, fn] of this.invariants) {
      const violation = fn(world);
      if (violation) {
        return { ...violation, invariant: name };
      }
    }
    return null;
  }

  /** Check all invariants and return all violations. */
  checkAll(world: SimulationWorld): InvariantViolation[] {
    const violations: InvariantViolation[] = [];
    for (const [name, fn] of this.invariants) {
      const violation = fn(world);
      if (violation) {
        violations.push({ ...violation, invariant: name });
      }
    }
    return violations;
  }

  getRegisteredNames(): string[] {
    return Array.from(this.invariants.keys());
  }
}
