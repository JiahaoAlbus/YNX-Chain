// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IYNXVaultERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IYNXVaultFactory {
    function getPool(address tokenA, address tokenB) external view returns (address);
}

interface IYNXVaultRouter {
    function factory() external view returns (address);
    function quoteExactInput(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
    function quoteExactOutput(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory);
    function swapExactInput(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external returns (uint256);
    function swapExactOutput(uint256 amountOut, uint256 amountInMax, address[] calldata path, address to, uint256 deadline)
        external returns (uint256);
    function addLiquidity(address tokenA, address tokenB, uint256 amountA, uint256 amountB, address to, uint256 deadline)
        external returns (uint256);
    function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)
        external returns (uint256, uint256);
}

/// @notice Owner-selected oracle. Values share one 18-decimal accounting unit.
interface IYNXVaultOracle {
    function valueOf(address token, uint256 amount)
        external view returns (uint256 value, uint64 updatedAt, uint16 deviationBps);
}

/// @notice Non-upgradeable, non-custodial strategy boundary for one owner and one limited engine.
/// @dev The engine can only invoke typed DEX methods and every recipient is this vault.
contract YNXStrategyVault {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_ASSETS = 32;
    uint256 public constant DAY = 1 days;

    struct Mandate {
        uint128 maxVaultValue;
        uint128 maxTradeValue;
        uint64 maxGasPrice;
        uint64 expiresAt;
        uint32 minActionInterval;
        uint32 oracleMaxAge;
        uint16 maxSlippageBps;
        uint16 maxImpactBps;
        uint16 maxDailyLossBps;
        uint16 maxDrawdownBps;
        uint16 depegToleranceBps;
        uint16 performanceFeeBps;
        address feeAsset;
        address feeRecipient;
    }

    address public immutable owner;
    address public immutable engine;
    address public immutable router;
    address public immutable factory;
    IYNXVaultOracle public immutable oracle;
    bytes32 public immutable nonceDomain;

    Mandate private activeMandate;
    mapping(address => bool) public allowedAsset;
    mapping(address => bool) public allowedPool;
    address[] private assets;

    uint256 public actionNonce;
    uint256 public lastActionAt;
    uint256 public dailyWindow;
    uint256 public dailyStartValue;
    uint256 public dailyLossValue;
    uint256 public highWaterMark;
    bool public configured;
    bool public paused = true;
    bool public revoked;
    bool public killed;
    uint256 private entered = 1;

    event AssetAllowed(address indexed asset);
    event PoolPermission(address indexed pool, bool allowed);
    event MandateConfigured(uint256 indexed version, bytes32 mandateHash, uint256 expiresAt);
    event Deposited(address indexed token, uint256 amount, uint256 vaultValue);
    event Withdrawn(address indexed token, uint256 amount, address indexed recipient, bool emergency);
    event ActionExecuted(uint256 indexed nonce, bytes4 indexed method, uint256 beforeValue, uint256 afterValue);
    event Paused(address indexed actor);
    event Resumed();
    event Revoked(uint256 indexed finalNonce);
    event Killed(uint256 indexed finalNonce);

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidAsset();
    error InvalidPool();
    error InvalidRoute();
    error TransferFailed();
    error Reentrancy();
    error VaultPaused();
    error MandateExpired();
    error MandateRevoked();
    error NonceMismatch();
    error DeadlineInvalid();
    error GasPriceExceeded();
    error FrequencyExceeded();
    error CapitalExceeded();
    error SlippageExceeded();
    error ImpactExceeded();
    error OracleStale();
    error DepegDetected();
    error DailyLossExceeded();
    error DrawdownExceeded();
    error MinimumNotMet();
    error ApprovalNotCleared();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyEngine() {
        if (msg.sender != engine) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (entered != 1) revert Reentrancy();
        entered = 2;
        _;
        entered = 1;
    }

    constructor(address owner_, address engine_, address router_, address oracle_, address[] memory initialAssets) {
        if (owner_ == address(0) || engine_ == address(0) || router_.code.length == 0 || oracle_.code.length == 0) {
            revert InvalidConfiguration();
        }
        owner = owner_;
        engine = engine_;
        router = router_;
        oracle = IYNXVaultOracle(oracle_);
        address factory_ = IYNXVaultRouter(router_).factory();
        if (factory_.code.length == 0) revert InvalidConfiguration();
        factory = factory_;
        nonceDomain = keccak256(abi.encode("YNX_STRATEGY_VAULT_V1", block.chainid, address(this), owner_, engine_));
        for (uint256 i; i < initialAssets.length; ++i) _addAsset(initialAssets[i]);
    }

    function assetCount() external view returns (uint256) { return assets.length; }
    function assetAt(uint256 index) external view returns (address) { return assets[index]; }
    function mandate() external view returns (Mandate memory) { return activeMandate; }

    function addAsset(address asset) external onlyOwner {
        if (revoked || killed) revert MandateRevoked();
        _addAsset(asset);
    }

    function setPoolAllowed(address tokenA, address tokenB, bool allowed) external onlyOwner {
        if (revoked || killed) revert MandateRevoked();
        address pool = IYNXVaultFactory(factory).getPool(tokenA, tokenB);
        if (pool == address(0) || !allowedAsset[tokenA] || !allowedAsset[tokenB]) revert InvalidPool();
        if (allowed && !allowedAsset[pool]) _addAsset(pool);
        allowedPool[pool] = allowed;
        emit PoolPermission(pool, allowed);
    }

    function configureMandate(Mandate calldata next) external onlyOwner nonReentrant {
        if (revoked || killed) revert MandateRevoked();
        if (
            next.maxVaultValue == 0 || next.maxTradeValue == 0 || next.maxTradeValue > next.maxVaultValue
                || next.expiresAt <= block.timestamp || next.oracleMaxAge == 0
                || next.maxSlippageBps > BPS || next.maxImpactBps > BPS || next.maxDailyLossBps > BPS
                || next.maxDrawdownBps > BPS || next.depegToleranceBps > BPS || next.performanceFeeBps != 0
                || next.feeAsset != address(0) || next.feeRecipient != address(0)
        ) revert InvalidConfiguration();
        uint256 current = portfolioValue();
        if (current > next.maxVaultValue) revert CapitalExceeded();
        activeMandate = next;
        configured = true;
        paused = false;
        dailyWindow = block.timestamp / DAY;
        dailyStartValue = current;
        dailyLossValue = 0;
        if (current > highWaterMark) highWaterMark = current;
        emit MandateConfigured(actionNonce, keccak256(abi.encode(next)), next.expiresAt);
    }

    function deposit(address token, uint256 amount) external onlyOwner nonReentrant {
        if (!allowedAsset[token] || amount == 0 || revoked || killed) revert InvalidAsset();
        uint256 beforeBalance = IYNXVaultERC20(token).balanceOf(address(this));
        _safeTransferFrom(token, owner, address(this), amount);
        if (IYNXVaultERC20(token).balanceOf(address(this)) - beforeBalance != amount) revert TransferFailed();
        uint256 value = portfolioValue();
        if (configured && value > activeMandate.maxVaultValue) revert CapitalExceeded();
        uint256 addedValue = _value(token, amount);
        highWaterMark += addedValue;
        dailyStartValue += addedValue;
        emit Deposited(token, amount, value);
    }

    function withdraw(address token, uint256 amount, address recipient) external onlyOwner nonReentrant {
        if (!allowedAsset[token] || recipient == address(0) || amount == 0) revert InvalidAsset();
        _safeTransfer(token, recipient, amount);
        emit Withdrawn(token, amount, recipient, false);
    }

    function pause() external {
        if (msg.sender != owner && msg.sender != engine) revert Unauthorized();
        paused = true;
        emit Paused(msg.sender);
    }

    function resume() external onlyOwner {
        if (!configured || revoked || killed) revert MandateRevoked();
        paused = false;
        emit Resumed();
    }

    function revoke() external onlyOwner {
        revoked = true;
        paused = true;
        emit Revoked(actionNonce);
    }

    function kill() external onlyOwner {
        killed = true;
        paused = true;
        emit Killed(actionNonce);
    }

    function emergencyExit(address recipient) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidAsset();
        killed = true;
        paused = true;
        emit Killed(actionNonce);
        for (uint256 i; i < assets.length; ++i) {
            address token = assets[i];
            uint256 amount = IYNXVaultERC20(token).balanceOf(address(this));
            if (amount != 0) {
                _safeTransfer(token, recipient, amount);
                emit Withdrawn(token, amount, recipient, true);
            }
        }
    }

