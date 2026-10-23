// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SampleEVMWriteCounter {
    uint256 public count;

    event CountChanged(address indexed caller, uint256 value);

    constructor(uint256 initialCount) {
        count = initialCount;
    }

    function increment(uint256 by) external returns (uint256) {
        count += by;
        emit CountChanged(msg.sender, count);
        return count;
    }
}
