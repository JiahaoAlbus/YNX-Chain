// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Clean-room accounting core for the first YNX concentrated-liquidity
/// slice. It records bounded range liquidity and fee-growth attribution at one
/// immutable current tick. It intentionally performs no swaps, token transfers,
/// callbacks, price movement, Oracle work or custody.
contract YNXConcentratedLiquidityBook {
    string public constant poolKind = "ynx-concentrated-liquidity-book-v1";
    uint256 public constant Q128 = 1 << 128;
    int24 public constant MIN_TICK = -887_272;
    int24 public constant MAX_TICK = 887_272;
    uint24 public constant MAX_FEE_PIPS = 10_000;
    uint128 public constant MAX_LIQUIDITY_DELTA = uint128(type(int128).max);
    bool public constant supportsSwaps = false;
    bool public constant supportsCallbacks = false;
    bool public constant custodiesTokens = false;

    struct TickInfo {
        uint128 liquidityGross;
        int128 liquidityNet;
        uint256 feeGrowthOutside0X128;
        uint256 feeGrowthOutside1X128;
        bool initialized;
    }

    struct Position {
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint256 tokensOwed0;
        uint256 tokensOwed1;
    }

    address public immutable controller;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable feePips;
    int24 public immutable tickSpacing;
    int24 public immutable currentTick;

    uint128 public activeLiquidity;
    uint256 public feeGrowthGlobal0X128;
    uint256 public feeGrowthGlobal1X128;
    uint256 public totalRecordedFees0;
    uint256 public totalRecordedFees1;
    uint256 public totalCollectedAccounting0;
    uint256 public totalCollectedAccounting1;
    uint256 public globalRoundingDust0;
    uint256 public globalRoundingDust1;

    mapping(int24 => TickInfo) private tickData;
    mapping(bytes32 => Position) private positions;

    event PositionModified(
        address indexed owner,
        int24 indexed tickLower,
        int24 indexed tickUpper,
        int128 liquidityDelta,
        uint128 positionLiquidity,
        uint128 activeLiquidity
    );
    event FeesRecorded(
        address indexed recorder,
        uint128 amount0,
        uint128 amount1,
        uint256 feeGrowthDelta0X128,
        uint256 feeGrowthDelta1X128,
        uint256 roundingDust0,
        uint256 roundingDust1
    );
    event AccountingCollected(
        address indexed owner,
        int24 indexed tickLower,
        int24 indexed tickUpper,
        uint256 amount0,
        uint256 amount1
    );

    error Unauthorized();
    error InvalidToken();
    error InvalidFeeTier();
    error InvalidTickSpacing();
    error InvalidTick();
    error InvalidRange();
    error InvalidLiquidity();
    error InsufficientLiquidity();
    error NoActiveLiquidity();
    error FeeLimitExceeded();
    error Overflow();

    constructor(address tokenA, address tokenB, uint24 feePips_, int24 tickSpacing_, int24 initialTick) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA >= tokenB) revert InvalidToken();
        if (feePips_ == 0 || feePips_ > MAX_FEE_PIPS) revert InvalidFeeTier();
        if (tickSpacing_ <= 0 || !_isAligned(initialTick, tickSpacing_)) revert InvalidTickSpacing();
        if (initialTick < MIN_TICK || initialTick > MAX_TICK) revert InvalidTick();
        controller = msg.sender;
        token0 = tokenA;
        token1 = tokenB;
        feePips = feePips_;
        tickSpacing = tickSpacing_;
        currentTick = initialTick;
    }

    function positionKey(address owner, int24 tickLower, int24 tickUpper) public pure returns (bytes32) {
        return keccak256(abi.encode(owner, tickLower, tickUpper));
    }

    function tickInfo(int24 tick)
        external
        view
        returns (
            uint128 liquidityGross,
            int128 liquidityNet,
            uint256 feeGrowthOutside0X128,
            uint256 feeGrowthOutside1X128,
            bool initialized
        )
    {
        TickInfo storage info = tickData[tick];
        return (
            info.liquidityGross,
            info.liquidityNet,
            info.feeGrowthOutside0X128,
            info.feeGrowthOutside1X128,
            info.initialized
        );
    }

    function getPosition(address owner, int24 tickLower, int24 tickUpper)
        external
        view
        returns (
            uint128 liquidity,
            uint256 storedOwed0,
            uint256 storedOwed1,
            uint256 pending0,
            uint256 pending1,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128
        )
    {
        Position storage position = positions[positionKey(owner, tickLower, tickUpper)];
        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) = _feeGrowthInside(tickLower, tickUpper);
        pending0 = _feeAmount(feeGrowthInside0X128 - position.feeGrowthInside0LastX128, position.liquidity);
        pending1 = _feeAmount(feeGrowthInside1X128 - position.feeGrowthInside1LastX128, position.liquidity);
        return (
            position.liquidity,
            position.tokensOwed0,
            position.tokensOwed1,
            pending0,
            pending1,
            position.feeGrowthInside0LastX128,
            position.feeGrowthInside1LastX128
        );
    }

    function feeGrowthInside(int24 tickLower, int24 tickUpper)
        external
        view
        returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)
    {
        _validateRange(tickLower, tickUpper);
        return _feeGrowthInside(tickLower, tickUpper);
    }

    function mintPosition(int24 tickLower, int24 tickUpper, uint128 liquidityDelta) external {
        if (liquidityDelta == 0 || liquidityDelta > MAX_LIQUIDITY_DELTA) revert InvalidLiquidity();
        _validateRange(tickLower, tickUpper);
        bytes32 key = positionKey(msg.sender, tickLower, tickUpper);
        Position storage position = positions[key];

        if (position.liquidity == 0) {
            _initializeTick(tickLower);
            _initializeTick(tickUpper);
            (position.feeGrowthInside0LastX128, position.feeGrowthInside1LastX128) =
                _feeGrowthInside(tickLower, tickUpper);
        } else {
            _accrue(position, tickLower, tickUpper);
        }

        uint256 nextPositionLiquidity = uint256(position.liquidity) + liquidityDelta;
        if (nextPositionLiquidity > type(uint128).max) revert Overflow();
        position.liquidity = uint128(nextPositionLiquidity);
        _updateTick(tickLower, liquidityDelta, true, true);
        _updateTick(tickUpper, liquidityDelta, false, true);
        if (_isActive(tickLower, tickUpper)) {
            uint256 nextActive = uint256(activeLiquidity) + liquidityDelta;
            if (nextActive > type(uint128).max) revert Overflow();
            activeLiquidity = uint128(nextActive);
        }
        emit PositionModified(
            msg.sender,
            tickLower,
            tickUpper,
            int128(liquidityDelta),
            position.liquidity,
            activeLiquidity
        );
    }

    function burnPosition(int24 tickLower, int24 tickUpper, uint128 liquidityDelta) external {
        if (liquidityDelta == 0 || liquidityDelta > MAX_LIQUIDITY_DELTA) revert InvalidLiquidity();
        _validateRange(tickLower, tickUpper);
        Position storage position = positions[positionKey(msg.sender, tickLower, tickUpper)];
        if (position.liquidity < liquidityDelta) revert InsufficientLiquidity();
        _accrue(position, tickLower, tickUpper);
        position.liquidity -= liquidityDelta;
        _updateTick(tickLower, liquidityDelta, true, false);
        _updateTick(tickUpper, liquidityDelta, false, false);
        if (_isActive(tickLower, tickUpper)) activeLiquidity -= liquidityDelta;
        emit PositionModified(
            msg.sender,
            tickLower,
            tickUpper,
            -int128(liquidityDelta),
            position.liquidity,
            activeLiquidity
        );
    }

    /// @notice Records externally settled fee amounts for currently active
    /// liquidity. No token transfer occurs. Only the immutable controller may
    /// call this accounting hook.
    function recordFees(uint128 amount0, uint128 amount1) external {
        if (msg.sender != controller) revert Unauthorized();
        if (activeLiquidity == 0) revert NoActiveLiquidity();
        if (amount0 == 0 && amount1 == 0) revert InvalidLiquidity();
        if (totalRecordedFees0 + amount0 > type(uint128).max || totalRecordedFees1 + amount1 > type(uint128).max) {
            revert FeeLimitExceeded();
        }

        uint256 growthDelta0X128 = uint256(amount0) * Q128 / activeLiquidity;
        uint256 growthDelta1X128 = uint256(amount1) * Q128 / activeLiquidity;
        uint256 distributed0 = _feeAmount(growthDelta0X128, activeLiquidity);
        uint256 distributed1 = _feeAmount(growthDelta1X128, activeLiquidity);
        uint256 dust0 = uint256(amount0) - distributed0;
        uint256 dust1 = uint256(amount1) - distributed1;

        feeGrowthGlobal0X128 += growthDelta0X128;
        feeGrowthGlobal1X128 += growthDelta1X128;
        totalRecordedFees0 += amount0;
        totalRecordedFees1 += amount1;
        globalRoundingDust0 += dust0;
        globalRoundingDust1 += dust1;
        emit FeesRecorded(msg.sender, amount0, amount1, growthDelta0X128, growthDelta1X128, dust0, dust1);
    }

    /// @notice Realizes and clears accounting units owed to the caller. This
    /// first slice does not transfer assets and must not be treated as a swap or
    /// withdrawal receipt.
    function collectAccounting(int24 tickLower, int24 tickUpper) external returns (uint256 amount0, uint256 amount1) {
        _validateRange(tickLower, tickUpper);
        Position storage position = positions[positionKey(msg.sender, tickLower, tickUpper)];
        _accrue(position, tickLower, tickUpper);
        amount0 = position.tokensOwed0;
        amount1 = position.tokensOwed1;
        position.tokensOwed0 = 0;
        position.tokensOwed1 = 0;
        totalCollectedAccounting0 += amount0;
        totalCollectedAccounting1 += amount1;
        emit AccountingCollected(msg.sender, tickLower, tickUpper, amount0, amount1);
    }

    function _initializeTick(int24 tick) private {
        TickInfo storage info = tickData[tick];
        if (info.initialized) return;
        info.initialized = true;
        if (tick <= currentTick) {
            info.feeGrowthOutside0X128 = feeGrowthGlobal0X128;
            info.feeGrowthOutside1X128 = feeGrowthGlobal1X128;
        }
    }

    function _updateTick(int24 tick, uint128 liquidityDelta, bool lower, bool add) private {
        TickInfo storage info = tickData[tick];
        int128 signedDelta = int128(liquidityDelta);
        if (add) {
            uint256 nextGross = uint256(info.liquidityGross) + liquidityDelta;
            if (nextGross > type(uint128).max) revert Overflow();
            info.liquidityGross = uint128(nextGross);
            info.liquidityNet += lower ? signedDelta : -signedDelta;
        } else {
            if (info.liquidityGross < liquidityDelta) revert InsufficientLiquidity();
            info.liquidityGross -= liquidityDelta;
            info.liquidityNet += lower ? -signedDelta : signedDelta;
            if (info.liquidityGross == 0) delete tickData[tick];
        }
    }

    function _accrue(Position storage position, int24 tickLower, int24 tickUpper) private {
        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) = _feeGrowthInside(tickLower, tickUpper);
        if (position.liquidity != 0) {
            position.tokensOwed0 +=
                _feeAmount(feeGrowthInside0X128 - position.feeGrowthInside0LastX128, position.liquidity);
            position.tokensOwed1 +=
                _feeAmount(feeGrowthInside1X128 - position.feeGrowthInside1LastX128, position.liquidity);
        }
        position.feeGrowthInside0LastX128 = feeGrowthInside0X128;
        position.feeGrowthInside1LastX128 = feeGrowthInside1X128;
    }

    function _feeGrowthInside(int24 tickLower, int24 tickUpper)
        private
        view
        returns (uint256 inside0X128, uint256 inside1X128)
    {
        // This bounded slice has an immutable current tick and no tick crossing.
        // Therefore every active range sees global growth and every inactive
        // range sees zero. Position snapshots prevent historical-fee capture.
        // Tick outside snapshots are retained for a later reviewed crossing
        // slice but must not be interpreted before crossing exists.
        if (_isActive(tickLower, tickUpper)) {
            return (feeGrowthGlobal0X128, feeGrowthGlobal1X128);
        }
        return (0, 0);
    }

    function _feeAmount(uint256 feeGrowthDeltaX128, uint128 liquidity_) private pure returns (uint256) {
        if (feeGrowthDeltaX128 == 0 || liquidity_ == 0) return 0;
        uint256 whole = feeGrowthDeltaX128 >> 128;
        uint256 fraction = feeGrowthDeltaX128 & (Q128 - 1);
        return whole * liquidity_ + fraction * liquidity_ / Q128;
    }

    function _validateRange(int24 tickLower, int24 tickUpper) private view {
        if (tickLower < MIN_TICK || tickUpper > MAX_TICK || tickLower >= tickUpper) revert InvalidRange();
        if (!_isAligned(tickLower, tickSpacing) || !_isAligned(tickUpper, tickSpacing)) revert InvalidRange();
    }

    function _isActive(int24 tickLower, int24 tickUpper) private view returns (bool) {
        return tickLower <= currentTick && currentTick < tickUpper;
    }

    function _isAligned(int24 tick, int24 spacing) private pure returns (bool) {
        return tick % spacing == 0;
    }
}
