// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract YNXWalletCallTarget {
    error ForcedFailure();

    uint256 public count;

    function increment(uint256 amount) external {
        count += amount;
    }

    function fail() external pure {
        revert ForcedFailure();
    }
}
