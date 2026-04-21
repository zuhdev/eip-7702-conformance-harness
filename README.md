# EIP-7702 Compatibility Test Suite

A neutral, open-source compatibility harness for [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702). It answers one question for wallet, client, and provider teams:

> **What works, where, and under what conditions?**

The suite drives real type-`0x04` transactions, signed authorization tuples, and delegated execution against a target (local Anvil today, any JSON-RPC endpoint next). Each run produces a machine-readable JSON report and a human-readable Markdown report with evidence pulled directly from the wire.

- **No mocks.** Transactions are signed with `cast`, broadcast over JSON-RPC, and read back through receipts and `eth_call`.
- **Spec-aware.** Tests are tied to specific EIP-7702 behaviors — not generic RPC smoke tests.
- **Reproducible.** Fixture contracts, managed nodes, and test vectors are deterministic by default.
- **Reportable.** Every run emits a compatibility matrix and per-assertion evidence so a reviewer can inspect what the tool observed without running it.

See [`reports/sample/report.md`](reports/sample/report.md) for a committed sample run.

## Status

The prototype runs end-to-end today against a managed local Anvil pinned to the Prague hardfork and produces 13 passing tests across four spec-aligned categories.

| Category | Tests | What it measures |
| --- | --- | --- |
| Transaction | 1 | Acceptance of type-`0x04` transactions end-to-end |
| RPC | 3 | Provider-side simulation (`eth_estimateGas`, `eth_call`) and revert-metadata fidelity |
| Authorization | 6 | EIP-7702 tuple rules — chain ID, nonce, zero-address clearing, chain-agnostic `chain_id = 0`, delegation overwrite, contract-target indicator |
| Execution | 3 | Delegated storage, delegation persistence across reverts, `codesize` vs `extcodesize` divergence |

The same test plan is the foundation for the RPC-target mode, which accepts a sponsor and a set of authority keypairs and runs the suite against any EIP-7702-capable endpoint.

## What each test proves

### Transaction
- **`transaction.accepts_type_0x04`** — submits a real type-`0x04` transaction, inspects the receipt type, and verifies the delegation indicator was written.

### RPC
- **`rpc.estimates_gas_with_authorization_list`** — `eth_estimateGas` with an `authorizationList` payload returns a positive estimate above the 21k baseline.
- **`rpc.eth_call_simulates_delegated_context`** — `eth_call` with an `authorizationList` resolves `address(this)` to the authority, matching post-merge delegated execution semantics.
- **`rpc.eth_call_surfaces_revert_metadata`** — reverts from delegated `eth_call` come back as a structured RPC error with the `Error(string)` selector intact.

### Authorization
- **`authorization.skips_invalid_chain_id`** — authorizations signed for a different chain ID are ignored; the outer tx still mines with no side effects on the authority.
- **`authorization.skips_invalid_nonce`** — authorizations with a non-matching nonce are ignored the same way.
- **`authorization.accepts_chain_id_zero_for_any_chain`** — `chain_id = 0` is accepted on the target chain, demonstrating the chain-agnostic path from the spec.
- **`authorization.overwrites_existing_delegation`** — delegating a second time overwrites the prior indicator; the authority nonce increments twice.
- **`authorization.clears_with_zero_address`** — authorizing to `0x0…0` clears the delegation indicator.
- **`authorization.writes_contract_delegate_indicator`** — delegation to a deployed contract writes the expected 23-byte `0xef0100…` indicator.

### Execution
- **`execution.delegated_storage_write`** — writing through the delegated entrypoint mutates storage in the authority's account context.
- **`execution.delegation_persists_after_revert`** — the indicator survives even when the outer execution reverts.
- **`execution.codesize_vs_extcodesize`** — internally the fixture's `CODESIZE` equals its runtime bytecode, while external `EXTCODESIZE` only sees the 23-byte indicator.

## Architecture

