// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Explicitly non-production, controller-written Testnet observation
/// adapter shared by the DEX protection and Strategy Vault read interfaces.
contract YNXTestnetOracle {
    struct Price { uint256 valuePerToken; uint64 updatedAt; uint16 deviationBps; bytes32 sourceHash; }
    struct Pair { uint256 priceX96; uint16 volatilityBps; uint16 depegBps; uint64 updatedAt; bytes32 sourceHash; }

    bool public constant mainnet = false;
    bool public constant externallySourced = false;
    address public immutable controller;
    mapping(address => Price) public prices;
    mapping(bytes32 => Pair) private pairs;

    event PriceUpdated(address indexed token, uint256 valuePerToken, uint64 updatedAt, uint16 deviationBps, bytes32 sourceHash);
    event PairUpdated(address indexed token0, address indexed token1, uint256 priceX96, uint16 volatilityBps, uint16 depegBps, uint64 updatedAt, bytes32 sourceHash);
    error Unauthorized();
    error InvalidObservation();

    constructor() { controller = msg.sender; }

    function setPrice(address token, uint256 valuePerToken, uint64 updatedAt, uint16 deviationBps, bytes32 sourceHash) external {
        if (msg.sender != controller) revert Unauthorized();
        if (token == address(0) || valuePerToken == 0 || updatedAt == 0 || updatedAt > block.timestamp || sourceHash == bytes32(0)) revert InvalidObservation();
        prices[token] = Price(valuePerToken, updatedAt, deviationBps, sourceHash);
        emit PriceUpdated(token, valuePerToken, updatedAt, deviationBps, sourceHash);
    }

    function setPair(address token0, address token1, uint256 priceX96, uint16 volatilityBps, uint16 depegBps, uint64 updatedAt, bytes32 sourceHash) external {
        if (msg.sender != controller) revert Unauthorized();
        if (token0 == address(0) || token1 == address(0) || token0 >= token1 || priceX96 == 0 || updatedAt == 0 || updatedAt > block.timestamp || sourceHash == bytes32(0)) revert InvalidObservation();
        pairs[keccak256(abi.encode(token0, token1))] = Pair(priceX96, volatilityBps, depegBps, updatedAt, sourceHash);
        emit PairUpdated(token0, token1, priceX96, volatilityBps, depegBps, updatedAt, sourceHash);
    }

    function valueOf(address token, uint256 amount) external view returns (uint256 value, uint64 updatedAt, uint16 deviationBps) {
        Price memory price = prices[token];
        return (amount * price.valuePerToken / 1e18, price.updatedAt, price.deviationBps);
    }

    function latestPairObservation(address token0, address token1) external view returns (uint256 priceX96, uint16 volatilityBps, uint16 depegBps, uint64 updatedAt, bytes32 sourceHash) {
        Pair memory pair = pairs[keccak256(abi.encode(token0, token1))];
        return (pair.priceX96, pair.volatilityBps, pair.depegBps, pair.updatedAt, pair.sourceHash);
    }
}
