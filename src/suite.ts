import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  ANVIL_ACCOUNTS,
  DEFAULT_LEGACY_GAS_PRICE,
  DEFAULT_MAX_FEE,
  DEFAULT_PRIORITY_FEE,
  DEPLOY_GAS_LIMIT,
  PRECOMPILE_ONE,
  REQUIRED_AUTHORITY_COUNT,
  SUITE_NAME,
  SUITE_VERSION,
  TYPE_7702_GAS_LIMIT,
  ZERO_ADDRESS,
} from "./constants.js";
import {
  buildContracts,
  decodeAuthorizationListEntry,
  encodeCalldata,
  generateEphemeralAccount,
  loadArtifact,
  signAuthorization,
  signCreateTransaction,
  signType7702Transaction,
} from "./foundry.js";
import { renderMarkdownReport, renderMatrixMarkdownReport } from "./report.js";
import { RpcClient, RpcRequestError } from "./rpc.js";
import { reservePort, resolveExecutablePath } from "./process.js";
import type { ContractArtifact } from "./foundry.js";
import type {
  Account,
  AssertionResult,
  FixtureMetadata,
  ManagedAnvilTargetConfig,
  MatrixReport,
  MatrixTargetResult,
  ReportSummary,
  RpcTargetConfig,
  RunReport,
  SuiteContext,
  TargetConfig,
  TargetMetadata,
  TestCategory,
  TestResult,
  TransactionReceipt,
} from "./types.js";

interface ManagedAnvilInstance {
  rpcUrl: string;
  stop(): Promise<void>;
}

interface BuiltFixtureArtifact {
  artifactPath: string;
  initCode: string;
  runtimeBytecodeSize: number;
}

interface PreparedTargetEnvironment {
  context: SuiteContext;
  fixtures: FixtureMetadata;
  target: TargetMetadata;
  cleanup(): Promise<void>;
}

interface TestDefinition {
  id: string;
  title: string;
  category: TestCategory;
  description: string;
  run(context: SuiteContext): Promise<{
    assertions: AssertionResult[];
    details: Record<string, unknown>;
  }>;
}

export interface SingleTargetRunArtifacts {
  report: RunReport;
  outputDir: string;
  jsonPath: string;
  markdownPath: string;
}

export interface MatrixRunArtifacts {
  report: MatrixReport;
  outputDir: string;
  jsonPath: string;
  markdownPath: string;
}

const fixtureCache = new Map<string, Promise<BuiltFixtureArtifact>>();

function sanitizeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ALL_PROXY: "",
    all_proxy: "",
    HTTP_PROXY: "",
    http_proxy: "",
    HTTPS_PROXY: "",
    https_proxy: "",
    NO_PROXY: "*",
    no_proxy: "*",
  };
}

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function hexByteLength(value: string): number {
  if (!value.startsWith("0x")) {
    throw new Error(`Expected hex string, received: ${value}`);
  }

  return (value.length - 2) / 2;
}

function delegationIndicator(delegateAddress: string): string {
  return `0xef0100${normalizeHex(delegateAddress).slice(2)}`;
}

function decodeUint256(result: string): bigint {
  return BigInt(result);
}

function decodeAddress(result: string): string {
  const normalized = normalizeHex(result);
  return `0x${normalized.slice(normalized.length - 40)}`;
}

function decodeUint256Pair(result: string): [bigint, bigint] {
  const normalized = result.startsWith("0x") ? result.slice(2) : result;
  if (normalized.length !== 128) {
    throw new Error(`Expected two 32-byte values, received ${result}`);
  }

  const first = BigInt(`0x${normalized.slice(0, 64)}`);
  const second = BigInt(`0x${normalized.slice(64, 128)}`);
  return [first, second];
}

function toRpcHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function summarizeTests(results: TestResult[]): ReportSummary {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    skipped: results.filter((result) => result.status === "skip").length,
  };
}

function assertSufficientAuthorities(authorities: Account[], targetId: string): void {
  if (authorities.length < REQUIRED_AUTHORITY_COUNT) {
    throw new Error(
      `Target ${targetId} must provide at least ${REQUIRED_AUTHORITY_COUNT} authority accounts; received ${authorities.length}.`,
    );
  }
}

async function getBuiltFixtureArtifact(rootDir: string): Promise<BuiltFixtureArtifact> {
  const cached = fixtureCache.get(rootDir);
  if (cached) {
    return await cached;
  }

  const pending = (async (): Promise<BuiltFixtureArtifact> => {
    const solcPath = await resolveExecutablePath("solc");
    await buildContracts(rootDir, solcPath);
    const artifact: ContractArtifact = await loadArtifact(
      rootDir,
      "DelegationTarget",
      "DelegationTarget",
    );
    const artifactPath = path.join(
      rootDir,
      "out",
      "DelegationTarget.sol",
      "DelegationTarget.json",
    );

    return {
      artifactPath,
      initCode: artifact.bytecode.object,
      runtimeBytecodeSize: hexByteLength(artifact.deployedBytecode.object),
    };
  })();

  fixtureCache.set(rootDir, pending);

  try {
    return await pending;
  } catch (error) {
    fixtureCache.delete(rootDir);
    throw error;
  }
}

