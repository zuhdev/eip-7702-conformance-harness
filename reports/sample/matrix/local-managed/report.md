# EIP-7702 Compatibility Report

- **Suite:** eip-7702-compatibility-test-suite v0.2.0
- **Generated:** 2026-04-21T10:12:40.083Z

## Target

| Field | Value |
| --- | --- |
| Label | Managed local Anvil (Prague) |
| Kind | managed-anvil |
| Chain ID | 31337 |
| Hardfork | prague |
| RPC URL | `http://127.0.0.1:50959` |
| Fixture address | `0x5fbdb2315678afecb367f032d93f642f64180aa3` |
| Fixture runtime size | 449 bytes |
| Config source | `/Users/vicgunga/EIP-7702 Compatibility Test Suite/targets/local-managed.json` |

## Summary

| Total | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| 13 | 13 | 0 | 0 |

## Coverage by category

| Category | Passed | Failed | Total |
| --- | --- | --- | --- |
| Transaction | 1 | 0 | 1 |
| RPC | 3 | 0 | 3 |
| Authorization | 6 | 0 | 6 |
| Execution | 3 | 0 | 3 |

## Results

| Category | Test | Result | Duration |
| --- | --- | --- | --- |
| Transaction | `transaction.accepts_type_0x04` | PASS | 38ms |
| RPC | `rpc.estimates_gas_with_authorization_list` | PASS | 42ms |
| RPC | `rpc.eth_call_simulates_delegated_context` | PASS | 37ms |
| RPC | `rpc.eth_call_surfaces_revert_metadata` | PASS | 37ms |
| Authorization | `authorization.skips_invalid_chain_id` | PASS | 32ms |
| Authorization | `authorization.skips_invalid_nonce` | PASS | 31ms |
| Authorization | `authorization.accepts_chain_id_zero_for_any_chain` | PASS | 44ms |
| Authorization | `authorization.overwrites_existing_delegation` | PASS | 72ms |
| Authorization | `authorization.clears_with_zero_address` | PASS | 58ms |
| Authorization | `authorization.writes_contract_delegate_indicator` | PASS | 29ms |
| Execution | `execution.delegated_storage_write` | PASS | 48ms |
| Execution | `execution.delegation_persists_after_revert` | PASS | 31ms |
| Execution | `execution.codesize_vs_extcodesize` | PASS | 40ms |

## Detailed results

### Transaction

#### `transaction.accepts_type_0x04`

**Status:** PASS · **Category:** Transaction · **Duration:** 38ms

Submits a real type-0x04 transaction with a valid authorization and checks receipt typing plus delegation side effects.

**Assertions**

- [x] Receipt reports type 0x4
  - expected: `0x4`
  - actual: `0x4`
- [x] Transaction succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Delegation indicator was written
  - expected: `0xef01000000000000000000000000000000000000000001`
  - actual: `0xef01000000000000000000000000000000000000000001`
- [x] Authority nonce increments to 1
  - expected: `1`
  - actual: `1`

**Evidence**

- transactionHash: `0x2132464393e1c265a92f12bf5e9f2f905f77d787d37628f8136636a35fc4fbdf`
- authority: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- delegateAddress: `0x0000000000000000000000000000000000000001`
- receiptType: `0x4`
- code: `0xef01000000000000000000000000000000000000000001`

### RPC

#### `rpc.estimates_gas_with_authorization_list`

**Status:** PASS · **Category:** RPC · **Duration:** 42ms

Uses eth_estimateGas with an authorizationList payload and delegated calldata to verify that provider-side simulation works before broadcast.

**Assertions**

- [x] Provider returns a positive gas estimate
  - expected: `> 0`
  - actual: `70730`
- [x] Estimate exceeds a plain 21k transfer
  - expected: `> 21000`
  - actual: `70730`

**Evidence**