```
                +-----------------+
                |   targets/*.json |
                +--------+--------+
                         |
                         v
                +-----------------+
                |      config     |  normalizes managed-anvil vs rpc targets
                +--------+--------+
                         |
                         v
+----------------+  +-----------------+  +----------------+
|   foundry.ts   |  |    suite.ts     |  |     rpc.ts     |
|  cast / forge  |<-+  test plan +   +->+  JSON-RPC client|
|  wrappers      |  |  orchestration  |  |                |
+--------+-------+  +--------+--------+  +----------------+
         |                   |
         |                   v
         |          +-----------------+
         +--------->+    report.ts    +----> reports/*/report.json
                    |  JSON + MD gen  +----> reports/*/report.md
                    +-----------------+
```

- **`src/suite.ts`** — every test is a `TestDefinition` with a category, description, and `run(context)` returning assertions plus evidence. Adding a new test is a single entry in the test plan.
- **`src/foundry.ts`** — thin wrappers around `cast wallet sign-auth`, `cast mktx`, `cast calldata`, and `forge build`. No signing logic lives in TypeScript — the cryptography is delegated to foundry.
- **`src/rpc.ts`** — minimal JSON-RPC client with structured error surfacing so revert metadata stays actionable in reports.
- **`src/report.ts`** — JSON and Markdown renderers. Both are deterministic given the same run data.
- **`src/config.ts`** — target config loader for `managed-anvil` and `rpc` kinds, with schema-style validation.
- **`contracts/DelegationTarget.sol`** — fixture contract deployed once per target, exposing storage writes, `address(this)` inspection, code-size comparison, and a reverting function.

## Requirements

- Node.js 20+
- Foundry (`anvil`, `cast`, `forge`) on `PATH`
- `solc` on `PATH`

## Run it

Install dependencies once:

```bash
npm install
```

Default managed-Anvil run:

```bash
npm run prototype
```

Single configured target:

```bash
npm run prototype -- --config targets/local-managed.json
```

Matrix run across every non-example config in `targets/`:

```bash
npm run prototype:matrix
```

List configured targets:

```bash
npm run prototype:list
```

Each run writes:

- `reports/latest/report.json` — machine-readable run report
- `reports/latest/report.md` — human-readable run report
- `reports/matrix/latest/index.{json,md}` — cross-target summary when multiple targets run

## Target configs

Two target kinds are supported today:

**`managed-anvil`** — starts its own Anvil node at a reserved port, pinned to a specific hardfork, with deterministic dev accounts. Ideal for CI and reviewer reproduction.

```json
{
  "id": "local-managed",
  "label": "Managed local Anvil (Prague)",
  "kind": "managed-anvil",
  "chainId": 31337,
  "hardfork": "prague",
  "sponsorIndex": 0,
  "authorityStartIndex": 1,
  "authorityCount": 7
}
```

**`rpc`** — points at an existing endpoint with caller-supplied sponsor and authority keypairs. Authorities do not need funding; only the sponsor pays for gas.

See [`targets/rpc.example.json`](targets/rpc.example.json) for the full schema.

## Roadmap

The current prototype covers the transport, authorization, and execution layers against a provider-first target. The natural expansion path:

1. **Wallet adapters.** Adapter-level tests that exercise a wallet's real signing and UX flow for type-`0x04`, instead of just the provider.
2. **Relayer / sponsor flows.** Self-sponsored transactions (authority == sender), third-party relayer paths, and nonce-boundary tests.
3. **Security and misuse tests.** Initialization front-running, storage-layout footguns, `tx.origin` misuse, replay boundaries, and over-trusted delegate code patterns identified in the EIP security considerations.
4. **Batched authorization coverage.** Multiple authorizations in a single type-`0x04` transaction (pending a native RLP builder or updated `cast mktx` with multi-`--auth` support).
5. **Capability discovery.** Target-level metadata (`eth_feeHistory`, `debug_traceCall`, supported authorization-list fields) so the matrix report can explain *why* a target partially supports a feature.
6. **Public matrices.** CI-published compatibility matrices across real ecosystem endpoints, with history so regressions are visible.

## License

TBD.