async function sendType7702Transaction(input: {
  context: SuiteContext;
  authority: Account;
  delegateAddress: string;
  destination: string;
  functionSignature?: string;
  functionArgs?: string[];
  authChainId?: number;
  authNonceOverride?: bigint;
}): Promise<{
  transactionHash: string;
  receipt: TransactionReceipt;
  authorization: string;
}> {
  const sponsorNonce = await input.context.rpc.getTransactionCount(input.context.sponsor.address);
  const authorityNonce = input.authNonceOverride
    ?? (await input.context.rpc.getTransactionCount(input.authority.address));
  const authorization = await signAuthorization({
    cwd: input.context.rootDir,
    chainId: input.authChainId ?? input.context.target.chainId,
    nonce: authorityNonce,
    delegateAddress: input.delegateAddress,
    privateKey: input.authority.privateKey,
  });

  const rawTransaction = await signType7702Transaction({
    cwd: input.context.rootDir,
    chainId: input.context.target.chainId,
    nonce: sponsorNonce,
    gasLimit: TYPE_7702_GAS_LIMIT,
    maxFeePerGas: DEFAULT_MAX_FEE,
    maxPriorityFeePerGas: DEFAULT_PRIORITY_FEE,
    privateKey: input.context.sponsor.privateKey,
    to: input.destination,
    authorizations: [authorization],
    functionSignature: input.functionSignature,
    functionArgs: input.functionArgs,
  });

  const transactionHash = await input.context.rpc.sendRawTransaction(rawTransaction);
  const receipt = await input.context.rpc.waitForReceipt(transactionHash);
  return { transactionHash, receipt, authorization };
}

async function buildAuthorizationListEntry(input: {
  context: SuiteContext;
  authority: Account;
  delegateAddress: string;
  chainId?: number;
}): Promise<{
  signedAuthorization: string;
  entry: import("./types.js").AuthorizationListEntry;
}> {
  const nonce = await input.context.rpc.getTransactionCount(input.authority.address);
  const signedAuthorization = await signAuthorization({
    cwd: input.context.rootDir,
    chainId: input.chainId ?? input.context.target.chainId,
    nonce,
    delegateAddress: input.delegateAddress,
    privateKey: input.authority.privateKey,
  });
  const entry = await decodeAuthorizationListEntry(
    input.context.rootDir,
    signedAuthorization,
  );

  return {
    signedAuthorization,
    entry,
  };
}

async function deployDelegationTarget(
  rootDir: string,
  rpc: RpcClient,
  sponsor: Account,
  chainId: number,
  initCode: string,
): Promise<TransactionReceipt> {
  const sponsorNonce = await rpc.getTransactionCount(sponsor.address);
  const rawTransaction = await signCreateTransaction({
    cwd: rootDir,
    chainId,
    nonce: sponsorNonce,
    gasLimit: DEPLOY_GAS_LIMIT,
    gasPrice: DEFAULT_LEGACY_GAS_PRICE,
    privateKey: sponsor.privateKey,
    initCode,
  });
  const hash = await rpc.sendRawTransaction(rawTransaction);
  return await rpc.waitForReceipt(hash);
}

