# EIP-7702 Compatibility Matrix

- **Suite:** eip-7702-compatibility-test-suite v0.2.0
- **Generated:** 2026-04-21T10:12:40.089Z

## Summary

| Targets | Passing | Failing |
| --- | --- | --- |
| 1 | 1 | 0 |

## Targets

| Target | Kind | Result | Passed | Failed | Report |
| --- | --- | --- | --- | --- | --- |
| local-managed | managed-anvil | PASS | 13 | 0 | [markdown](local-managed/report.md) |

## Notes

- Matrix mode compiles the fixture once and then executes the same test plan against each target sequentially.
- Targets that fail during setup or transport initialization are captured in the matrix index without aborting the remaining runs.
