import path from "node:path";
import {
  createDefaultManagedTargetConfig,
  discoverTargetConfigPaths,
  loadTargetConfig,
  loadTargetConfigsFromDirectory,
} from "./config.js";
import { runTargetMatrix, runTargetSuite } from "./suite.js";
import type { RunReport, TargetConfig, TestCategory } from "./types.js";

const CATEGORY_ORDER: TestCategory[] = ["transaction", "rpc", "authorization", "execution"];

function categoryTitle(category: TestCategory): string {
  switch (category) {
    case "transaction":
      return "Transaction";
    case "rpc":
      return "RPC";
    case "authorization":
      return "Authorization";
    case "execution":
      return "Execution";
  }
}

function printRunSummary(rootDir: string, report: RunReport, jsonPath: string, markdownPath: string): void {
  console.log("");
  console.log(`Target        : ${report.target.label}`);
  console.log(`Kind          : ${report.target.kind}`);
  console.log(`Chain ID      : ${report.target.chainId}`);
  console.log(`RPC URL       : ${report.target.rpcUrl}`);
  console.log(`Fixture       : ${report.fixtures.delegationTarget.address}`);
  console.log("");
  console.log(
    `Summary       : ${report.summary.passed}/${report.summary.total} passed · ${report.summary.failed} failed · ${report.summary.skipped} skipped`,
  );
  console.log("");
  console.log("Coverage by category:");
  for (const category of CATEGORY_ORDER) {
    const bucket = report.tests.filter((test) => test.category === category);
    if (bucket.length === 0) continue;
    const passed = bucket.filter((test) => test.status === "pass").length;
    const failed = bucket.filter((test) => test.status === "fail").length;
    console.log(`  - ${categoryTitle(category).padEnd(14)} ${passed}/${bucket.length} passed${failed > 0 ? ` (${failed} failed)` : ""}`);
  }
  console.log("");
  console.log("Results:");
  for (const test of report.tests) {
    const status = test.status === "pass" ? "PASS" : test.status === "fail" ? "FAIL" : "SKIP";
    console.log(`  ${status}  ${test.id}  (${test.durationMs}ms)`);
  }
  console.log("");
  console.log(`JSON report   : ${path.relative(rootDir, jsonPath)}`);
  console.log(`Markdown      : ${path.relative(rootDir, markdownPath)}`);
}

interface CliOptions {
  configPaths: string[];
  matrix: boolean;
  targetsDir: string;
  reportDir?: string;
  listTargets: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`Usage: npm run prototype -- [options]

Options:
  --config <path>       Load a target config JSON file. Can be repeated.
  --matrix              Run every non-example config in the targets directory.
  --targets-dir <path>  Directory to scan for matrix/list operations. Default: targets
  --report-dir <path>   Output directory for reports.
  --list-targets        Print discovered target config files and exit.
  --help                Show this message.
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configPaths: [],
    matrix: false,
    targetsDir: "targets",
    listTargets: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--config": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error("--config requires a file path.");
        }
        options.configPaths.push(value);
        index += 1;
        break;
      }
      case "--matrix":
        options.matrix = true;
        break;
      case "--targets-dir": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error("--targets-dir requires a directory path.");
        }
        options.targetsDir = value;
        index += 1;
        break;
      }
      case "--report-dir": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error("--report-dir requires a directory path.");
        }
        options.reportDir = value;
        index += 1;
        break;
      }
      case "--list-targets":
        options.listTargets = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function resolveReportDir(rootDir: string, reportDir: string | undefined, fallback: string): string {
  return path.resolve(rootDir, reportDir ?? fallback);
}

function hasAnyFailures(targets: Array<{ failed: number }>): boolean {
  return targets.some((target) => target.failed > 0);
}

function dedupeTargets(configs: TargetConfig[]): TargetConfig[] {
  const seen = new Set<string>();

  return configs.filter((config) => {
    if (seen.has(config.id)) {
      throw new Error(`Duplicate target id detected: ${config.id}`);
    }

    seen.add(config.id);
    return true;
  });
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const targetsDir = path.resolve(rootDir, options.targetsDir);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.listTargets) {
    const configPaths = await discoverTargetConfigPaths(targetsDir);
    if (configPaths.length === 0) {
      console.log(`No target configs found in ${path.relative(rootDir, targetsDir) || "."}.`);
      return;
    }

    for (const configPath of configPaths) {
      console.log(path.relative(rootDir, configPath));
    }
    return;
  }

  const explicitConfigs = await Promise.all(
    options.configPaths.map((configPath) => loadTargetConfig(path.resolve(rootDir, configPath))),
  );

  const matrixConfigs = options.matrix
    ? await loadTargetConfigsFromDirectory(targetsDir)
    : [];

  const configs = dedupeTargets([
    ...matrixConfigs,
    ...explicitConfigs,
  ]);

  if (configs.length === 0) {
    const defaultConfig = createDefaultManagedTargetConfig();
    const outputDir = resolveReportDir(rootDir, options.reportDir, "reports/latest");
    const { report, jsonPath, markdownPath } = await runTargetSuite(
      rootDir,
      defaultConfig,
      outputDir,
    );

    console.log(`EIP-7702 compatibility run completed for ${report.target.label}.`);
    printRunSummary(rootDir, report, jsonPath, markdownPath);

    if (report.summary.failed > 0) {
      process.exitCode = 1;
    }

    return;
  }

  if (configs.length === 1 && !options.matrix) {
    const outputDir = resolveReportDir(rootDir, options.reportDir, "reports/latest");
    const { report, jsonPath, markdownPath } = await runTargetSuite(
      rootDir,
      configs[0],
      outputDir,
    );

    console.log(`EIP-7702 compatibility run completed for ${report.target.label}.`);
    printRunSummary(rootDir, report, jsonPath, markdownPath);

    if (report.summary.failed > 0) {
      process.exitCode = 1;
    }

    return;
  }

  const outputDir = resolveReportDir(rootDir, options.reportDir, "reports/matrix/latest");
  const { report, jsonPath, markdownPath } = await runTargetMatrix(rootDir, configs, outputDir);

  console.log("EIP-7702 compatibility matrix completed.");
  console.log("");
  console.log(
    `Targets       : ${report.summary.passingTargets}/${report.summary.totalTargets} passing · ${report.summary.failingTargets} failing`,
  );
  console.log("");
  for (const target of report.targets) {
    const passed = target.targetSummary?.passed ?? 0;
    const total = target.targetSummary?.total ?? 0;
    const status = target.status.toUpperCase().padEnd(4);
    const details = target.reportMarkdownPath
      ? ` -> ${target.reportMarkdownPath}`
      : target.error
        ? ` -> ${target.error}`
        : "";
    console.log(`  ${status}  ${target.id}  (${passed}/${total})${details}`);
  }
  console.log("");
  console.log(`Matrix JSON   : ${path.relative(rootDir, jsonPath)}`);
  console.log(`Matrix MD     : ${path.relative(rootDir, markdownPath)}`);

  if (report.summary.failingTargets > 0 || hasAnyFailures(
    report.targets
      .filter((target) => target.targetSummary)
      .map((target) => ({ failed: target.targetSummary?.failed ?? 0 })),
  )) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
