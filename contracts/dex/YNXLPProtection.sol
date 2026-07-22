// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IYNXLPProtectionFactory {
    function governance() external view returns (address);
}

interface IYNXLPProtectionOracle {
    /// @dev priceX96 is token1 per token0. sourceHash commits to the reviewed
    /// upstream feed/configuration; it is evidence identity, not a price proof.
    function latestPairObservation(address token0, address token1)
        external view
        returns (uint256 priceX96, uint16 volatilityBps, uint16 depegBps, uint64 updatedAt, bytes32 sourceHash);
}

/// @notice Pool-enforced, source-labelled LP protection for YNX Testnet.
/// It never holds assets or blocks proportional LP withdrawal. A pool calls
/// assessSwap atomically before execution, so a failed swap rolls flow state back.
contract YNXLPProtection {
    uint256 public constant GOVERNANCE_DELAY = 2 days;
    uint16 public constant BPS = 10_000;

    struct Config {
        uint16 baseFeeBps;
        uint16 maxFeeBps;
        uint16 volatilityMultiplierBps;
        uint16 depthMultiplierBps;
        uint16 divergenceMultiplierBps;
        uint16 toxicMultiplierBps;
        uint16 jitFeeBps;
        uint16 depegToleranceBps;
        uint16 guardBlocks;
        uint32 oracleMaxAge;
        uint32 flowWindow;
    }

    struct FeeQuote {
        uint16 totalFeeBps;
        uint16 baseFeeBps;
        uint16 volatilityFeeBps;
        uint16 depthFeeBps;
        uint16 divergenceFeeBps;
        uint16 toxicFlowFeeBps;
        uint16 jitFeeBps;
        uint16 depegBps;
        uint64 oracleAsOf;
        bytes32 oracleSourceHash;
    }

    struct PoolState {
        address token0;
        address token1;
        uint64 flowWindowStartedAt;
        uint16 token0FlowBps;
        uint16 token1FlowBps;
        bool registered;
    }

    struct PendingConfig {
        Config value;
        uint64 executableAt;
        bool exists;
    }

    struct Assessment {
        FeeQuote quote;
        uint16 nextFlow0;
        uint16 nextFlow1;
        uint64 windowStartedAt;
    }

    struct RiskMetrics {
        uint16 volatilityBps;
        uint16 depegBps;
        uint16 depthBps;
        uint16 divergenceBps;
        uint64 oracleAsOf;
        bytes32 oracleSourceHash;
    }

    address public immutable factory;
    address public immutable oracle;
    Config public defaultConfig;
    mapping(address => Config) public poolConfig;
    mapping(address => PoolState) public poolState;
    mapping(address => PendingConfig) public pendingConfig;

    event PoolRegistered(address indexed pool, address indexed token0, address indexed token1);
    event ProtectionConfigScheduled(address indexed pool, bytes32 indexed configHash, uint256 executableAt);
    event ProtectionConfigChanged(address indexed pool, bytes32 indexed configHash);
    event ProtectionAssessed(
        address indexed pool,
        address indexed tokenIn,
        uint256 amountIn,
        uint16 totalFeeBps,
        uint16 volatilityFeeBps,
        uint16 depthFeeBps,
        uint16 divergenceFeeBps,
        uint16 toxicFlowFeeBps,
        uint16 jitFeeBps,
        uint16 depegBps,
        uint256 oracleAsOf,
        bytes32 indexed oracleSourceHash
    );

    error Unauthorized();
    error InvalidAddress();
    error InvalidConfig();
    error PoolAlreadyRegistered();
    error PoolNotRegistered();
    error InvalidSwap();
    error InvalidOracleObservation();
    error StaleOracle();
    error DepegCircuitBreaker();
    error DelayNotElapsed();

    constructor(address factory_, address oracle_, Config memory defaults_) {
        if (factory_ == address(0) || oracle_ == address(0) || oracle_.code.length == 0) revert InvalidAddress();
        _validateConfig(defaults_);
        factory = factory_;
        oracle = oracle_;
        defaultConfig = defaults_;
    }

    function registerPool(address pool, address token0, address token1) external {
        if (msg.sender != factory) revert Unauthorized();
        if (pool == address(0) || pool.code.length == 0 || token0 == address(0) || token0 >= token1) revert InvalidAddress();
        if (poolState[pool].registered) revert PoolAlreadyRegistered();
        poolState[pool] = PoolState(token0, token1, 0, 0, 0, true);
        poolConfig[pool] = defaultConfig;
        emit PoolRegistered(pool, token0, token1);
        emit ProtectionConfigChanged(pool, keccak256(abi.encode(defaultConfig)));
    }

    function scheduleConfig(address pool, Config calldata next) external {
        if (msg.sender != IYNXLPProtectionFactory(factory).governance()) revert Unauthorized();
        if (!poolState[pool].registered) revert PoolNotRegistered();
        _validateConfig(next);
        uint64 executableAt = uint64(block.timestamp + GOVERNANCE_DELAY);
        pendingConfig[pool] = PendingConfig(next, executableAt, true);
        emit ProtectionConfigScheduled(pool, keccak256(abi.encode(next)), executableAt);
    }

    function executeConfig(address pool) external {
        PendingConfig memory pending = pendingConfig[pool];
        if (!pending.exists || block.timestamp < pending.executableAt) revert DelayNotElapsed();
        delete pendingConfig[pool];
        poolConfig[pool] = pending.value;
        emit ProtectionConfigChanged(pool, keccak256(abi.encode(pending.value)));
    }

    function feeBounds(address pool) external view returns (uint16 baseFeeBps, uint16 maxFeeBps) {
        if (!poolState[pool].registered) revert PoolNotRegistered();
        Config memory config = poolConfig[pool];
        return (config.baseFeeBps, config.maxFeeBps);
    }

    function previewFee(
        address pool,
        address tokenIn,
        uint256 amountIn,
        uint256 reserve0,
        uint256 reserve1,
        uint256 lastLiquidityChangeBlock
    ) external view returns (FeeQuote memory quote) {
        return _quote(pool, tokenIn, amountIn, reserve0, reserve1, lastLiquidityChangeBlock).quote;
    }

    function assessSwap(
        address tokenIn,
        uint256 amountIn,
        uint256 reserve0,
        uint256 reserve1,
        uint256 lastLiquidityChangeBlock
    ) external returns (FeeQuote memory quote) {
        Assessment memory assessment = _quote(msg.sender, tokenIn, amountIn, reserve0, reserve1, lastLiquidityChangeBlock);
        quote = assessment.quote;
        PoolState storage state = poolState[msg.sender];
        state.flowWindowStartedAt = assessment.windowStartedAt;
        state.token0FlowBps = assessment.nextFlow0;
        state.token1FlowBps = assessment.nextFlow1;
        _emitAssessment(msg.sender, tokenIn, amountIn, quote);
    }

    function _emitAssessment(address pool, address tokenIn, uint256 amountIn, FeeQuote memory quote) private {
        emit ProtectionAssessed(
            pool,
            tokenIn,
            amountIn,
            quote.totalFeeBps,
            quote.volatilityFeeBps,
            quote.depthFeeBps,
            quote.divergenceFeeBps,
            quote.toxicFlowFeeBps,
            quote.jitFeeBps,
            quote.depegBps,
            quote.oracleAsOf,
            quote.oracleSourceHash
        );
    }

    function _quote(
        address pool,
        address tokenIn,
        uint256 amountIn,
        uint256 reserve0,
        uint256 reserve1,
        uint256 lastLiquidityChangeBlock
    ) private view returns (Assessment memory assessment) {
        PoolState memory state = poolState[pool];
        if (!state.registered) revert PoolNotRegistered();
        if ((tokenIn != state.token0 && tokenIn != state.token1) || amountIn == 0 || reserve0 == 0 || reserve1 == 0) {
            revert InvalidSwap();
        }
        Config memory config = poolConfig[pool];
        RiskMetrics memory metrics = _riskMetrics(state, config, tokenIn, amountIn, reserve0, reserve1);

        if (state.flowWindowStartedAt == 0 || block.timestamp >= uint256(state.flowWindowStartedAt) + config.flowWindow) {
            assessment.windowStartedAt = uint64(block.timestamp);
        } else {
            assessment.windowStartedAt = state.flowWindowStartedAt;
            assessment.nextFlow0 = state.token0FlowBps;
            assessment.nextFlow1 = state.token1FlowBps;
        }
        if (tokenIn == state.token0) assessment.nextFlow0 = _cappedAdd(assessment.nextFlow0, metrics.depthBps);
        else assessment.nextFlow1 = _cappedAdd(assessment.nextFlow1, metrics.depthBps);
        uint256 toxicFlowBps = _difference(assessment.nextFlow0, assessment.nextFlow1);

        uint256 volatilityFee = uint256(metrics.volatilityBps) * config.volatilityMultiplierBps / BPS;
        uint256 depthFee = uint256(metrics.depthBps) * config.depthMultiplierBps / BPS;
        uint256 divergenceFee = uint256(metrics.divergenceBps) * config.divergenceMultiplierBps / BPS;
        uint256 toxicFee = toxicFlowBps * config.toxicMultiplierBps / BPS;
        uint256 jitFee = lastLiquidityChangeBlock != 0 && block.number <= lastLiquidityChangeBlock + config.guardBlocks
            ? config.jitFeeBps
            : 0;
        uint256 total = uint256(config.baseFeeBps) + volatilityFee + depthFee + divergenceFee + toxicFee + jitFee;
        if (total > config.maxFeeBps) total = config.maxFeeBps;
        assessment.quote = FeeQuote(
            uint16(total),
            config.baseFeeBps,
            uint16(volatilityFee),
            uint16(depthFee),
            uint16(divergenceFee),
            uint16(toxicFee),
            uint16(jitFee),
            metrics.depegBps,
            metrics.oracleAsOf,
            metrics.oracleSourceHash
        );
    }

    function _riskMetrics(
        PoolState memory state,
        Config memory config,
        address tokenIn,
        uint256 amountIn,
        uint256 reserve0,
        uint256 reserve1
    ) private view returns (RiskMetrics memory metrics) {
        uint256 oraclePriceX96;
        (oraclePriceX96, metrics.volatilityBps, metrics.depegBps, metrics.oracleAsOf, metrics.oracleSourceHash) =
            IYNXLPProtectionOracle(oracle).latestPairObservation(state.token0, state.token1);
        if (
            oraclePriceX96 == 0 || metrics.volatilityBps > BPS || metrics.depegBps > BPS
                || metrics.oracleSourceHash == bytes32(0) || metrics.oracleAsOf > block.timestamp
        ) revert InvalidOracleObservation();
        if (block.timestamp - metrics.oracleAsOf > config.oracleMaxAge) revert StaleOracle();
        if (metrics.depegBps > config.depegToleranceBps) revert DepegCircuitBreaker();
        uint256 divergence = _difference((reserve1 << 96) / reserve0, oraclePriceX96) * BPS / oraclePriceX96;
        metrics.divergenceBps = uint16(divergence > BPS ? BPS : divergence);
        uint256 reserveIn = tokenIn == state.token0 ? reserve0 : reserve1;
        uint256 depth = amountIn * BPS / reserveIn;
        metrics.depthBps = uint16(depth > BPS ? BPS : depth);
    }

    function _validateConfig(Config memory config) private pure {
        if (
            config.baseFeeBps > 100 || config.maxFeeBps < config.baseFeeBps || config.maxFeeBps > 2_000
                || config.volatilityMultiplierBps > 20_000 || config.depthMultiplierBps > 20_000
                || config.divergenceMultiplierBps > 20_000 || config.toxicMultiplierBps > 20_000
                || config.jitFeeBps > config.maxFeeBps || config.depegToleranceBps > BPS || config.guardBlocks > 20
                || config.oracleMaxAge < 30 || config.oracleMaxAge > 1 days || config.flowWindow < 10
                || config.flowWindow > 1 hours
        ) revert InvalidConfig();
    }

    function _cappedAdd(uint16 current, uint256 addition) private pure returns (uint16) {
        uint256 total = uint256(current) + addition;
        return total > BPS ? BPS : uint16(total);
    }

    function _difference(uint256 a, uint256 b) private pure returns (uint256) {
        return a >= b ? a - b : b - a;
    }
}
