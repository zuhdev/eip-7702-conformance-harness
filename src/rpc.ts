import { setTimeout as delay } from "node:timers/promises";
import type { RpcTransactionRequest, TransactionReceipt } from "./types.js";

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

export class RpcRequestError extends Error {
  readonly code: number;
  readonly data?: unknown;
  readonly method: string;

  constructor(method: string, code: number, message: string, data?: unknown) {
    super(`${method} failed [${code}]: ${message}`);
    this.name = "RpcRequestError";
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

export class RpcClient {
  constructor(private readonly rpcUrl: string) {}

  async request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed with HTTP ${response.status} for method ${method}.`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if ("error" in payload) {
      throw new RpcRequestError(
        method,
        payload.error.code,
        payload.error.message,
        payload.error.data,
      );
    }

    return payload.result;
  }

  async sendRawTransaction(rawTransaction: string): Promise<string> {
    return await this.request<string>("eth_sendRawTransaction", [rawTransaction]);
  }

  async getTransactionCount(address: string): Promise<bigint> {
    const result = await this.request<string>("eth_getTransactionCount", [address, "latest"]);
    return BigInt(result);
  }

  async getCode(address: string): Promise<string> {
    return await this.request<string>("eth_getCode", [address, "latest"]);
  }

  async getReceipt(hash: string): Promise<TransactionReceipt | null> {
    return await this.request<TransactionReceipt | null>("eth_getTransactionReceipt", [hash]);
  }

  async waitForReceipt(hash: string, timeoutMs = 10_000): Promise<TransactionReceipt> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const receipt = await this.getReceipt(hash);
      if (receipt) {
        return receipt;
      }

      await delay(100);
    }

    throw new Error(`Timed out waiting for receipt: ${hash}`);
  }

  async estimateGas(transaction: RpcTransactionRequest): Promise<bigint> {
    const result = await this.request<string>("eth_estimateGas", [transaction]);
    return BigInt(result);
  }

  async callTransaction(
    transaction: RpcTransactionRequest,
    blockTag = "latest",
  ): Promise<string> {
    return await this.request<string>("eth_call", [transaction, blockTag]);
  }

  async call(to: string, data: string): Promise<string> {
    return await this.callTransaction({ to, data }, "latest");
  }
}
