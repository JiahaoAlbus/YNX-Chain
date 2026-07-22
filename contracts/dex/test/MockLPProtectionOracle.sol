// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockLPProtectionOracle {
    struct Observation {
        uint256 priceX96;
        uint16 volatilityBps;
        uint16 depegBps;
        uint64 updatedAt;
        bytes32 sourceHash;
    }

    mapping(bytes32 => Observation) private observations;

    function setObservation(
        address token0,
        address token1,
        uint256 priceX96,
        uint16 volatilityBps,
        uint16 depegBps,
        uint64 updatedAt,
        bytes32 sourceHash
    ) external {
        observations[keccak256(abi.encode(token0, token1))] =
            Observation(priceX96, volatilityBps, depegBps, updatedAt, sourceHash);
    }

    function latestPairObservation(address token0, address token1)
        external view
        returns (uint256 priceX96, uint16 volatilityBps, uint16 depegBps, uint64 updatedAt, bytes32 sourceHash)
    {
        Observation memory observation = observations[keccak256(abi.encode(token0, token1))];
        return (
            observation.priceX96,
            observation.volatilityBps,
            observation.depegBps,
            observation.updatedAt,
            observation.sourceHash
        );
    }
}