- authority: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- delegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- signedAuthorization: `0xf85c827a69945fbdb2315678afecb367f032d93f642f64180aa38001a025624a5a59ba3fd4a8b93d874183eb46eca7a9329a47081954554b3c3fa1e490a06675890c92133c78f8d8bec7781c278758aa19e02084cd44e08b6434d1409dc6`
- authorizationListEntry:
  chainId: 0x7a69
  address: 0x5fbdb2315678afecb367f032d93f642f64180aa3
  nonce: 0x0
  yParity: 0x01
  r: 0x25624a5a59ba3fd4a8b93d874183eb46eca7a9329a47081954554b3c3fa1e490
  s: 0x6675890c92133c78f8d8bec7781c278758aa19e02084cd44e08b6434d1409dc6
- calldata: `0x3fb5c1cb000000000000000000000000000000000000000000000000000000000000002a`
- estimate: `70730`
- estimateHex: `0x1144a`

#### `rpc.eth_call_simulates_delegated_context`

**Status:** PASS · **Category:** RPC · **Duration:** 37ms

Uses eth_call with an authorizationList payload against a clean authority and checks that delegated execution resolves address(this) to the authority.

**Assertions**

- [x] Delegated eth_call returns the authority as address(this)
  - expected: `0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc`
  - actual: `0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc`

**Evidence**

- authority: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- delegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- signedAuthorization: `0xf85c827a69945fbdb2315678afecb367f032d93f642f64180aa38001a025624a5a59ba3fd4a8b93d874183eb46eca7a9329a47081954554b3c3fa1e490a06675890c92133c78f8d8bec7781c278758aa19e02084cd44e08b6434d1409dc6`
- authorizationListEntry:
  chainId: 0x7a69
  address: 0x5fbdb2315678afecb367f032d93f642f64180aa3
  nonce: 0x0
  yParity: 0x01
  r: 0x25624a5a59ba3fd4a8b93d874183eb46eca7a9329a47081954554b3c3fa1e490
  s: 0x6675890c92133c78f8d8bec7781c278758aa19e02084cd44e08b6434d1409dc6
- calldata: `0x4a5a8a3b`
- rawResult: `0x0000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc`
- resolvedContext: `0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc`

#### `rpc.eth_call_surfaces_revert_metadata`

**Status:** PASS · **Category:** RPC · **Duration:** 37ms

Uses eth_call with an authorizationList payload against a reverting delegated function and verifies that provider error metadata remains actionable.

**Assertions**

- [x] Provider returns a structured RPC error
  - expected: `RpcRequestError`
  - actual: `RpcRequestError`
- [x] Error message preserves the revert reason
  - expected: `message contains EXPECTED_REVERT`
  - actual: `eth_call failed [3]: execution reverted: EXPECTED_REVERT`
- [x] Error data preserves ABI-encoded revert payload
  - expected: `0x08c379a0...`
  - actual: `0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000f45585045435445445f5245564552540000000000000000000000000000000000`

**Evidence**

- authority: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- delegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- signedAuthorization: `0xf85c827a69945fbdb2315678afecb367f032d93f642f64180aa38001a025624a5a59ba3fd4a8b93d874183eb46eca7a9329a47081954554b3c3fa1e490a06675890c92133c78f8d8bec7781c278758aa19e02084cd44e08b6434d1409dc6`
- authorizationListEntry:
  chainId: 0x7a69
  address: 0x5fbdb2315678afecb367f032d93f642f64180aa3
  nonce: 0x0
  yParity: 0x01
  r: 0x25624a5a59ba3fd4a8b93d874183eb46eca7a9329a47081954554b3c3fa1e490
  s: 0x6675890c92133c78f8d8bec7781c278758aa19e02084cd44e08b6434d1409dc6
- calldata: `0x975af67a`
- errorCode: `3`
- errorMessage: `eth_call failed [3]: execution reverted: EXPECTED_REVERT`
- errorData: `0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000f45585045435445445f5245564552540000000000000000000000000000000000`

### Authorization

#### `authorization.skips_invalid_chain_id`

**Status:** PASS · **Category:** Authorization · **Duration:** 32ms

Signs an authorization for a mismatched chain ID and verifies the transaction still mines while the authority remains unchanged.

**Assertions**