async function startManagedAnvil(
  rootDir: string,
  config: ManagedAnvilTargetConfig,
): Promise<ManagedAnvilInstance> {
  const port = await reservePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvilConfigPath = path.join(rootDir, ".anvil");
  await mkdir(anvilConfigPath, { recursive: true });

  const child = spawn(
    "anvil",
    [
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--hardfork",
      config.hardfork,
      "--chain-id",
      String(config.chainId),
      "--config-out",
      path.join(anvilConfigPath, `${config.id}.json`),
    ],
    {
      cwd: rootDir,
      env: sanitizeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let logs = "";

  child.stdout.on("data", (chunk: Buffer) => {
    logs += chunk.toString("utf8");
  });

  child.stderr.on("data", (chunk: Buffer) => {
    logs += chunk.toString("utf8");
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (logs.includes("Listening on")) {
      return {
        rpcUrl,
        async stop() {
          if (child.killed) {
            return;
          }

          child.kill("SIGINT");
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              if (!child.killed) {
                child.kill("SIGKILL");
              }
              resolve();
            }, 2_000);

            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        },
      };
    }

    if (child.exitCode !== null) {
      throw new Error(`Anvil exited early for target ${config.id}.\n${logs}`);
    }

    await delay(100);
  }

  child.kill("SIGKILL");
  throw new Error(`Timed out waiting for Anvil to start for target ${config.id}.\n${logs}`);
}

function resolveManagedAccounts(config: ManagedAnvilTargetConfig): {
  sponsor: Account;
  authorities: Account[];
} {
  const sponsor = ANVIL_ACCOUNTS[config.sponsorIndex];
  if (!sponsor) {
    throw new Error(`Target ${config.id} sponsorIndex=${config.sponsorIndex} is out of range.`);
  }

  const authorities = ANVIL_ACCOUNTS.slice(
    config.authorityStartIndex,
    config.authorityStartIndex + config.authorityCount,
  );

  if (authorities.length !== config.authorityCount) {
    throw new Error(
      `Target ${config.id} authority range exceeds the built-in Anvil account set.`,
    );
  }

  assertSufficientAuthorities(authorities, config.id);

  return { sponsor, authorities };
}

async function prepareTargetEnvironment(
  rootDir: string,
  config: TargetConfig,
  builtFixture: BuiltFixtureArtifact,
): Promise<PreparedTargetEnvironment> {
  let cleanup = async (): Promise<void> => {};
  let rpcUrl = "";
  let sponsor: Account;
  let authorities: Account[];

  if (config.kind === "managed-anvil") {
    const instance = await startManagedAnvil(rootDir, config);
    cleanup = async () => {
      await instance.stop();
    };
    rpcUrl = instance.rpcUrl;
    ({ sponsor, authorities } = resolveManagedAccounts(config));
  } else {
    rpcUrl = config.rpcUrl;
    sponsor = config.sponsor;
    authorities = config.authorities;
    assertSufficientAuthorities(authorities, config.id);
  }

  const rpc = new RpcClient(rpcUrl);
  const deploymentReceipt = await deployDelegationTarget(
    rootDir,
    rpc,
    sponsor,
    config.chainId,
    builtFixture.initCode,
  );

  if (!deploymentReceipt.contractAddress) {
    throw new Error(`Fixture deployment failed for target ${config.id}: no contract address.`);
  }

  const target: TargetMetadata = {
    id: config.id,
    label: config.label,
    kind: config.kind,
    rpcUrl,
    chainId: config.chainId,
    hardfork: config.kind === "managed-anvil" ? config.hardfork : config.hardfork ?? null,
    sourcePath: config.sourcePath,
  };

  const fixtures: FixtureMetadata = {
    delegationTarget: {
      address: deploymentReceipt.contractAddress,
      artifactPath: builtFixture.artifactPath,
      runtimeBytecodeSize: builtFixture.runtimeBytecodeSize,
    },
  };

  const context: SuiteContext = {
    rootDir,
    target,
    rpc,
    sponsor,
    authorities,
    delegationTarget: fixtures.delegationTarget.address,
    delegationTargetRuntimeSize: fixtures.delegationTarget.runtimeBytecodeSize,
  };

  return {
    context,
    fixtures,
    target,
    cleanup,
  };
}

async function executeTest(
  definition: TestDefinition,
  context: SuiteContext,
): Promise<TestResult> {
  const startedAt = performance.now();

  try {
    const { assertions, details } = await definition.run(context);
    const status = assertions.every((assertion) => assertion.pass) ? "pass" : "fail";

    return {
      id: definition.id,
      title: definition.title,
      category: definition.category,
      description: definition.description,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      assertions,
      details,
    };
  } catch (error) {
    return {
      id: definition.id,
      title: definition.title,
      category: definition.category,
      description: definition.description,
      status: "fail",
      durationMs: Math.round(performance.now() - startedAt),
      assertions: [],
      details: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildTestPlan(): TestDefinition[] {
  return [
    {
      id: "transaction.accepts_type_0x04",
      title: "Accepts a type-0x04 EIP-7702 transaction",
      category: "transaction",
      description:
        "Submits a real type-0x04 transaction with a valid authorization and checks receipt typing plus delegation side effects.",
      async run(context) {
        const authority = context.authorities[0];
        const { transactionHash, receipt } = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: PRECOMPILE_ONE,
          destination: authority.address,
        });
        const code = await context.rpc.getCode(authority.address);
        const authorityNonce = await context.rpc.getTransactionCount(authority.address);

        return {
          assertions: [
            {
              label: "Receipt reports type 0x4",
              pass: receipt.type === "0x4",
              expected: "0x4",
              actual: receipt.type,
            },
            {
              label: "Transaction succeeds",
              pass: receipt.status === "0x1",
              expected: "0x1",
              actual: receipt.status,
            },
            {
              label: "Delegation indicator was written",
              pass: normalizeHex(code) === delegationIndicator(PRECOMPILE_ONE),
              expected: delegationIndicator(PRECOMPILE_ONE),
              actual: normalizeHex(code),
            },
            {
              label: "Authority nonce increments to 1",
              pass: authorityNonce === 1n,
              expected: "1",
              actual: authorityNonce.toString(),
            },
          ],
          details: {
            transactionHash,
            authority: authority.address,
            delegateAddress: PRECOMPILE_ONE,
            receiptType: receipt.type,
            code,
          },
        };
      },
    },
    {
      id: "rpc.estimates_gas_with_authorization_list",
      title: "Estimates gas for a delegated EIP-7702 call",
      category: "rpc",
      description:
        "Uses eth_estimateGas with an authorizationList payload and delegated calldata to verify that provider-side simulation works before broadcast.",
      async run(context) {
        const authority = context.authorities[1];
        const { entry, signedAuthorization } = await buildAuthorizationListEntry({
          context,
          authority,
          delegateAddress: context.delegationTarget,
        });
        const calldata = await encodeCalldata(context.rootDir, "setNumber(uint256)", ["42"]);
        const estimate = await context.rpc.estimateGas({
          from: context.sponsor.address,
          to: authority.address,
          data: calldata,
          authorizationList: [entry],
        });

        return {
          assertions: [
            {
              label: "Provider returns a positive gas estimate",
              pass: estimate > 0n,
              expected: "> 0",
              actual: estimate.toString(),
            },
            {
              label: "Estimate exceeds a plain 21k transfer",
              pass: estimate > 21_000n,
              expected: "> 21000",
              actual: estimate.toString(),
            },
          ],
          details: {
            authority: authority.address,
            delegateAddress: context.delegationTarget,
            signedAuthorization,
            authorizationListEntry: entry,
            calldata,
            estimate: estimate.toString(),
            estimateHex: toRpcHex(estimate),
          },
        };
      },
    },
    {
      id: "rpc.eth_call_simulates_delegated_context",
      title: "Simulates delegated execution via eth_call",
      category: "rpc",
      description:
        "Uses eth_call with an authorizationList payload against a clean authority and checks that delegated execution resolves address(this) to the authority.",
      async run(context) {
        const authority = context.authorities[1];
        const { entry, signedAuthorization } = await buildAuthorizationListEntry({
          context,
          authority,
          delegateAddress: context.delegationTarget,
        });
        const calldata = await encodeCalldata(context.rootDir, "contextAddress()");
        const result = await context.rpc.callTransaction(
          {
            from: context.sponsor.address,
            to: authority.address,
            data: calldata,
            gas: toRpcHex(TYPE_7702_GAS_LIMIT),
            authorizationList: [entry],
          },
          "latest",
        );
        const resolvedContext = decodeAddress(result);

        return {
          assertions: [
            {
              label: "Delegated eth_call returns the authority as address(this)",
              pass: normalizeHex(resolvedContext) === normalizeHex(authority.address),
              expected: normalizeHex(authority.address),
              actual: normalizeHex(resolvedContext),
            },
          ],
          details: {
            authority: authority.address,
            delegateAddress: context.delegationTarget,
            signedAuthorization,
            authorizationListEntry: entry,
            calldata,
            rawResult: result,
            resolvedContext,
          },
        };
      },
    },
    {
      id: "rpc.eth_call_surfaces_revert_metadata",
      title: "Surfaces revert metadata for delegated eth_call",
      category: "rpc",
      description:
        "Uses eth_call with an authorizationList payload against a reverting delegated function and verifies that provider error metadata remains actionable.",
      async run(context) {
        const authority = context.authorities[1];
        const { entry, signedAuthorization } = await buildAuthorizationListEntry({
          context,
          authority,
          delegateAddress: context.delegationTarget,
        });
        const calldata = await encodeCalldata(context.rootDir, "revertAlways()");

        try {
          await context.rpc.callTransaction(
            {
              from: context.sponsor.address,
              to: authority.address,
              data: calldata,
              gas: toRpcHex(TYPE_7702_GAS_LIMIT),
              authorizationList: [entry],
            },
            "latest",
          );
          return {
            assertions: [
              {
                label: "Provider should surface a revert instead of returning success",
                pass: false,
                expected: "RPC error",
                actual: "success",
              },
            ],
            details: {
              authority: authority.address,
              delegateAddress: context.delegationTarget,
              signedAuthorization,
              authorizationListEntry: entry,
              calldata,
            },
          };
        } catch (error) {
          const rpcError = error instanceof RpcRequestError ? error : null;
          const errorData =
            typeof rpcError?.data === "string"
              ? rpcError.data
              : JSON.stringify(rpcError?.data ?? null);
          const message = rpcError?.message ?? String(error);

          return {
            assertions: [
              {
                label: "Provider returns a structured RPC error",
                pass: rpcError !== null,
                expected: "RpcRequestError",
                actual: error instanceof Error ? error.constructor.name : typeof error,
              },
              {
                label: "Error message preserves the revert reason",
                pass: message.includes("EXPECTED_REVERT"),
                expected: "message contains EXPECTED_REVERT",
                actual: message,
              },
              {
                label: "Error data preserves ABI-encoded revert payload",
                pass: errorData.startsWith("0x08c379a0"),
                expected: "0x08c379a0...",
                actual: errorData,
              },
            ],
            details: {
              authority: authority.address,
              delegateAddress: context.delegationTarget,
              signedAuthorization,
              authorizationListEntry: entry,
              calldata,
              errorCode: rpcError?.code ?? null,
              errorMessage: message,
              errorData,
            },
          };
        }
      },
    },
    {
      id: "authorization.skips_invalid_chain_id",
      title: "Skips an authorization with the wrong chain ID",
      category: "authorization",
      description:
        "Signs an authorization for a mismatched chain ID and verifies the transaction still mines while the authority remains unchanged.",
      async run(context) {
        const authority = context.authorities[1];
        const { transactionHash, receipt } = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: context.sponsor.address,
          authChainId: context.target.chainId + 1,
        });
        const code = await context.rpc.getCode(authority.address);
        const authorityNonce = await context.rpc.getTransactionCount(authority.address);

        return {
          assertions: [
            {
              label: "Transaction still succeeds",
              pass: receipt.status === "0x1",
              expected: "0x1",
              actual: receipt.status,
            },
            {
              label: "Authority code remains empty",
              pass: normalizeHex(code) === "0x",
              expected: "0x",
              actual: normalizeHex(code),
            },
            {
              label: "Authority nonce does not change",
              pass: authorityNonce === 0n,
              expected: "0",
              actual: authorityNonce.toString(),
            },
          ],
          details: {
            transactionHash,
            authority: authority.address,
            attemptedDelegateAddress: context.delegationTarget,
            code,
          },
        };
      },
    },
    {
      id: "authorization.skips_invalid_nonce",
      title: "Skips an authorization signed with the wrong nonce",
      category: "authorization",
      description:
        "Signs an authorization with a nonce that does not match the authority's current nonce and verifies the outer transaction still mines while the authority remains unchanged.",
      async run(context) {
        const authority = context.authorities[1];
        const attemptedNonce = 99n;
        const { transactionHash, receipt } = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: context.sponsor.address,
          authNonceOverride: attemptedNonce,
        });
        const code = await context.rpc.getCode(authority.address);
        const authorityNonce = await context.rpc.getTransactionCount(authority.address);

        return {
          assertions: [
            {
              label: "Transaction still succeeds",
              pass: receipt.status === "0x1",
              expected: "0x1",
              actual: receipt.status,
            },
            {
              label: "Authority code remains empty",
              pass: normalizeHex(code) === "0x",
              expected: "0x",
              actual: normalizeHex(code),
            },
            {
              label: "Authority nonce does not change",
              pass: authorityNonce === 0n,
              expected: "0",
              actual: authorityNonce.toString(),
            },
          ],
          details: {
            transactionHash,
            authority: authority.address,
            attemptedDelegateAddress: context.delegationTarget,
            attemptedNonce: attemptedNonce.toString(),
            code,
          },
        };
      },
    },
    {
      id: "authorization.accepts_chain_id_zero_for_any_chain",
      title: "Accepts a chain-agnostic authorization with chain_id = 0",
      category: "authorization",
      description:
        "Signs an authorization with chain_id=0 (chain-agnostic per EIP-7702) and verifies it is accepted on the target chain with the expected delegation side effects.",
      async run(context) {
        const authority = await generateEphemeralAccount(context.rootDir);
        const { transactionHash, receipt, authorization } = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: context.sponsor.address,
          authChainId: 0,
        });
        const code = await context.rpc.getCode(authority.address);
        const authorityNonce = await context.rpc.getTransactionCount(authority.address);

        return {
          assertions: [
            {
              label: "Transaction succeeds",
              pass: receipt.status === "0x1",
              expected: "0x1",
              actual: receipt.status,
            },
            {
              label: "Delegation indicator is written despite chain_id=0",
              pass: normalizeHex(code) === delegationIndicator(context.delegationTarget),
              expected: delegationIndicator(context.delegationTarget),
              actual: normalizeHex(code),
            },
            {
              label: "Authority nonce increments for the replay-safe authorization",
              pass: authorityNonce === 1n,
              expected: "1",
              actual: authorityNonce.toString(),
            },
          ],
          details: {
            transactionHash,
            authority: authority.address,
            delegateAddress: context.delegationTarget,
            authorization,
            code,
          },
        };
      },
    },
    {
      id: "authorization.overwrites_existing_delegation",
      title: "Overwrites an existing delegation with a new target",
      category: "authorization",
      description:
        "Delegates an authority to the fixture contract, then re-delegates the same authority to a different target and verifies the indicator swaps while the nonce increments twice.",
      async run(context) {
        const authority = await generateEphemeralAccount(context.rootDir);

        const firstTransaction = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: context.sponsor.address,
        });
        const firstCode = await context.rpc.getCode(authority.address);

        const secondTransaction = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: PRECOMPILE_ONE,
          destination: context.sponsor.address,
        });
        const secondCode = await context.rpc.getCode(authority.address);
        const authorityNonce = await context.rpc.getTransactionCount(authority.address);

        return {
          assertions: [
            {
              label: "First delegation transaction succeeds",
              pass: firstTransaction.receipt.status === "0x1",
              expected: "0x1",
              actual: firstTransaction.receipt.status,
            },
            {
              label: "First indicator points at the fixture",
              pass: normalizeHex(firstCode) === delegationIndicator(context.delegationTarget),
              expected: delegationIndicator(context.delegationTarget),
              actual: normalizeHex(firstCode),
            },
            {
              label: "Second delegation transaction succeeds",
              pass: secondTransaction.receipt.status === "0x1",
              expected: "0x1",
              actual: secondTransaction.receipt.status,
            },
            {
              label: "Second indicator overwrites the first",
              pass: normalizeHex(secondCode) === delegationIndicator(PRECOMPILE_ONE),
              expected: delegationIndicator(PRECOMPILE_ONE),
              actual: normalizeHex(secondCode),
            },
            {
              label: "Authority nonce increments twice",
              pass: authorityNonce === 2n,
              expected: "2",
              actual: authorityNonce.toString(),
            },
          ],
          details: {
            authority: authority.address,
            firstTransactionHash: firstTransaction.transactionHash,
            secondTransactionHash: secondTransaction.transactionHash,
            firstDelegateAddress: context.delegationTarget,
            secondDelegateAddress: PRECOMPILE_ONE,
            firstCode,
            secondCode,
          },
        };
      },
    },
    {
      id: "authorization.clears_with_zero_address",
      title: "Clears delegation when the authorized address is zero",
      category: "authorization",
      description:
        "Applies a valid delegation first, then sends a second valid authorization to the zero address and verifies that the authority code is cleared.",
      async run(context) {
        const authority = context.authorities[2];
        const firstTransaction = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: context.sponsor.address,
        });
        const secondTransaction = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: ZERO_ADDRESS,
          destination: context.sponsor.address,
        });
        const code = await context.rpc.getCode(authority.address);
        const authorityNonce = await context.rpc.getTransactionCount(authority.address);

        return {
          assertions: [
            {
              label: "Initial delegation succeeds",
              pass: firstTransaction.receipt.status === "0x1",
              expected: "0x1",
              actual: firstTransaction.receipt.status,
            },
            {
              label: "Clearing transaction succeeds",
              pass: secondTransaction.receipt.status === "0x1",
              expected: "0x1",
              actual: secondTransaction.receipt.status,
            },
            {
              label: "Authority code is cleared",
              pass: normalizeHex(code) === "0x",
              expected: "0x",
              actual: normalizeHex(code),
            },
            {
              label: "Authority nonce increments twice",
              pass: authorityNonce === 2n,
              expected: "2",
              actual: authorityNonce.toString(),
            },
          ],
          details: {
            initialTransactionHash: firstTransaction.transactionHash,
            clearingTransactionHash: secondTransaction.transactionHash,
            authority: authority.address,
            code,
          },
        };
      },
    },
    {
      id: "authorization.writes_contract_delegate_indicator",
      title: "Writes a delegation indicator for a contract target",
      category: "authorization",
      description:
        "Applies a valid authorization that points to the deployed fixture contract and verifies that the indicator and nonce update match the expected contract delegation path.",
      async run(context) {
        const authority = context.authorities[3];
        const { transactionHash, receipt } = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: context.sponsor.address,
        });
        const code = await context.rpc.getCode(authority.address);
        const updatedNonce = await context.rpc.getTransactionCount(authority.address);

        return {
          assertions: [
            {
              label: "Contract-target authorization transaction succeeds",
              pass: receipt.status === "0x1",
              expected: "0x1",
              actual: receipt.status,
            },
            {
              label: "Indicator points at the deployed fixture contract",
              pass: normalizeHex(code) === delegationIndicator(context.delegationTarget),
              expected: delegationIndicator(context.delegationTarget),
              actual: normalizeHex(code),
            },
            {
              label: "Authority nonce increments once for the valid authorization",
              pass: updatedNonce === 1n,
              expected: "1",
              actual: updatedNonce.toString(),
            },
          ],
          details: {
            transactionHash,
            authority: authority.address,
            delegateAddress: context.delegationTarget,
            code,
          },
        };
      },
    },
    {
      id: "execution.delegated_storage_write",
      title: "Executes delegated contract logic in authority storage context",
      category: "execution",
      description:
        "Delegates an authority to the fixture contract, writes storage through the delegated entrypoint, and reads it back from the authority address.",
      async run(context) {
        const authority = context.authorities[4];
        const { transactionHash, receipt } = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: authority.address,
          functionSignature: "setNumber(uint256)",
          functionArgs: ["42"],
        });

        const storedNumberCallData = await encodeCalldata(context.rootDir, "storedNumber()");
        const contextAddressCallData = await encodeCalldata(context.rootDir, "contextAddress()");
        const storedNumber = decodeUint256(
          await context.rpc.call(authority.address, storedNumberCallData),
        );
        const contextAddress = decodeAddress(
          await context.rpc.call(authority.address, contextAddressCallData),
        );

        return {
          assertions: [
            {
              label: "Delegated storage write transaction succeeds",
              pass: receipt.status === "0x1",
              expected: "0x1",
              actual: receipt.status,
            },
            {
              label: "Authority storage reflects the delegated write",
              pass: storedNumber === 42n,
              expected: "42",
              actual: storedNumber.toString(),
            },
            {
              label: "address(this) resolves to the authority during delegated execution",
              pass: normalizeHex(contextAddress) === normalizeHex(authority.address),
              expected: normalizeHex(authority.address),
              actual: normalizeHex(contextAddress),
            },
          ],
          details: {
            transactionHash,
            authority: authority.address,
            delegateAddress: context.delegationTarget,
            storedNumber: storedNumber.toString(),
            contextAddress,
          },
        };
      },
    },
    {
      id: "execution.delegation_persists_after_revert",
      title: "Keeps delegation even when outer execution reverts",
      category: "execution",
      description:
        "Delegates an authority and immediately calls a reverting function through the delegated code path to confirm the code write survives a failed execution.",
      async run(context) {
        const authority = context.authorities[5];
        const { transactionHash, receipt } = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: authority.address,
          functionSignature: "revertAlways()",
        });
        const code = await context.rpc.getCode(authority.address);
        const authorityNonce = await context.rpc.getTransactionCount(authority.address);

        return {
          assertions: [
            {
              label: "Outer execution reverts",
              pass: receipt.status === "0x0",
              expected: "0x0",
              actual: receipt.status,
            },
            {
              label: "Delegation indicator still persists",
              pass: normalizeHex(code) === delegationIndicator(context.delegationTarget),
              expected: delegationIndicator(context.delegationTarget),
              actual: normalizeHex(code),
            },
            {
              label: "Authority nonce still increments for the valid authorization",
              pass: authorityNonce === 1n,
              expected: "1",
              actual: authorityNonce.toString(),
            },
          ],
          details: {
            transactionHash,
            authority: authority.address,
            code,
          },
        };
      },
    },
    {
      id: "execution.codesize_vs_extcodesize",
      title: "Shows delegated execution code lens differences",
      category: "execution",
      description:
        "Delegates an authority to the fixture contract and verifies that delegated execution sees the target runtime code size while external inspection sees the short delegation indicator.",
      async run(context) {
        const authority = context.authorities[6];
        const setup = await sendType7702Transaction({
          context,
          authority,
          delegateAddress: context.delegationTarget,
          destination: context.sponsor.address,
        });
        const callData = await encodeCalldata(context.rootDir, "codeSizeLens(address)", [
          authority.address,
        ]);
        const [runtimeCodeSize, authorityExtCodeSize] = decodeUint256Pair(
          await context.rpc.call(authority.address, callData),
        );
        const code = await context.rpc.getCode(authority.address);

        return {
          assertions: [
            {
              label: "Setup delegation transaction succeeds",
              pass: setup.receipt.status === "0x1",
              expected: "0x1",
              actual: setup.receipt.status,
            },
            {
              label: "Delegated execution sees the fixture runtime size",
              pass: runtimeCodeSize === BigInt(context.delegationTargetRuntimeSize),
              expected: String(context.delegationTargetRuntimeSize),
              actual: runtimeCodeSize.toString(),
            },
            {
              label: "External code size of the authority matches the 23-byte delegation indicator",
              pass: authorityExtCodeSize === 23n,
              expected: "23",
              actual: authorityExtCodeSize.toString(),
            },
            {
              label: "Authority code stores the fixture delegation indicator",
              pass: normalizeHex(code) === delegationIndicator(context.delegationTarget),
              expected: delegationIndicator(context.delegationTarget),
              actual: normalizeHex(code),
            },
          ],
          details: {
            setupTransactionHash: setup.transactionHash,
            authority: authority.address,
            runtimeCodeSize: runtimeCodeSize.toString(),
            authorityExtCodeSize: authorityExtCodeSize.toString(),
            code,
          },
        };
      },
    },
  ];
}

