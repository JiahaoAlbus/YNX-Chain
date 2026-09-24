// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Local negative-test double, never part of the deployment catalog.
contract MockFalseToken {
    bytes32 public constant TEST_MARKER = bytes32("YNX-6423-TEST-ONLY");
    uint8 public constant decimals = 6;
    function balanceOf(address) external pure returns (uint256) { return 1_000_000_000; }
    function transferFrom(address, address, uint256) external pure returns (bool) { return false; }
}