- [x] Transaction still succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Authority code remains empty
  - expected: `0x`
  - actual: `0x`
- [x] Authority nonce does not change
  - expected: `0`
  - actual: `0`

**Evidence**

- transactionHash: `0xa68cabd226908278027db06107ef6e2349581b87c369c98c01bda141865ae350`
- authority: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- attemptedDelegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- code: `0x`

#### `authorization.skips_invalid_nonce`

**Status:** PASS · **Category:** Authorization · **Duration:** 31ms

Signs an authorization with a nonce that does not match the authority's current nonce and verifies the outer transaction still mines while the authority remains unchanged.

**Assertions**

- [x] Transaction still succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Authority code remains empty
  - expected: `0x`
  - actual: `0x`
- [x] Authority nonce does not change
  - expected: `0`
  - actual: `0`

**Evidence**

- transactionHash: `0x3e239268691342b7fa611f7f07373ce323713e6ba1bb8d735594c0e6e2e613ae`
- authority: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- attemptedDelegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- attemptedNonce: `99`
- code: `0x`

#### `authorization.accepts_chain_id_zero_for_any_chain`

**Status:** PASS · **Category:** Authorization · **Duration:** 44ms

Signs an authorization with chain_id=0 (chain-agnostic per EIP-7702) and verifies it is accepted on the target chain with the expected delegation side effects.

**Assertions**

- [x] Transaction succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Delegation indicator is written despite chain_id=0
  - expected: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
  - actual: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
- [x] Authority nonce increments for the replay-safe authorization
  - expected: `1`
  - actual: `1`

**Evidence**

- transactionHash: `0xb62dcd0a22ba94c91ab1d6c645aa98c924b5f8e815da09c2802fa5223b3c79d4`
- authority: `0x01F6Befc35EFF7F6ba47340EEc2e95a452737bea`
- delegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- authorization: `0xf85a80945fbdb2315678afecb367f032d93f642f64180aa38080a00d2a4a4e8342db88d8ad606dcb39fe8a089a9cb5d39bf8cc4a0bf20ef67c6dd9a01cd3206655cd68f113893f18c513f05fc68da6265421719784f88f4e3311477e`
- code: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`

#### `authorization.overwrites_existing_delegation`

**Status:** PASS · **Category:** Authorization · **Duration:** 72ms

Delegates an authority to the fixture contract, then re-delegates the same authority to a different target and verifies the indicator swaps while the nonce increments twice.

**Assertions**

- [x] First delegation transaction succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] First indicator points at the fixture
  - expected: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
  - actual: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
- [x] Second delegation transaction succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Second indicator overwrites the first
  - expected: `0xef01000000000000000000000000000000000000000001`
  - actual: `0xef01000000000000000000000000000000000000000001`
- [x] Authority nonce increments twice
  - expected: `2`
  - actual: `2`

**Evidence**

- authority: `0x8B49B96b8dc2c0d7c84428DCBf1A502395AB0864`
- firstTransactionHash: `0xe15eccd24957c4f550f2c7962787f21518cfee79def3bc494f04ed9b560739dc`
- secondTransactionHash: `0xad544c382ebf82ca8790d4a6a847f7529b7e2c7be28efbb6035c27b782667340`
- firstDelegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- secondDelegateAddress: `0x0000000000000000000000000000000000000001`
- firstCode: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
- secondCode: `0xef01000000000000000000000000000000000000000001`

#### `authorization.clears_with_zero_address`

**Status:** PASS · **Category:** Authorization · **Duration:** 58ms

Applies a valid delegation first, then sends a second valid authorization to the zero address and verifies that the authority code is cleared.

**Assertions**

- [x] Initial delegation succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Clearing transaction succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Authority code is cleared
  - expected: `0x`
  - actual: `0x`
- [x] Authority nonce increments twice
  - expected: `2`
  - actual: `2`

**Evidence**

- initialTransactionHash: `0x6ba8ef2cac014e165f1cc0af6dd5918ad16cb28441e2ed7170bdff52fe929739`
- clearingTransactionHash: `0x16bce4d4e535f7d160a48d3d5df2c84bfca9c279e9d3e78268df01cef2ad7b10`
- authority: `0x90F79bf6EB2c4f870365E785982E1f101E93b906`
- code: `0x`

#### `authorization.writes_contract_delegate_indicator`

**Status:** PASS · **Category:** Authorization · **Duration:** 29ms

Applies a valid authorization that points to the deployed fixture contract and verifies that the indicator and nonce update match the expected contract delegation path.

**Assertions**

- [x] Contract-target authorization transaction succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Indicator points at the deployed fixture contract
  - expected: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
  - actual: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
- [x] Authority nonce increments once for the valid authorization
  - expected: `1`
  - actual: `1`

**Evidence**

- transactionHash: `0xf3cb48e1bb390a99b3eb41cb3c33b428b92978b34d85d9fc00d0d603a528c604`
- authority: `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65`
- delegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- code: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`

