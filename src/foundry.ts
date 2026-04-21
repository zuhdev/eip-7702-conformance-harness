import { readFile } from "node:fs/promises";
import { runCommand } from "./process.js";
import type { Account, AuthorizationListEntry } from "./types.js";

export interface ContractArtifact {
  bytecode: {
    object: string;
  };
  deployedBytecode: {
    object: string;
  };
}

export interface LegacyTransactionArgs {
  cwd: string;
  chainId: number;
  nonce: bigint;
  gasLimit: bigint;
  gasPrice: bigint;
  privateKey: string;
  to: string;
  functionSignature?: string;
  functionArgs?: string[];
}

export interface Type7702TransactionArgs {
  cwd: string;
  chainId: number;
  nonce: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  privateKey: string;
  to: string;
  authorizations: string[];
  functionSignature?: string;
  functionArgs?: string[];
}

export interface CreateTransactionArgs {
  cwd: string;
  chainId: number;
  nonce: bigint;
  gasLimit: bigint;
  gasPrice: bigint;
  privateKey: string;
  initCode: string;
}

export async function buildContracts(cwd: string, solcPath: string): Promise<void> {
  await runCommand(
    "forge",
    ["build", "--root", cwd, "--offline", "--use", solcPath],
    { cwd, timeoutMs: 60_000 },
  );
}

export async function loadArtifact(
  cwd: string,
  sourceName: string,
  contractName: string,
): Promise<ContractArtifact> {
  const artifactPath = `${cwd}/out/${sourceName}.sol/${contractName}.json`;
  const raw = await readFile(artifactPath, "utf8");
  return JSON.parse(raw) as ContractArtifact;
}

export async function signAuthorization(args: {
  cwd: string;
  chainId: number;
  nonce: bigint;
  delegateAddress: string;
  privateKey: string;
}): Promise<string> {
  const result = await runCommand(
    "cast",
    [
      "wallet",
      "sign-auth",
      "--chain",
      String(args.chainId),
      "--nonce",
      args.nonce.toString(),
      "--private-key",
      args.privateKey,
      args.delegateAddress,
    ],
    { cwd: args.cwd },
  );

  return result.stdout.trim();
}

export async function decodeAuthorizationListEntry(
  cwd: string,
  signedAuthorization: string,
): Promise<AuthorizationListEntry> {
  const result = await runCommand("cast", ["from-rlp", signedAuthorization], { cwd });
  const values = JSON.parse(result.stdout.trim()) as string[];

  if (values.length !== 6) {
    throw new Error(
      `Expected 6 authorization tuple fields from cast from-rlp, received ${values.length}.`,
    );
  }

  return {
    chainId: values[0],
    address: values[1],
    nonce: values[2] === "0x" ? "0x0" : values[2],
    yParity: values[3] === "0x" ? "0x0" : values[3],
    r: values[4],
    s: values[5],
  };
}

export async function signLegacyTransaction(args: LegacyTransactionArgs): Promise<string> {
  const commandArgs = [
    "mktx",
    "--legacy",
    "--chain",
    String(args.chainId),
    "--nonce",
    args.nonce.toString(),
    "--gas-limit",
    args.gasLimit.toString(),
    "--gas-price",
    args.gasPrice.toString(),
    "--private-key",
    args.privateKey,
    args.to,
  ];

  if (args.functionSignature) {
    commandArgs.push(args.functionSignature, ...(args.functionArgs ?? []));
  }

  const result = await runCommand("cast", commandArgs, { cwd: args.cwd });
  return result.stdout.trim();
}

export async function signType7702Transaction(
  args: Type7702TransactionArgs,
): Promise<string> {
  const commandArgs = [
    "mktx",
    "--chain",
    String(args.chainId),
    "--nonce",
    args.nonce.toString(),
    "--gas-limit",
    args.gasLimit.toString(),
    "--gas-price",
    args.maxFeePerGas.toString(),
    "--priority-gas-price",
    args.maxPriorityFeePerGas.toString(),
    "--private-key",
    args.privateKey,
  ];

  for (const authorization of args.authorizations) {
    commandArgs.push("--auth", authorization);
  }

  commandArgs.push(args.to);

  if (args.functionSignature) {
    commandArgs.push(args.functionSignature, ...(args.functionArgs ?? []));
  }

  const result = await runCommand("cast", commandArgs, { cwd: args.cwd });
  return result.stdout.trim();
}

export async function signCreateTransaction(args: CreateTransactionArgs): Promise<string> {
  const result = await runCommand(
    "cast",
    [
      "mktx",
      "--legacy",
      "--chain",
      String(args.chainId),
      "--nonce",
      args.nonce.toString(),
      "--gas-limit",
      args.gasLimit.toString(),
      "--gas-price",
      args.gasPrice.toString(),
      "--private-key",
      args.privateKey,
      "--create",
      args.initCode,
    ],
    { cwd: args.cwd },
  );

  return result.stdout.trim();
}

export async function encodeCalldata(
  cwd: string,
  functionSignature: string,
  functionArgs: string[] = [],
): Promise<string> {
  const result = await runCommand(
    "cast",
    ["calldata", functionSignature, ...functionArgs],
    { cwd },
  );

  return result.stdout.trim();
}

export async function generateEphemeralAccount(cwd: string): Promise<Account> {
  const result = await runCommand("cast", ["wallet", "new", "--json"], { cwd });
  const parsed = JSON.parse(result.stdout.trim()) as Array<Record<string, string>>;
  const first = parsed[0];
  const address = first?.address;
  const privateKey = first?.private_key ?? first?.privateKey;

  if (!address || !privateKey) {
    throw new Error("cast wallet new did not return a usable keypair.");
  }

  return { address, privateKey };
}