function buildNotes(target: TargetMetadata): string[] {
  const notes = [
    "This run uses real raw transaction signing plus JSON-RPC submission rather than mocked transport behavior.",
    "The fixture contract is deployed fresh per target so each run has isolated execution evidence.",
    "The report format is designed to extend toward wallet adapters, relayers, and multi-provider CI publishing.",
  ];

  if (target.kind === "managed-anvil") {
    notes.unshift(
      "Managed local Anvil targets are pinned to an explicit hardfork so support is deterministic instead of relying on tooling defaults.",
    );
  }

  if (target.sourcePath) {
    notes.push(`Target config source: ${target.sourcePath}`);
  }

  return notes;
}

async function writeSingleTargetReport(
  outputDir: string,
  report: RunReport,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, "report.json");
  const markdownPath = path.join(outputDir, "report.md");

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdownReport(report), "utf8");

  return { jsonPath, markdownPath };
}

async function writeMatrixReport(
  outputDir: string,
  report: MatrixReport,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, "index.json");
  const markdownPath = path.join(outputDir, "index.md");

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMatrixMarkdownReport(report), "utf8");

  return { jsonPath, markdownPath };
}

export async function runTargetSuite(
  rootDir: string,
  config: TargetConfig,
  outputDir: string,
): Promise<SingleTargetRunArtifacts> {
  const builtFixture = await getBuiltFixtureArtifact(rootDir);
  const environment = await prepareTargetEnvironment(rootDir, config, builtFixture);

  try {
    const tests: TestResult[] = [];
    for (const definition of buildTestPlan()) {
      tests.push(await executeTest(definition, environment.context));
    }

    const report: RunReport = {
      suite: SUITE_NAME,
      version: SUITE_VERSION,
      generatedAt: new Date().toISOString(),
      target: environment.target,
      fixtures: environment.fixtures,
      summary: summarizeTests(tests),
      notes: buildNotes(environment.target),
      tests,
    };

    const { jsonPath, markdownPath } = await writeSingleTargetReport(outputDir, report);

    return {
      report,
      outputDir,
      jsonPath,
      markdownPath,
    };
  } finally {
    await environment.cleanup();
  }
}

