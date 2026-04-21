// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DelegationTarget {
    uint256 public storedNumber;

    event NumberUpdated(
        address indexed context,
        uint256 value,
        address indexed caller,
        address indexed origin
    );

    function setNumber(uint256 newValue) external {
        storedNumber = newValue;
        emit NumberUpdated(address(this), newValue, msg.sender, tx.origin);
    }

    function contextAddress() external view returns (address) {
        return address(this);
    }

    function codeSizeLens(address authority)
        external
        view
        returns (uint256 runtimeCodeSize, uint256 authorityExtCodeSize)
    {
        assembly {
            runtimeCodeSize := codesize()
            authorityExtCodeSize := extcodesize(authority)
        }
    }

    function revertAlways() external pure {
        revert("EXPECTED_REVERT");
    }
}
