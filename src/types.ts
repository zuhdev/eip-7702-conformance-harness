export type TestCategory = "transaction" | "rpc" | "authorization" | "execution";
export type TestStatus = "pass" | "fail" | "skip";
export type TargetKind = "managed-anvil" | "rpc";

export interface Account {
  address: string;
  privateKey: string;
}

export interface AssertionResult {
  label: string;
  pass: boolean;
  expected?: string;
  actual?: string;
  note?: string;
}

export interface TestResult {
  id: string;
  title: string;
  category: TestCategory;
  description: string;
  status: TestStatus;
  durationMs: number;
  assertions: AssertionResult[];
  details: Record<string, unknown>;
  error?: string;
}

export interface ManagedAnvilTargetConfig {
  id: string;
  label: string;
  kind: "managed-anvil";
  chainId: number;
  hardfork: string;
  sponsorIndex: number;
  authorityStartIndex: number;
  authorityCount: number;
  sourcePath?: string;
}

export interface RpcTargetConfig {
  id: string;
  label: string;
  kind: "rpc";
  rpcUrl: string;
  chainId: number;
  hardfork?: string;
  sponsor: Account;
  authorities: Account[];
  sourcePath?: string;
}

export type TargetConfig = ManagedAnvilTargetConfig | RpcTargetConfig;

export interface TargetMetadata {
  id: string;
  label: string;
  kind: TargetKind;
  rpcUrl: string;
  chainId: number;
  hardfork: string | null;
  sourcePath?: string;
}

export interface FixtureMetadata {
  delegationTarget: {
    address: string;
    artifactPath: string;
    runtimeBytecodeSize: number;
  };
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface RunReport {
  suite: string;
  version: string;
  generatedAt: string;
  target: TargetMetadata;
  fixtures: FixtureMetadata;
  summary: ReportSummary;
  notes: string[];
  tests: TestResult[];
}

export interface MatrixTargetResult {
  id: string;
  label: string;
  kind: TargetKind;
  status: "pass" | "fail";
  targetSummary?: ReportSummary;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
  error?: string;
}

export interface MatrixReport {
  suite: string;
  version: string;
  generatedAt: string;
  summary: {
    totalTargets: number;
    passingTargets: number;
    failingTargets: number;
  };
  notes: string[];
  targets: MatrixTargetResult[];
}

export interface TransactionReceipt {
  type?: string;
  status?: string;
  transactionHash: string;
  contractAddress: string | null;
  gasUsed?: string;
  effectiveGasPrice?: string;
  blockNumber?: string;
  from?: string;
  to?: string | null;
}

export interface AuthorizationListEntry {
  chainId: string;
  address: string;
  nonce: string;
  yParity: string;
  r: string;
  s: string;
}

export interface RpcTransactionRequest {
  from?: string;
  to?: string;
  data?: string;
  gas?: string;
  value?: string;
  authorizationList?: AuthorizationListEntry[];
}

export interface SuiteContext {
  rootDir: string;
  target: TargetMetadata;
  rpc: RpcClientLike;
  sponsor: Account;
  authorities: Account[];
  delegationTarget: string;
  delegationTargetRuntimeSize: number;
}

export interface RpcClientLike {
  getTransactionCount(address: string): Promise<bigint>;
  getCode(address: string): Promise<string>;
  getReceipt(hash: string): Promise<TransactionReceipt | null>;
  waitForReceipt(hash: string): Promise<TransactionReceipt>;
  sendRawTransaction(rawTransaction: string): Promise<string>;
  estimateGas(transaction: RpcTransactionRequest): Promise<bigint>;
  callTransaction(transaction: RpcTransactionRequest, blockTag?: string): Promise<string>;
  call(to: string, data: string): Promise<string>;
}
