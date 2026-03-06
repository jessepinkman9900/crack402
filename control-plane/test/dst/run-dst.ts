import { InvariantChecker } from "./framework/invariant-checker";
import { ScenarioRunner } from "./framework/scenario-runner";
import { CONSERVATIVE_PROFILE, NO_FAULTS } from "./framework/fault-injector";

// Invariants
import { singleState } from "./invariants/single-state";
import { noResurrection } from "./invariants/no-resurrection";
import { quotaConsistency } from "./invariants/quota-consistency";
import { billingMeter } from "./invariants/billing-meter";
import { nodeFailure } from "./invariants/node-failure";
import { noDoubleBooking } from "./invariants/no-double-booking";

// Scenarios
import { happyPath } from "./scenarios/happy-path";
import { nodeCrash } from "./scenarios/node-crash";
import { concurrentCreates } from "./scenarios/concurrent-creates";
import { rapidTransitions } from "./scenarios/rapid-transitions";
import { alarmFailure } from "./scenarios/alarm-failure";
import { storageError } from "./scenarios/storage-error";

async function main() {
  const args = process.argv.slice(2);
  const seedCount = parseInt(args.find((a) => a.startsWith("--seeds="))?.split("=")[1] || "100");
  const scenarioFilter = args.find((a) => a.startsWith("--scenario="))?.split("=")[1];
  const noFaults = args.includes("--no-faults");
  const verbose = args.includes("--verbose");

  console.log("============================================");
  console.log("  Deterministic Simulation Testing (DST)");
  console.log("============================================");
  console.log(`Seeds: ${seedCount}`);
  console.log(`Fault profile: ${noFaults ? "none" : "conservative (1-2%)"}`);
  console.log();

  // Setup invariant checker
  const checker = new InvariantChecker();
  checker.register("single-state", singleState);
  checker.register("no-resurrection", noResurrection);
  checker.register("quota-consistency", quotaConsistency);
  checker.register("billing-meter", billingMeter);
  checker.register("node-failure", nodeFailure);
  checker.register("no-double-booking", noDoubleBooking);

  console.log(`Invariants: ${checker.getRegisteredNames().join(", ")}`);
  console.log();

  const profile = noFaults ? NO_FAULTS : CONSERVATIVE_PROFILE;
  const runner = new ScenarioRunner(checker, profile);

  const allScenarios = [
    happyPath,
    nodeCrash,
    concurrentCreates,
    rapidTransitions,
    alarmFailure,
    storageError,
  ];

  const scenarios = scenarioFilter
    ? allScenarios.filter((s) => s.name === scenarioFilter)
    : allScenarios;

  if (scenarios.length === 0) {
    console.error(`No scenario found matching: ${scenarioFilter}`);
    console.error(`Available: ${allScenarios.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }

  let totalPassed = 0;
  let totalFailed = 0;

  for (const scenario of scenarios) {
    const start = Date.now();
    console.log(`--- Scenario: ${scenario.name} (${scenario.steps} steps × ${seedCount} seeds) ---`);

    const result = await runner.runSeeds(scenario, seedCount);
    const elapsed = Date.now() - start;

    totalPassed += result.passed;
    totalFailed += result.failed;

    if (result.failed === 0) {
      console.log(`  PASS  ${result.passed}/${seedCount} seeds passed (${elapsed}ms)`);
    } else {
      console.log(`  FAIL  ${result.passed} passed, ${result.failed} failed (${elapsed}ms)`);
      if (result.firstFailure) {
        const f = result.firstFailure;
        console.log();
        console.log(`  First failure:`);
        console.log(`    Seed: ${f.seed}`);
        console.log(`    Step: ${f.stepsCompleted}/${f.totalSteps}`);
        if (f.violation) {
          console.log(`    Invariant: ${f.violation.invariant}`);
          console.log(`    Message: ${f.violation.message}`);
          console.log(`    Details: ${JSON.stringify(f.violation.details)}`);
        }
        if (f.error) {
          console.log(`    Error: ${f.error}`);
        }
        if (verbose && f.eventTrace) {
          console.log();
          console.log(`  Event trace (last 50 events):`);
          console.log(f.eventTrace.split("\n").map((l) => `    ${l}`).join("\n"));
        }
        console.log();
        console.log(`  Reproduce: npx tsx test/dst/run-dst.ts --seeds=1 --scenario=${scenario.name} --verbose`);
        console.log(`  (use seed ${f.seed} in the runner for exact reproduction)`);
      }
    }
    console.log();
  }

  console.log("============================================");
  console.log(`Total: ${totalPassed} passed, ${totalFailed} failed`);
  console.log("============================================");

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
