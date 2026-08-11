// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IYNXStableERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IYNXStableFactoryView {
    function protocolFeeRecipient() external view returns (address);
}

/// @notice Clean-room two-asset StableSwap pool. Assets are normalized to 18
/// decimals and amplification is immutable. LP entry is proportional so an
/// imbalanced deposit cannot dilute incumbent LPs without going through swaps.
contract YNXStablePool {
    string public constant name = "YNX Stable LP";
    string public constant symbol = "YNX-SLP";
    string public constant poolKind = "ynx-stableswap-v1";
    uint8 public constant decimals = 18;
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    uint256 public constant MAX_NORMALIZED_BALANCE = 1e36;
    uint16 public constant MAX_DEPOSIT_IMBALANCE_BPS = 10;

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint256 public immutable precisionMultiplier0;
    uint256 public immutable precisionMultiplier1;
    uint64 public immutable amplification;
    uint16 public immutable baseSwapFeeBps;
    uint16 public immutable protocolFeeShareBps;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    uint256 public protocolFees0;
    uint256 public protocolFees1;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 private unlocked = 1;

    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Mint(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);
    event Sync(uint112 reserve0, uint112 reserve1);
    event ProtocolFeesClaimed(address indexed recipient, uint256 amount0, uint256 amount1);

    error Reentrancy();
    error InvalidConfiguration();
    error InvalidToken();
    error InvalidRecipient();
    error DeadlineExpired();
    error InsufficientInput();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error ImbalancedDeposit();
    error Overflow();
    error TransferFailed();
    error InvariantViolation();
    error Unauthorized();

    modifier lock() {
        if (unlocked != 1) revert Reentrancy();
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(
        address tokenA,
        address tokenB,
        uint256 multiplierA,
        uint256 multiplierB,
        uint64 amplification_,
        uint16 feeBps,
        uint16 protocolShareBps
    ) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA >= tokenB) revert InvalidToken();
        if (
            multiplierA == 0 || multiplierB == 0 || amplification_ < 10 || amplification_ > 10_000
                || feeBps == 0 || feeBps > 100 || protocolShareBps > 5_000
        ) revert InvalidConfiguration();
        factory = msg.sender;
        token0 = tokenA;
        token1 = tokenB;
        precisionMultiplier0 = multiplierA;
        precisionMultiplier1 = multiplierB;
        amplification = amplification_;
        baseSwapFeeBps = feeBps;
        protocolFeeShareBps = protocolShareBps;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) allowance[from][msg.sender] = permitted - amount;
        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 deadline) external lock returns (uint256 liquidity) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (to == address(0) || to == address(this)) revert InvalidRecipient();
        (uint256 balance0, uint256 balance1) = _availableBalances();
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();
        _validateBalances(balance0, balance1);
        if (totalSupply == 0) {
            uint256 invariant = _invariant(balance0 * precisionMultiplier0, balance1 * precisionMultiplier1);
            if (invariant <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            liquidity = invariant - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            uint256 expected1 = amount0 * reserve1 / reserve0;
            uint256 difference = expected1 > amount1 ? expected1 - amount1 : amount1 - expected1;
            if (difference * 10_000 > expected1 * MAX_DEPOSIT_IMBALANCE_BPS) revert ImbalancedDeposit();
            liquidity = _min(amount0 * totalSupply / reserve0, amount1 * totalSupply / reserve1);
        }
        if (liquidity == 0) revert InsufficientLiquidity();
        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1, to);
    }

    function burn(address to, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
        external lock returns (uint256 amount0, uint256 amount1)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (to == address(0) || to == token0 || to == token1) revert InvalidRecipient();
        uint256 liquidity = balanceOf[address(this)];
        (uint256 balance0, uint256 balance1) = _availableBalances();
        amount0 = liquidity * balance0 / totalSupply;
        amount1 = liquidity * balance1 / totalSupply;
        if (amount0 == 0 || amount1 == 0 || amount0 < amount0Min || amount1 < amount1Min) {
            revert InsufficientOutput();
        }
        _burn(address(this), liquidity);
        _safeTransfer(token0, to, amount0);
        _safeTransfer(token1, to, amount1);
        (balance0, balance1) = _availableBalances();
        _update(balance0, balance1);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function executeSwap(address tokenIn, uint256 minAmountOut, address to, uint256 deadline)
        external lock returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (to == address(0) || to == token0 || to == token1) revert InvalidRecipient();
        bool zeroForOne = _direction(tokenIn);
        (uint256 balance0, uint256 balance1) = _availableBalances();
        uint256 amountIn = zeroForOne ? balance0 - reserve0 : balance1 - reserve1;
        if (amountIn == 0) revert InsufficientInput();
        uint256 invariantBefore = _invariant(
            uint256(reserve0) * precisionMultiplier0, uint256(reserve1) * precisionMultiplier1
        );
        amountOut = _amountOut(amountIn, zeroForOne);
        if (amountOut == 0 || amountOut < minAmountOut) revert InsufficientOutput();

        uint256 totalFee = amountIn * baseSwapFeeBps / 10_000;
        uint256 protocolFee = totalFee * protocolFeeShareBps / 10_000;
        if (zeroForOne) protocolFees0 += protocolFee;
        else protocolFees1 += protocolFee;
        _safeTransfer(zeroForOne ? token1 : token0, to, amountOut);

        (balance0, balance1) = _availableBalances();
        _validateBalances(balance0, balance1);
        if (_invariant(balance0 * precisionMultiplier0, balance1 * precisionMultiplier1) < invariantBefore) {
            revert InvariantViolation();
        }
        _update(balance0, balance1);
        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to);
    }

    function getAmountOutFor(address tokenIn, uint256 amountIn) public view returns (uint256) {
        return _amountOut(amountIn, _direction(tokenIn));
    }

    function getAmountInFor(address tokenIn, uint256 amountOut) public view returns (uint256 amountIn) {
        bool zeroForOne = _direction(tokenIn);
        uint256 outputReserve = zeroForOne ? reserve1 : reserve0;
        uint256 outputMultiplier = zeroForOne ? precisionMultiplier1 : precisionMultiplier0;
        uint256 inputReserve = zeroForOne ? reserve0 : reserve1;
        uint256 inputMultiplier = zeroForOne ? precisionMultiplier0 : precisionMultiplier1;
        if (amountOut == 0 || amountOut >= outputReserve) revert InsufficientLiquidity();
        uint256 x = inputReserve * inputMultiplier;
        uint256 yAfter = (outputReserve - amountOut) * outputMultiplier;
        uint256 invariant = _invariant(
            uint256(reserve0) * precisionMultiplier0, uint256(reserve1) * precisionMultiplier1
        );
        uint256 xAfter = _getY(yAfter, invariant);
        if (xAfter <= x) revert InsufficientLiquidity();
        uint256 effectiveRaw = _ceilDiv(xAfter - x, inputMultiplier);
        amountIn = _ceilDiv(effectiveRaw * 10_000, 10_000 - baseSwapFeeBps);
        while (_amountOut(amountIn, zeroForOne) < amountOut) ++amountIn;
        while (amountIn > 1 && _amountOut(amountIn - 1, zeroForOne) >= amountOut) --amountIn;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external view returns (uint256) {
        bool forward = reserveIn == reserve0 && reserveOut == reserve1;
        bool reverse = reserveIn == reserve1 && reserveOut == reserve0;
        if (forward == reverse) revert InvalidConfiguration();
        return _amountOut(amountIn, forward);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) external view returns (uint256) {
        bool forward = reserveIn == reserve0 && reserveOut == reserve1;
        bool reverse = reserveIn == reserve1 && reserveOut == reserve0;
        if (forward == reverse) revert InvalidConfiguration();
        return getAmountInFor(forward ? token0 : token1, amountOut);
    }

    function swapFeeBps() external view returns (uint16) { return baseSwapFeeBps; }

    function currentInvariant() external view returns (uint256) {
        return _invariant(uint256(reserve0) * precisionMultiplier0, uint256(reserve1) * precisionMultiplier1);
    }

    function claimProtocolFees() external lock returns (uint256 amount0, uint256 amount1) {
        address recipient = IYNXStableFactoryView(factory).protocolFeeRecipient();
        if (msg.sender != recipient || recipient == address(0)) revert Unauthorized();
        amount0 = protocolFees0;
        amount1 = protocolFees1;
        protocolFees0 = 0;
        protocolFees1 = 0;
        if (amount0 != 0) _safeTransfer(token0, recipient, amount0);
        if (amount1 != 0) _safeTransfer(token1, recipient, amount1);
        emit ProtocolFeesClaimed(recipient, amount0, amount1);
    }

    function sync() external lock {
        (uint256 balance0, uint256 balance1) = _availableBalances();
        if (balance0 < reserve0 || balance1 < reserve1) revert InvariantViolation();
        _validateBalances(balance0, balance1);
        _update(balance0, balance1);
    }

    function currentCumulativePrices()
        external view returns (uint256 cumulative0, uint256 cumulative1, uint32 timestamp)
    {
        cumulative0 = price0CumulativeLast;
        cumulative1 = price1CumulativeLast;
        timestamp = uint32(block.timestamp);
        uint32 elapsed;
        unchecked { elapsed = timestamp - blockTimestampLast; }
        if (elapsed != 0 && reserve0 != 0 && reserve1 != 0) {
            cumulative0 += (uint256(reserve1) << 112) / reserve0 * elapsed;
            cumulative1 += (uint256(reserve0) << 112) / reserve1 * elapsed;
        }
    }

    function _amountOut(uint256 amountIn, bool zeroForOne) private view returns (uint256 amountOut) {
        if (amountIn == 0 || reserve0 == 0 || reserve1 == 0) revert InsufficientLiquidity();
        uint256 x = (zeroForOne ? reserve0 : reserve1) * (zeroForOne ? precisionMultiplier0 : precisionMultiplier1);
        uint256 y = (zeroForOne ? reserve1 : reserve0) * (zeroForOne ? precisionMultiplier1 : precisionMultiplier0);
        uint256 inputAfterFee = amountIn * (10_000 - baseSwapFeeBps) / 10_000;
        uint256 inputMultiplier = zeroForOne ? precisionMultiplier0 : precisionMultiplier1;
        uint256 outputMultiplier = zeroForOne ? precisionMultiplier1 : precisionMultiplier0;
        uint256 invariant = _invariant(
            uint256(reserve0) * precisionMultiplier0, uint256(reserve1) * precisionMultiplier1
        );
        uint256 yAfter = _getY(x + inputAfterFee * inputMultiplier, invariant);
        if (yAfter >= y) revert InsufficientLiquidity();
        amountOut = (y - yAfter - 1) / outputMultiplier;
        if (amountOut >= (zeroForOne ? reserve1 : reserve0)) revert InsufficientLiquidity();
    }

    function _invariant(uint256 x, uint256 y) private view returns (uint256 invariant) {
        uint256 sum = x + y;
        if (sum == 0) return 0;
        invariant = sum;
        uint256 ann = uint256(amplification) * 2;
        for (uint256 i; i < 255; ++i) {
            uint256 previous = invariant;
            uint256 dProduct = invariant * invariant / (x * 2);
            dProduct = dProduct * invariant / (y * 2);
            invariant = (ann * sum + dProduct * 2) * invariant / ((ann - 1) * invariant + dProduct * 3);
            if (_difference(invariant, previous) <= 1) return invariant;
        }
        revert InvariantViolation();
    }

    /// @dev For a two-asset invariant, returns the unknown balance when the
    /// other normalized balance and D are known.
    function _getY(uint256 knownBalance, uint256 invariant) private view returns (uint256 y) {
        uint256 ann = uint256(amplification) * 2;
        uint256 c = invariant * invariant / (knownBalance * 2);
        c = c * invariant / (ann * 2);
        uint256 b = knownBalance + invariant / ann;
        y = invariant;
        for (uint256 i; i < 255; ++i) {
            uint256 previous = y;
            y = (y * y + c) / (2 * y + b - invariant);
            if (_difference(y, previous) <= 1) return y;
        }
        revert InvariantViolation();
    }

    function _validateBalances(uint256 balance0, uint256 balance1) private view {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();
        if (
            balance0 * precisionMultiplier0 > MAX_NORMALIZED_BALANCE
                || balance1 * precisionMultiplier1 > MAX_NORMALIZED_BALANCE
        ) revert Overflow();
    }

    function _availableBalances() private view returns (uint256 balance0, uint256 balance1) {
        balance0 = IYNXStableERC20(token0).balanceOf(address(this)) - protocolFees0;
        balance1 = IYNXStableERC20(token1).balanceOf(address(this)) - protocolFees1;
    }

    function _update(uint256 balance0, uint256 balance1) private {
        _validateBalances(balance0, balance1);
        uint32 timestamp = uint32(block.timestamp);
        uint32 elapsed;
        unchecked { elapsed = timestamp - blockTimestampLast; }
        if (elapsed != 0 && reserve0 != 0 && reserve1 != 0) {
            price0CumulativeLast += (uint256(reserve1) << 112) / reserve0 * elapsed;
            price1CumulativeLast += (uint256(reserve0) << 112) / reserve1 * elapsed;
        }
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = timestamp;
        emit Sync(reserve0, reserve1);
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IYNXStableERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _direction(address tokenIn) private view returns (bool) {
        if (tokenIn == token0) return true;
        if (tokenIn == token1) return false;
        revert InvalidToken();
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidRecipient();
        balanceOf[from] -= amount;
        unchecked { balanceOf[to] += amount; }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) private {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) private {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) { return a == 0 ? 0 : (a - 1) / b + 1; }
    function _difference(uint256 a, uint256 b) private pure returns (uint256) { return a >= b ? a - b : b - a; }
    function _min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }
}