    function swapExactInput(
        uint256 expectedNonce,
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external onlyEngine nonReentrant returns (uint256 amountOut) {
        uint256 beforeValue = _preAction(expectedNonce, deadline);
        _validatePath(path);
        uint256[] memory quote = IYNXVaultRouter(router).quoteExactInput(amountIn, path);
        uint256 quotedOut = quote[quote.length - 1];
        if (amountOutMin < quotedOut * (BPS - activeMandate.maxSlippageBps) / BPS) revert SlippageExceeded();
        _enforceTradeRisk(path[0], amountIn, path[path.length - 1], quotedOut);
        _approveExact(path[0], router, amountIn);
        amountOut = IYNXVaultRouter(router).swapExactInput(amountIn, amountOutMin, path, address(this), deadline);
        _clearApproval(path[0], router);
        _postAction(this.swapExactInput.selector, beforeValue);
    }

    function swapExactOutput(
        uint256 expectedNonce,
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        uint256 deadline
    ) external onlyEngine nonReentrant returns (uint256 amountIn) {
        uint256 beforeValue = _preAction(expectedNonce, deadline);
        _validatePath(path);
        uint256[] memory quote = IYNXVaultRouter(router).quoteExactOutput(amountOut, path);
        uint256 quotedIn = quote[0];
        if (amountInMax > quotedIn * (BPS + activeMandate.maxSlippageBps) / BPS + 1) revert SlippageExceeded();
        _enforceTradeRisk(path[0], quotedIn, path[path.length - 1], amountOut);
        _approveExact(path[0], router, amountInMax);
        amountIn = IYNXVaultRouter(router).swapExactOutput(amountOut, amountInMax, path, address(this), deadline);
        _clearApproval(path[0], router);
        _postAction(this.swapExactOutput.selector, beforeValue);
    }

    function addLiquidity(
        uint256 expectedNonce,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 minLiquidity,
        uint256 deadline
    ) external onlyEngine nonReentrant returns (uint256 liquidity) {
        uint256 beforeValue = _preAction(expectedNonce, deadline);
        address pool = _validatePool(tokenA, tokenB);
        uint256 tradeValue = _value(tokenA, amountA) + _value(tokenB, amountB);
        if (tradeValue > activeMandate.maxTradeValue) revert CapitalExceeded();
        _approveExact(tokenA, router, amountA);
        _approveExact(tokenB, router, amountB);
        liquidity = IYNXVaultRouter(router).addLiquidity(tokenA, tokenB, amountA, amountB, address(this), deadline);
        _clearApproval(tokenA, router);
        _clearApproval(tokenB, router);
        if (liquidity < minLiquidity || !allowedAsset[pool]) revert MinimumNotMet();
        if (_value(pool, liquidity) < tradeValue * (BPS - activeMandate.maxSlippageBps) / BPS) {
            revert SlippageExceeded();
        }
        _postAction(this.addLiquidity.selector, beforeValue);
    }

    function removeLiquidity(
        uint256 expectedNonce,
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) external onlyEngine nonReentrant returns (uint256 amountA, uint256 amountB) {
        uint256 beforeValue = _preAction(expectedNonce, deadline);
        address pool = _validatePool(tokenA, tokenB);
        if (_value(pool, liquidity) > activeMandate.maxTradeValue) revert CapitalExceeded();
        _approveExact(pool, router, liquidity);
        (amountA, amountB) = IYNXVaultRouter(router).removeLiquidity(
            tokenA, tokenB, liquidity, amountAMin, amountBMin, address(this), deadline
        );
        _clearApproval(pool, router);
        uint256 outputValue = _value(tokenA, amountA) + _value(tokenB, amountB);
        if (outputValue < _value(pool, liquidity) * (BPS - activeMandate.maxSlippageBps) / BPS) {
            revert SlippageExceeded();
        }
        _postAction(this.removeLiquidity.selector, beforeValue);
    }

    function portfolioValue() public view returns (uint256 total) {
        for (uint256 i; i < assets.length; ++i) {
            address token = assets[i];
            uint256 balance = IYNXVaultERC20(token).balanceOf(address(this));
            if (balance != 0) total += _value(token, balance);
        }
    }

    function _preAction(uint256 expectedNonce, uint256 deadline) private returns (uint256 beforeValue) {
        if (!configured || paused) revert VaultPaused();
        if (revoked || killed) revert MandateRevoked();
        if (block.timestamp >= activeMandate.expiresAt) revert MandateExpired();
        if (deadline < block.timestamp || deadline > activeMandate.expiresAt) revert DeadlineInvalid();
        if (expectedNonce != actionNonce) revert NonceMismatch();
        if (activeMandate.maxGasPrice != 0 && tx.gasprice > activeMandate.maxGasPrice) revert GasPriceExceeded();
        if (lastActionAt != 0 && block.timestamp < lastActionAt + activeMandate.minActionInterval) revert FrequencyExceeded();
        beforeValue = portfolioValue();
        if (beforeValue > activeMandate.maxVaultValue) revert CapitalExceeded();
        uint256 window = block.timestamp / DAY;
        if (window != dailyWindow) {
            dailyWindow = window;
            dailyStartValue = beforeValue;
            dailyLossValue = 0;
        }
    }

    function _postAction(bytes4 method, uint256 beforeValue) private {
        uint256 afterValue = portfolioValue();
        if (afterValue > activeMandate.maxVaultValue) revert CapitalExceeded();
        if (afterValue < beforeValue) dailyLossValue += beforeValue - afterValue;
        if (dailyStartValue != 0 && dailyLossValue * BPS > dailyStartValue * activeMandate.maxDailyLossBps) {
            revert DailyLossExceeded();
        }
        if (afterValue > highWaterMark) highWaterMark = afterValue;
        if (highWaterMark != 0 && afterValue * BPS < highWaterMark * (BPS - activeMandate.maxDrawdownBps)) {
            revert DrawdownExceeded();
        }
        uint256 usedNonce = actionNonce;
        actionNonce = usedNonce + 1;
        lastActionAt = block.timestamp;
        emit ActionExecuted(usedNonce, method, beforeValue, afterValue);
    }

    function _enforceTradeRisk(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut) private view {
        uint256 inputValue = _value(tokenIn, amountIn);
        if (inputValue == 0 || inputValue > activeMandate.maxTradeValue) revert CapitalExceeded();
        uint256 outputValue = _value(tokenOut, amountOut);
        if (outputValue < inputValue && (inputValue - outputValue) * BPS > inputValue * activeMandate.maxImpactBps) {
            revert ImpactExceeded();
        }
    }

    function _validatePath(address[] calldata path) private view {
        if (path.length < 2 || path.length > 5) revert InvalidRoute();
        for (uint256 i; i < path.length; ++i) {
            if (!allowedAsset[path[i]]) revert InvalidAsset();
            if (i + 1 < path.length) _validatePool(path[i], path[i + 1]);
        }
    }

    function _validatePool(address tokenA, address tokenB) private view returns (address pool) {
        pool = IYNXVaultFactory(factory).getPool(tokenA, tokenB);
        if (pool == address(0) || !allowedPool[pool]) revert InvalidPool();
    }

    function _value(address token, uint256 amount) private view returns (uint256 value) {
        uint64 updatedAt;
        uint16 deviation;
        (value, updatedAt, deviation) = oracle.valueOf(token, amount);
        _validateOracle(updatedAt, deviation);
    }

    function _validateOracle(uint64 updatedAt, uint16 deviation) private view {
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > activeMandate.oracleMaxAge) revert OracleStale();
        if (deviation > activeMandate.depegToleranceBps) revert DepegDetected();
    }

    function _addAsset(address asset) private {
        if (asset.code.length == 0 || allowedAsset[asset] || assets.length >= MAX_ASSETS) revert InvalidAsset();
        allowedAsset[asset] = true;
        assets.push(asset);
        emit AssetAllowed(asset);
    }

    function _approveExact(address token, address spender, uint256 amount) private {
        if (IYNXVaultERC20(token).allowance(address(this), spender) != 0) revert ApprovalNotCleared();
        _safeApprove(token, spender, amount);
    }

    function _clearApproval(address token, address spender) private {
        _safeApprove(token, spender, 0);
        if (IYNXVaultERC20(token).allowance(address(this), spender) != 0) revert ApprovalNotCleared();
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IYNXVaultERC20.approve, (spender, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IYNXVaultERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IYNXVaultERC20.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
