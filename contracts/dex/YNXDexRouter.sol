// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IYNXDexFactory {
    function getPool(address tokenA, address tokenB) external view returns (address);
    function supportedToken(address token) external view returns (bool);
}

interface IYNXDexPoolRouter {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external view returns (uint256);
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) external view returns (uint256);
    function executeSwap(address tokenIn, uint256 minAmountOut, address to, uint256 deadline) external returns (uint256);
    function mint(address to, uint256 deadline) external returns (uint256);
    function burn(address to, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external returns (uint256, uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IYNXDexTokenRouter {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Bounded multi-hop router. It never stores user assets or approvals.
contract YNXDexRouter {
    uint256 public constant MAX_HOPS = 4;
    address public immutable factory;

    error InvalidRoute();
    error UnsupportedToken();
    error NoPool();
    error DeadlineExpired();
    error ExcessiveInput();
    error InsufficientOutput();
    error TransferFailed();

    constructor(address factory_) {
        if (factory_ == address(0)) revert InvalidRoute();
        factory = factory_;
    }

    function quoteExactInput(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory amounts) {
        _validatePath(path);
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i + 1 < path.length; ++i) {
            (address pool, uint256 reserveIn, uint256 reserveOut) = _poolAndReserves(path[i], path[i + 1]);
            amounts[i + 1] = IYNXDexPoolRouter(pool).getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function quoteExactOutput(uint256 amountOut, address[] calldata path) public view returns (uint256[] memory amounts) {
        _validatePath(path);
        amounts = new uint256[](path.length);
        amounts[path.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; --i) {
            (address pool, uint256 reserveIn, uint256 reserveOut) = _poolAndReserves(path[i - 1], path[i]);
            amounts[i - 1] = IYNXDexPoolRouter(pool).getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }

    function swapExactInput(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        uint256[] memory quoted = quoteExactInput(amountIn, path);
        amountOut = quoted[quoted.length - 1];
        if (amountOut < amountOutMin) revert InsufficientOutput();
        _safeTransferFrom(path[0], msg.sender, _pool(path[0], path[1]), amountIn);
        _executePath(path, quoted, to, deadline);
    }

    function swapExactOutput(uint256 amountOut, uint256 amountInMax, address[] calldata path, address to, uint256 deadline)
        external returns (uint256 amountIn)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        uint256[] memory quoted = quoteExactOutput(amountOut, path);
        amountIn = quoted[0];
        if (amountIn > amountInMax) revert ExcessiveInput();
        _safeTransferFrom(path[0], msg.sender, _pool(path[0], path[1]), amountIn);
        _executePath(path, quoted, to, deadline);
    }

    function addLiquidity(address tokenA, address tokenB, uint256 amountA, uint256 amountB, address to, uint256 deadline)
        external returns (uint256 liquidity)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        address pool = _pool(tokenA, tokenB);
        _safeTransferFrom(tokenA, msg.sender, pool, amountA);
        _safeTransferFrom(tokenB, msg.sender, pool, amountB);
        liquidity = IYNXDexPoolRouter(pool).mint(to, deadline);
    }

    function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)
        external returns (uint256 amountA, uint256 amountB)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        address pool = _pool(tokenA, tokenB);
        if (!IYNXDexPoolRouter(pool).transferFrom(msg.sender, pool, liquidity)) revert TransferFailed();
        bool ordered = tokenA < tokenB;
        (uint256 amount0, uint256 amount1) = _burn(pool, to, ordered, amountAMin, amountBMin, deadline);
        (amountA, amountB) = tokenA < tokenB ? (amount0, amount1) : (amount1, amount0);
    }

    function _burn(address pool, address to, bool ordered, uint256 amountAMin, uint256 amountBMin, uint256 deadline)
        private returns (uint256 amount0, uint256 amount1)
    {
        return IYNXDexPoolRouter(pool).burn(
            to,
            ordered ? amountAMin : amountBMin,
            ordered ? amountBMin : amountAMin,
            deadline
        );
    }

    function _executePath(address[] calldata path, uint256[] memory quoted, address to, uint256 deadline) private {
        for (uint256 i; i + 1 < path.length; ++i) {
            address recipient = i + 2 < path.length ? _pool(path[i + 1], path[i + 2]) : to;
            uint256 minimum = i + 2 == path.length ? quoted[i + 1] : 1;
            uint256 actual = IYNXDexPoolRouter(_pool(path[i], path[i + 1])).executeSwap(path[i], minimum, recipient, deadline);
            if (i + 2 == path.length && actual < quoted[i + 1]) revert InsufficientOutput();
        }
    }

    function _poolAndReserves(address tokenIn, address tokenOut) private view returns (address pool, uint256 reserveIn, uint256 reserveOut) {
        pool = _pool(tokenIn, tokenOut);
        (uint112 reserve0, uint112 reserve1,) = IYNXDexPoolRouter(pool).getReserves();
        (reserveIn, reserveOut) = tokenIn == IYNXDexPoolRouter(pool).token0() ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _pool(address tokenA, address tokenB) private view returns (address pool) {
        pool = IYNXDexFactory(factory).getPool(tokenA, tokenB);
        if (pool == address(0)) revert NoPool();
    }

    function _validatePath(address[] calldata path) private view {
        if (path.length < 2 || path.length - 1 > MAX_HOPS) revert InvalidRoute();
        for (uint256 i; i < path.length; ++i) {
            if (path[i] == address(0) || !IYNXDexFactory(factory).supportedToken(path[i])) revert UnsupportedToken();
            if (i != 0 && path[i] == path[i - 1]) revert InvalidRoute();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IYNXDexTokenRouter.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
