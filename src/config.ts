import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_ANVIL_CHAIN_ID,
  DEFAULT_HARDFORK,
  DEFAULT_MANAGED_AUTHORITY_START_INDEX,
  DEFAULT_MANAGED_SPONSOR_INDEX,
  REQUIRED_AUTHORITY_COUNT,
} from "./constants.js";
import type {
  Account,
  ManagedAnvilTargetConfig,
  RpcTargetConfig,
  TargetConfig,
} from "./types.js";

const TARGET_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

function assertRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function assertString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context} must be a non-empty string.`);
  }

  return value;
}

function assertNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number.`);
  }

  return value;
}

function assertOptionalNumber(value: unknown, fallback: number, context: string): number {
  if (value === undefined) {
    return fallback;
  }

  return assertNumber(value, context);
}

function parseAccount(raw: unknown, context: string): Account {
  const record = assertRecord(raw, context);
  return {
    address: assertString(record.address, `${context}.address`),
    privateKey: assertString(record.privateKey, `${context}.privateKey`),
  };
}

function parseTargetId(value: unknown, context: string): string {
  const id = assertString(value, context);
  if (!TARGET_ID_PATTERN.test(id)) {
    throw new Error(
      `${context} must match ${TARGET_ID_PATTERN.source}. Example: local-managed or provider_mainnet.`,
    );
  }

  return id;
}

function normalizeManagedTargetConfig(
  raw: Record<string, unknown>,
  sourcePath?: string,
): ManagedAnvilTargetConfig {
  const authorityCount = assertOptionalNumber(
    raw.authorityCount,
    REQUIRED_AUTHORITY_COUNT,
    "managed-anvil.authorityCount",
  );

  return {
    id: parseTargetId(raw.id, "managed-anvil.id"),
    label: assertString(raw.label, "managed-anvil.label"),
    kind: "managed-anvil",
    chainId: assertOptionalNumber(
      raw.chainId,
      DEFAULT_ANVIL_CHAIN_ID,
      "managed-anvil.chainId",
    ),
    hardfork: raw.hardfork === undefined
      ? DEFAULT_HARDFORK
      : assertString(raw.hardfork, "managed-anvil.hardfork"),
    sponsorIndex: assertOptionalNumber(
      raw.sponsorIndex,
      DEFAULT_MANAGED_SPONSOR_INDEX,
      "managed-anvil.sponsorIndex",
    ),
    authorityStartIndex: assertOptionalNumber(
      raw.authorityStartIndex,
      DEFAULT_MANAGED_AUTHORITY_START_INDEX,
      "managed-anvil.authorityStartIndex",
    ),
    authorityCount,
    sourcePath,
  };
}

function normalizeRpcTargetConfig(
  raw: Record<string, unknown>,
  sourcePath?: string,
): RpcTargetConfig {
  const authoritiesRaw = raw.authorities;
  if (!Array.isArray(authoritiesRaw) || authoritiesRaw.length === 0) {
    throw new Error("rpc.authorities must be a non-empty array.");
  }

  return {
    id: parseTargetId(raw.id, "rpc.id"),
    label: assertString(raw.label, "rpc.label"),
    kind: "rpc",
    rpcUrl: assertString(raw.rpcUrl, "rpc.rpcUrl"),
    chainId: assertNumber(raw.chainId, "rpc.chainId"),
    hardfork: raw.hardfork === undefined ? undefined : assertString(raw.hardfork, "rpc.hardfork"),
    sponsor: parseAccount(raw.sponsor, "rpc.sponsor"),
    authorities: authoritiesRaw.map((entry, index) =>
      parseAccount(entry, `rpc.authorities[${index}]`)
    ),
    sourcePath,
  };
}

export function createDefaultManagedTargetConfig(): ManagedAnvilTargetConfig {
  return {
    id: "local-managed",
    label: "Managed local Anvil (Prague)",
    kind: "managed-anvil",
    chainId: DEFAULT_ANVIL_CHAIN_ID,
    hardfork: DEFAULT_HARDFORK,
    sponsorIndex: DEFAULT_MANAGED_SPONSOR_INDEX,
    authorityStartIndex: DEFAULT_MANAGED_AUTHORITY_START_INDEX,
    authorityCount: REQUIRED_AUTHORITY_COUNT,
  };
}

export function parseTargetConfig(raw: unknown, sourcePath?: string): TargetConfig {
  const record = assertRecord(raw, sourcePath ?? "target config");
  const kind = assertString(record.kind, `${sourcePath ?? "target config"}.kind`);

  switch (kind) {
    case "managed-anvil":
      return normalizeManagedTargetConfig(record, sourcePath);
    case "rpc":
      return normalizeRpcTargetConfig(record, sourcePath);
    default:
      throw new Error(
        `${sourcePath ?? "target config"}.kind must be "managed-anvil" or "rpc".`,
      );
  }
}

export async function loadTargetConfig(filePath: string): Promise<TargetConfig> {
  const absolutePath = path.resolve(filePath);
  const raw = await readFile(absolutePath, "utf8");
  return parseTargetConfig(JSON.parse(raw), absolutePath);
}

export async function loadTargetConfigsFromDirectory(directory: string): Promise<TargetConfig[]> {
  const absoluteDirectory = path.resolve(directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const configFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".example.json"))
    .sort((left, right) => left.localeCompare(right));

  return await Promise.all(
    configFiles.map((fileName) => loadTargetConfig(path.join(absoluteDirectory, fileName))),
  );
}

export async function discoverTargetConfigPaths(directory: string): Promise<string[]> {
  const absoluteDirectory = path.resolve(directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".example.json"))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(absoluteDirectory, fileName));
}
