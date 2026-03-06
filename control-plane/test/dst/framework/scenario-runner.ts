import { SimulationWorld } from "./simulation-world";
import { InvariantChecker, type InvariantViolation } from "./invariant-checker";
import type { FaultProfile } from "./fault-injector";
import { CONSERVATIVE_PROFILE } from "./fault-injector";
import { EventLog } from "./event-log";

export interface ScenarioConfig {
  name: string;
  /** Number of simulation steps */
  steps: number;
  /** Setup: add nodes, tenants, etc. */
  setup: (world: SimulationWorld) => Promise<void>;
  /** Generate a random action for the given step */
  generateAction: (world: SimulationWorld, step: number) => Promise<void>;
}

export interface ScenarioResult {
  seed: number;
  scenarioName: string;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  violation?: InvariantViolation;
  eventTrace?: string;
  error?: string;
}

/**
 * Runs N seeds of a scenario, reporting the first failure with seed + event trace.
 */
export class ScenarioRunner {
  private invariantChecker: InvariantChecker;
  private faultProfile: FaultProfile;

  constructor(
    invariantChecker: InvariantChecker,
    faultProfile: FaultProfile = CONSERVATIVE_PROFILE
  ) {
    this.invariantChecker = invariantChecker;
    this.faultProfile = faultProfile;
  }

  async runScenario(
    scenario: ScenarioConfig,
    seed: number
  ): Promise<ScenarioResult> {
    const world = new SimulationWorld(seed, this.faultProfile);

    // Register invariants
    for (const name of this.invariantChecker.getRegisteredNames()) {
      // Share the invariant checker's invariants with the world's checker
      // We use the same checker instance
    }

    try {
      await scenario.setup(world);

      for (let step = 0; step < scenario.steps; step++) {
        world.eventLog.nextStep();

        // Generate and execute action
        try {
          await scenario.generateAction(world, step);
        } catch (e) {
          // Faults during action execution are expected
          world.eventLog.log({
            timestamp: world.clock.now(),
            kind: "fault",
            actor: "runner",
            action: "action_error",
            details: { step },
            error: String(e),
          });
        }

        // Check invariants
        const violation = this.invariantChecker.check(world);
        if (violation) {
          return {
            seed,
            scenarioName: scenario.name,
            success: false,
            stepsCompleted: step + 1,
            totalSteps: scenario.steps,
            violation,
            eventTrace: world.eventLog.formatTrace(50),
          };
        }
      }

      return {
        seed,
        scenarioName: scenario.name,
        success: true,
        stepsCompleted: scenario.steps,
        totalSteps: scenario.steps,
      };
    } catch (e) {
      return {
        seed,
        scenarioName: scenario.name,
        success: false,
        stepsCompleted: world.eventLog.getCurrentStep(),
        totalSteps: scenario.steps,
        error: String(e),
        eventTrace: world.eventLog.formatTrace(50),
      };
    }
  }

  async runSeeds(
    scenario: ScenarioConfig,
    seedCount: number,
    startSeed = 0
  ): Promise<{ passed: number; failed: number; firstFailure?: ScenarioResult }> {
    let passed = 0;
    let failed = 0;
    let firstFailure: ScenarioResult | undefined;

    for (let seed = startSeed; seed < startSeed + seedCount; seed++) {
      const result = await this.runScenario(scenario, seed);
      if (result.success) {
        passed++;
      } else {
        failed++;
        if (!firstFailure) {
          firstFailure = result;
        }
      }
    }

    return { passed, failed, firstFailure };
  }
}
