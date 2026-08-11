// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {YNXLPProtection} from "./YNXLPProtection.sol";

interface IYNXDexERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IYNXDexFactoryView {
    function protocolFeeRecipient() external view returns (address);
}

/// @notice Immutable constant-product pool for YNX Testnet. The factory cannot
/// seize reserves, confiscate LP shares, or change a pool's swap fee.
contract YNXDexPool {
    string public constant name = "YNX DEX LP";
    string public constant symbol = "YNX-LP";
    uint8 public constant decimals = 18;
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    address public immutable lpProtection;
    uint16 public immutable baseSwapFeeBps;
    uint16 public immutable protocolFeeShareBps;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    uint256 public protocolFees0;
    uint256 public protocolFees1;
    uint256 public lastLiquidityChangeBlock;

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
    error InvalidToken();
    error InvalidRecipient();
    error DeadlineExpired();
    error InsufficientInput();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error Overflow();
    error TransferFailed();
    error InvariantViolation();
    error Unauthorized();
    error ProtectedQuoteRequiresToken();

    modifier lock() {
        if (unlocked != 1) revert Reentrancy();
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(address tokenA, address tokenB, uint16 feeBps, uint16 protocolShareBps, address protection) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA >= tokenB) revert InvalidToken();
        if (feeBps > 100 || protocolShareBps > 5_000 || (protection != address(0) && protection.code.length == 0)) {
            revert InvalidToken();
        }
        factory = msg.sender;
        token0 = tokenA;
        token1 = tokenB;
        lpProtection = protection;
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
        if (permitted != type(uint256).max) {
            allowance[from][msg.sender] = permitted - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Mints LP shares from token balances already transferred to the pool.
    function mint(address to, uint256 deadline) external lock returns (uint256 liquidity) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (to == address(0) || to == address(this)) revert InvalidRecipient();
        (uint256 balance0, uint256 balance1) = _availableBalances();
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;
        if (totalSupply == 0) {
            uint256 root = _sqrt(amount0 * amount1);
            if (root <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            liquidity = root - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            liquidity = _min(amount0 * totalSupply / reserve0, amount1 * totalSupply / reserve1);
        }
        if (liquidity == 0) revert InsufficientLiquidity();
        _mint(to, liquidity);
        _update(balance0, balance1);
        lastLiquidityChangeBlock = block.number;
        emit Mint(msg.sender, amount0, amount1, to);
    }

    /// @notice Burns LP shares transferred to this pool before the call.
    function burn(address to, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
        external lock returns (uint256 amount0, uint256 amount1)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (to == address(0) || to == token0 || to == token1) revert InvalidRecipient();
        uint256 liquidity = balanceOf[address(this)];
        (uint256 balance0, uint256 balance1) = _availableBalances();
        amount0 = liquidity * balance0 / totalSupply;
        amount1 = liquidity * balance1 / totalSupply;
        if (amount0 < amount0Min || amount1 < amount1Min || amount0 == 0 || amount1 == 0) {
            revert InsufficientOutput();
        }
        _burn(address(this), liquidity);
        _safeTransfer(token0, to, amount0);
        _safeTransfer(token1, to, amount1);
        (balance0, balance1) = _availableBalances();
        _update(balance0, balance1);
        lastLiquidityChangeBlock = block.number;
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice Executes against input already transferred to this pool. Routers
    /// may chain pools by sending output directly to the next pool.
    function executeSwap(address tokenIn, uint256 minAmountOut, address to, uint256 deadline)
        external lock returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (to == address(0) || to == token0 || to == token1) revert InvalidRecipient();
        bool zeroForOne;
        if (tokenIn == token0) zeroForOne = true;
        else if (tokenIn == token1) zeroForOne = false;
        else revert InvalidToken();

        (uint256 balance0, uint256 balance1) = _availableBalances();
        uint256 amountIn = zeroForOne ? balance0 - reserve0 : balance1 - reserve1;
        if (amountIn == 0) revert InsufficientInput();
        uint16 feeBps = baseSwapFeeBps;
        if (lpProtection != address(0)) {
            feeBps = YNXLPProtection(lpProtection).assessSwap(
                tokenIn, amountIn, reserve0, reserve1, lastLiquidityChangeBlock
            ).totalFeeBps;
        }
        amountOut = _amountOut(amountIn, zeroForOne ? reserve0 : reserve1, zeroForOne ? reserve1 : reserve0, feeBps);
        if (amountOut < minAmountOut || amountOut == 0) revert InsufficientOutput();

        uint256 totalFee = amountIn * feeBps / 10_000;
        uint256 protocolFee = totalFee * protocolFeeShareBps / 10_000;
        if (zeroForOne) protocolFees0 += protocolFee;
        else protocolFees1 += protocolFee;
        _safeTransfer(zeroForOne ? token1 : token0, to, amountOut);

        (balance0, balance1) = _availableBalances();
        if (balance0 * balance1 < uint256(reserve0) * uint256(reserve1)) revert InvariantViolation();
        _update(balance0, balance1);
        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to);
    }

    function claimProtocolFees() external lock returns (uint256 amount0, uint256 amount1) {
        address recipient = IYNXDexFactoryView(factory).protocolFeeRecipient();
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
        // A public sync may account for donations, but must never legitimize a
        // negative rebase or confiscating token by writing losses into reserves.
        if (balance0 < reserve0 || balance1 < reserve1) revert InvariantViolation();
        _update(balance0, balance1);
    }

    function currentCumulativePrices() external view returns (uint256 cumulative0, uint256 cumulative1, uint32 timestamp) {
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

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public view returns (uint256) {
        if (lpProtection != address(0)) revert ProtectedQuoteRequiresToken();
        return _amountOut(amountIn, reserveIn, reserveOut, baseSwapFeeBps);
    }

    function getAmountOutFor(address tokenIn, uint256 amountIn) public view returns (uint256) {
        bool zeroForOne = _direction(tokenIn);
        uint16 feeBps = _previewFee(tokenIn, amountIn);
        return _amountOut(amountIn, zeroForOne ? reserve0 : reserve1, zeroForOne ? reserve1 : reserve0, feeBps);
    }

    function getAmountInFor(address tokenIn, uint256 amountOut) public view returns (uint256 amountIn) {
        bool zeroForOne = _direction(tokenIn);
        uint256 reserveIn = zeroForOne ? reserve0 : reserve1;
        uint256 reserveOut = zeroForOne ? reserve1 : reserve0;
        if (amountOut == 0 || reserveIn == 0 || amountOut >= reserveOut) revert InsufficientLiquidity();
        if (lpProtection == address(0)) return _amountIn(amountOut, reserveIn, reserveOut, baseSwapFeeBps);
        (, uint16 maximumFee) = YNXLPProtection(lpProtection).feeBounds(address(this));
        amountIn = _amountIn(amountOut, reserveIn, reserveOut, maximumFee);
        // Fee is monotonic in same-side input. Starting at the maximum-fee
        // upper bound and iterating downward remains conservative at every step.
        for (uint256 i; i < 8; ++i) {
            uint256 next = _amountIn(amountOut, reserveIn, reserveOut, _previewFee(tokenIn, amountIn));
            if (next >= amountIn) break;
            amountIn = next;
        }
    }

    function currentFeeQuote(address tokenIn, uint256 amountIn)
        external view returns (YNXLPProtection.FeeQuote memory quote)
    {
        if (lpProtection == address(0)) revert ProtectedQuoteRequiresToken();
        _direction(tokenIn);
        return YNXLPProtection(lpProtection).previewFee(
            address(this), tokenIn, amountIn, reserve0, reserve1, lastLiquidityChangeBlock
        );
    }

    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint16 feeBps)
        private pure returns (uint256)
    {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 inputAfterFee = amountIn * (10_000 - feeBps);
        return inputAfterFee * reserveOut / (reserveIn * 10_000 + inputAfterFee);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) public view returns (uint256) {
        if (lpProtection != address(0)) revert ProtectedQuoteRequiresToken();
        return _amountIn(amountOut, reserveIn, reserveOut, baseSwapFeeBps);
    }

    function _amountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut, uint16 feeBps)
        private pure returns (uint256)
    {
        if (amountOut == 0 || reserveIn == 0 || amountOut >= reserveOut) revert InsufficientLiquidity();
        return reserveIn * amountOut * 10_000 / ((reserveOut - amountOut) * (10_000 - feeBps)) + 1;
    }

    function _previewFee(address tokenIn, uint256 amountIn) private view returns (uint16) {
        if (lpProtection == address(0)) return baseSwapFeeBps;
        return YNXLPProtection(lpProtection).previewFee(
            address(this), tokenIn, amountIn, reserve0, reserve1, lastLiquidityChangeBlock
        ).totalFeeBps;
    }

    function _direction(address tokenIn) private view returns (bool zeroForOne) {
        if (tokenIn == token0) return true;
        if (tokenIn == token1) return false;
        revert InvalidToken();
    }

    function swapFeeBps() external view returns (uint16) {
        if (lpProtection == address(0)) return baseSwapFeeBps;
        (uint16 baseFee,) = YNXLPProtection(lpProtection).feeBounds(address(this));
        return baseFee;
    }

    function _availableBalances() private view returns (uint256 balance0, uint256 balance1) {
        balance0 = IYNXDexERC20(token0).balanceOf(address(this)) - protocolFees0;
        balance1 = IYNXDexERC20(token1).balanceOf(address(this)) - protocolFees1;
    }

    function _update(uint256 balance0, uint256 balance1) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();
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
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IYNXDexERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
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

    function _min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y == 0) return 0;
        z = y;
        uint256 x = y / 2 + 1;
        while (x < z) { z = x; x = (y / x + x) / 2; }
    }
}
