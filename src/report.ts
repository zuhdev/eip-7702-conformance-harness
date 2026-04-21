import type {
  FixtureMetadata,
  MatrixReport,
  RunReport,
  TargetMetadata,
  TestCategory,
  TestResult,
} from "./types.js";

const CATEGORY_ORDER: TestCategory[] = ["transaction", "rpc", "authorization", "execution"];

function categoryLabel(category: TestCategory): string {
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

function statusBadge(status: TestResult["status"]): string {
  switch (status) {
    case "pass":
      return "PASS";
    case "fail":
      return "FAIL";
    case "skip":
      return "SKIP";
  }
}

function groupByCategory(tests: TestResult[]): Map<TestCategory, TestResult[]> {
  const groups = new Map<TestCategory, TestResult[]>();
  for (const category of CATEGORY_ORDER) {
    groups.set(category, []);
  }
  for (const test of tests) {
    const bucket = groups.get(test.category);
    if (bucket) {
      bucket.push(test);
    }
  }
  return groups;
}

function renderEvidenceValue(value: unknown, indent: string): string[] {
  if (value === null || value === undefined) {
    return [`${indent}null`];
  }

  if (typeof value === "string") {
    return [`${indent}${value}`];
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return [`${indent}${String(value)}`];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${indent}[]`];
    }
    const lines: string[] = [];
    for (const entry of value) {
      lines.push(`${indent}-`);
      lines.push(...renderEvidenceValue(entry, `${indent}  `));
    }
    return lines;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return [`${indent}{}`];
    }
    const lines: string[] = [];
    for (const [key, entryValue] of entries) {
      if (
        entryValue !== null &&
        typeof entryValue === "object" &&
        !Array.isArray(entryValue)
      ) {
        lines.push(`${indent}${key}:`);
        lines.push(...renderEvidenceValue(entryValue, `${indent}  `));
      } else if (Array.isArray(entryValue)) {
        lines.push(`${indent}${key}:`);
        lines.push(...renderEvidenceValue(entryValue, `${indent}  `));
      } else {
        const scalar = renderEvidenceValue(entryValue, "")[0] ?? "";
        lines.push(`${indent}${key}: ${scalar}`);
      }
    }
    return lines;
  }

  return [`${indent}${String(value)}`];
}

function renderTestDetail(test: TestResult, lines: string[]): void {
  lines.push(`#### \`${test.id}\``);
  lines.push("");
  lines.push(`**Status:** ${statusBadge(test.status)} · **Category:** ${categoryLabel(test.category)} · **Duration:** ${test.durationMs}ms`);
  lines.push("");
  lines.push(test.description);
  lines.push("");

  if (test.assertions.length > 0) {
    lines.push("**Assertions**");
    lines.push("");
    for (const assertion of test.assertions) {
      const marker = assertion.pass ? "x" : " ";
      lines.push(`- [${marker}] ${assertion.label}`);
      if (assertion.expected !== undefined) {
        lines.push(`  - expected: \`${assertion.expected}\``);
      }
      if (assertion.actual !== undefined) {
        lines.push(`  - actual: \`${assertion.actual}\``);
      }
      if (assertion.note) {
        lines.push(`  - note: ${assertion.note}`);
      }
    }
    lines.push("");
  }

  if (test.error) {
    lines.push("**Error**");
    lines.push("");
    lines.push("```");
    lines.push(test.error);
    lines.push("```");
    lines.push("");
  }

  const detailEntries = Object.entries(test.details);
  if (detailEntries.length > 0) {
    lines.push("**Evidence**");
    lines.push("");
    for (const [key, value] of detailEntries) {
      if (
        value !== null &&
        typeof value === "object"
      ) {
        lines.push(`- ${key}:`);
        for (const line of renderEvidenceValue(value, "  ")) {
          lines.push(line);
        }
      } else {
        const scalar = renderEvidenceValue(value, "")[0] ?? "";
        lines.push(`- ${key}: \`${scalar}\``);
      }
    }
    lines.push("");
  }
}

function renderTargetBlock(target: TargetMetadata, fixtures: FixtureMetadata, lines: string[]): void {
  lines.push("## Target");
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Label | ${target.label} |`);
  lines.push(`| Kind | ${target.kind} |`);
  lines.push(`| Chain ID | ${target.chainId} |`);
  if (target.hardfork) {
    lines.push(`| Hardfork | ${target.hardfork} |`);
  }
  lines.push(`| RPC URL | \`${target.rpcUrl}\` |`);
  lines.push(`| Fixture address | \`${fixtures.delegationTarget.address}\` |`);
  lines.push(`| Fixture runtime size | ${fixtures.delegationTarget.runtimeBytecodeSize} bytes |`);
  if (target.sourcePath) {
    lines.push(`| Config source | \`${target.sourcePath}\` |`);
  }
  lines.push("");
}

export function renderMarkdownReport(report: RunReport): string {
  const lines: string[] = [];

  lines.push("# EIP-7702 Compatibility Report");
  lines.push("");
  lines.push(`- **Suite:** ${report.suite} v${report.version}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push("");

  renderTargetBlock(report.target, report.fixtures, lines);

  lines.push("## Summary");
  lines.push("");
  lines.push("| Total | Passed | Failed | Skipped |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(
    `| ${report.summary.total} | ${report.summary.passed} | ${report.summary.failed} | ${report.summary.skipped} |`,
  );
  lines.push("");

  const grouped = groupByCategory(report.tests);

  lines.push("## Coverage by category");
  lines.push("");
  lines.push("| Category | Passed | Failed | Total |");
  lines.push("| --- | --- | --- | --- |");
  for (const category of CATEGORY_ORDER) {
    const bucket = grouped.get(category) ?? [];
    if (bucket.length === 0) continue;
    const passed = bucket.filter((test) => test.status === "pass").length;
    const failed = bucket.filter((test) => test.status === "fail").length;
    lines.push(`| ${categoryLabel(category)} | ${passed} | ${failed} | ${bucket.length} |`);
  }
  lines.push("");

  lines.push("## Results");
  lines.push("");
  lines.push("| Category | Test | Result | Duration |");
  lines.push("| --- | --- | --- | --- |");
  for (const category of CATEGORY_ORDER) {
    const bucket = grouped.get(category) ?? [];
    for (const test of bucket) {
      lines.push(
        `| ${categoryLabel(test.category)} | \`${test.id}\` | ${statusBadge(test.status)} | ${test.durationMs}ms |`,
      );
    }
  }
  lines.push("");

  lines.push("## Detailed results");
  lines.push("");
  for (const category of CATEGORY_ORDER) {
    const bucket = grouped.get(category) ?? [];
    if (bucket.length === 0) continue;
    lines.push(`### ${categoryLabel(category)}`);
    lines.push("");
    for (const test of bucket) {
      renderTestDetail(test, lines);
    }
  }

  if (report.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function renderMatrixMarkdownReport(report: MatrixReport): string {
  const lines: string[] = [];

  lines.push("# EIP-7702 Compatibility Matrix");
  lines.push("");
  lines.push(`- **Suite:** ${report.suite} v${report.version}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Targets | Passing | Failing |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| ${report.summary.totalTargets} | ${report.summary.passingTargets} | ${report.summary.failingTargets} |`,
  );
  lines.push("");
  lines.push("## Targets");
  lines.push("");
  lines.push("| Target | Kind | Result | Passed | Failed | Report |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const target of report.targets) {
    const passed = target.targetSummary?.passed ?? "-";
    const failed = target.targetSummary?.failed ?? "-";
    const reportLink = target.reportMarkdownPath
      ? `[markdown](${target.reportMarkdownPath})`
      : "-";
    lines.push(
      `| ${target.id} | ${target.kind} | ${statusBadge(target.status)} | ${passed} | ${failed} | ${reportLink} |`,
    );
  }
  lines.push("");

  const erroredTargets = report.targets.filter((target) => target.error);
  if (erroredTargets.length > 0) {
    lines.push("## Target errors");
    lines.push("");
    for (const target of erroredTargets) {
      lines.push(`### ${target.id}`);
      lines.push("");
      lines.push("```");
      lines.push(target.error ?? "Unknown target failure.");
      lines.push("```");
      lines.push("");
    }
  }

  if (report.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}