export async function runTargetMatrix(
  rootDir: string,
  configs: TargetConfig[],
  outputDir: string,
): Promise<MatrixRunArtifacts> {
  const builtFixture = await getBuiltFixtureArtifact(rootDir);
  const targetResults: MatrixTargetResult[] = [];

  for (const config of configs) {
    const targetOutputDir = path.join(outputDir, config.id);

    try {
      const environment = await prepareTargetEnvironment(rootDir, config, builtFixture);

      try {
        const tests: TestResult[] = [];
        for (const definition of buildTestPlan()) {
          tests.push(await executeTest(definition, environment.context));
        }

        const report: RunReport = {
          suite: SUITE_NAME,
          version: SUITE_VERSION,
          generatedAt: new Date().toISOString(),
          target: environment.target,
          fixtures: environment.fixtures,
          summary: summarizeTests(tests),
          notes: buildNotes(environment.target),
          tests,
        };

        const { jsonPath, markdownPath } = await writeSingleTargetReport(targetOutputDir, report);

        targetResults.push({
          id: config.id,
          label: config.label,
          kind: config.kind,
          status: report.summary.failed === 0 ? "pass" : "fail",
          targetSummary: report.summary,
          reportJsonPath: path.relative(outputDir, jsonPath),
          reportMarkdownPath: path.relative(outputDir, markdownPath),
        });
      } finally {
        await environment.cleanup();
      }
    } catch (error) {
      targetResults.push({
        id: config.id,
        label: config.label,
        kind: config.kind,
        status: "fail",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report: MatrixReport = {
    suite: SUITE_NAME,
    version: SUITE_VERSION,
    generatedAt: new Date().toISOString(),
    summary: {
      totalTargets: targetResults.length,
      passingTargets: targetResults.filter((target) => target.status === "pass").length,
      failingTargets: targetResults.filter((target) => target.status === "fail").length,
    },
    notes: [
      "Matrix mode compiles the fixture once and then executes the same test plan against each target sequentially.",
      "Targets that fail during setup or transport initialization are captured in the matrix index without aborting the remaining runs.",
    ],
    targets: targetResults,
  };

  const { jsonPath, markdownPath } = await writeMatrixReport(outputDir, report);

  return {
    report,
    outputDir,
    jsonPath,
    markdownPath,
  };
}

export async function runPrototype(rootDir: string): Promise<SingleTargetRunArtifacts> {
  const defaultConfig: ManagedAnvilTargetConfig = {
    id: "local-managed",
    label: "Managed local Anvil (Prague)",
    kind: "managed-anvil",
    chainId: 31337,
    hardfork: "prague",
    sponsorIndex: 0,
    authorityStartIndex: 1,
    authorityCount: REQUIRED_AUTHORITY_COUNT,
  };

  return await runTargetSuite(rootDir, defaultConfig, path.join(rootDir, "reports", "latest"));
}