### Execution

#### `execution.delegated_storage_write`

**Status:** PASS · **Category:** Execution · **Duration:** 48ms

Delegates an authority to the fixture contract, writes storage through the delegated entrypoint, and reads it back from the authority address.

**Assertions**

- [x] Delegated storage write transaction succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Authority storage reflects the delegated write
  - expected: `42`
  - actual: `42`
- [x] address(this) resolves to the authority during delegated execution
  - expected: `0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc`
  - actual: `0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc`

**Evidence**

- transactionHash: `0xc760c16f45ffdf89dc4a5aa354f61ccd790869463f8d92902a4e92e3dd056a99`
- authority: `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc`
- delegateAddress: `0x5fbdb2315678afecb367f032d93f642f64180aa3`
- storedNumber: `42`
- contextAddress: `0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc`

#### `execution.delegation_persists_after_revert`

**Status:** PASS · **Category:** Execution · **Duration:** 31ms

Delegates an authority and immediately calls a reverting function through the delegated code path to confirm the code write survives a failed execution.

**Assertions**

- [x] Outer execution reverts
  - expected: `0x0`
  - actual: `0x0`
- [x] Delegation indicator still persists
  - expected: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
  - actual: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
- [x] Authority nonce still increments for the valid authorization
  - expected: `1`
  - actual: `1`

**Evidence**

- transactionHash: `0xbe8574a92ff94b07882261cb4607641b98ebda38ebf3f3ccc3d63e482b492e83`
- authority: `0x976EA74026E726554dB657fA54763abd0C3a0aa9`
- code: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`

#### `execution.codesize_vs_extcodesize`

**Status:** PASS · **Category:** Execution · **Duration:** 40ms

Delegates an authority to the fixture contract and verifies that delegated execution sees the target runtime code size while external inspection sees the short delegation indicator.

**Assertions**

- [x] Setup delegation transaction succeeds
  - expected: `0x1`
  - actual: `0x1`
- [x] Delegated execution sees the fixture runtime size
  - expected: `449`
  - actual: `449`
- [x] External code size of the authority matches the 23-byte delegation indicator
  - expected: `23`
  - actual: `23`
- [x] Authority code stores the fixture delegation indicator
  - expected: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`
  - actual: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`

**Evidence**

- setupTransactionHash: `0x9be504fbc2b5900233adff93c80b5576142008462ba0f8a859db81a8a58ea7fe`
- authority: `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955`
- runtimeCodeSize: `449`
- authorityExtCodeSize: `23`
- code: `0xef01005fbdb2315678afecb367f032d93f642f64180aa3`

## Notes

- Managed local Anvil targets are pinned to an explicit hardfork so support is deterministic instead of relying on tooling defaults.
- This run uses real raw transaction signing plus JSON-RPC submission rather than mocked transport behavior.
- The fixture contract is deployed fresh per target so each run has isolated execution evidence.
- The report format is designed to extend toward wallet adapters, relayers, and multi-provider CI publishing.
- Target config source: /Users/vicgunga/EIP-7702 Compatibility Test Suite/targets/local-managed.json
