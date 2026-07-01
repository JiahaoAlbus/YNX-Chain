// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract LotLineageRegistry {
    event LotRecorded(bytes32 indexed lotId, address indexed account, uint256 amount, uint16 riskWeightBps, string origin);
    function recordLot(bytes32 lotId, address account, uint256 amount, uint16 riskWeightBps, string calldata origin) external {
        require(account != address(0), "account required");
        require(riskWeightBps <= 10000, "risk out of range");
        emit LotRecorded(lotId, account, amount, riskWeightBps, origin);
    }
}
