// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockVaultOracle {
    struct Price { uint256 valuePerToken; uint64 updatedAt; uint16 deviationBps; }
    mapping(address => Price) public prices;

    function setPrice(address token, uint256 valuePerToken, uint64 updatedAt, uint16 deviationBps) external {
        prices[token] = Price(valuePerToken, updatedAt, deviationBps);
    }

    function valueOf(address token, uint256 amount) external view returns (uint256 value, uint64 updatedAt, uint16 deviationBps) {
        Price memory price = prices[token];
        return (amount * price.valuePerToken / 1e18, price.updatedAt, price.deviationBps);
    }
}
