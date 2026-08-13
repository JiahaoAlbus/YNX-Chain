// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {YNXStablePool} from "./YNXStablePool.sol";

interface IYNXStableMetadata {
    function decimals() external view returns (uint8);
}

/// @notice Registry for one immutable StableSwap pool per reviewed token pair.
/// Pool amplification and fees are disclosed at creation and cannot be changed.
contract YNXStableFactory {
    uint256 public constant GOVERNANCE_DELAY = 2 days;
    uint16 public constant PROTOCOL_FEE_SHARE_BPS = 1_667;
    string public constant deploymentVersion = "ynx-stableswap-v1";

    address public governance;
    address public protocolFeeRecipient;
    mapping(address => bool) public supportedToken;
    mapping(address => uint256) public precisionMultiplier;
    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;

    struct PendingTokenChange { bool allowed; uint64 executableAt; uint256 multiplier; }
    mapping(address => PendingTokenChange) public pendingTokenChanges;
    address public pendingProtocolFeeRecipient;
    uint64 public pendingProtocolFeeRecipientAt;
    address public pendingGovernance;
    uint64 public pendingGovernanceAt;

    event PoolCreated(address indexed token0, address indexed token1, address pool, uint256 index);
    event StablePoolParameters(address indexed pool, uint64 amplification, uint16 swapFeeBps, uint256 precision0, uint256 precision1);
    event TokenChangeScheduled(address indexed token, bool allowed, uint256 executableAt, uint256 precisionMultiplier);
    event TokenSupportChanged(address indexed token, bool allowed, uint256 precisionMultiplier);
    event ProtocolFeeRecipientScheduled(address indexed recipient, uint256 executableAt);
    event ProtocolFeeRecipientChanged(address indexed recipient);
    event GovernanceTransferScheduled(address indexed governance, uint256 executableAt);
    event GovernanceTransferred(address indexed previousGovernance, address indexed governance);

    error Unauthorized();
    error InvalidToken();
    error UnsupportedToken();
    error InvalidParameters();
    error PoolExists();
    error DelayNotElapsed();
    error InvalidRecipient();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    constructor(address initialGovernance, address initialFeeRecipient, address[] memory initialTokens) {
        if (initialGovernance == address(0) || initialFeeRecipient == address(0)) revert InvalidRecipient();
        governance = initialGovernance;
        protocolFeeRecipient = initialFeeRecipient;
        for (uint256 i; i < initialTokens.length; ++i) {
            if (supportedToken[initialTokens[i]]) revert InvalidToken();
            _setToken(initialTokens[i], true, _readMultiplier(initialTokens[i]));
        }
    }

    function allPoolsLength() external view returns (uint256) { return allPools.length; }

    function createPool(address tokenA, address tokenB, uint64 amplification, uint16 swapFeeBps)
        external onlyGovernance returns (address pool)
    {
        if (tokenA == tokenB || tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (!supportedToken[tokenA] || !supportedToken[tokenB]) revert UnsupportedToken();
        if (amplification < 10 || amplification > 10_000 || swapFeeBps == 0 || swapFeeBps > 100) {
            revert InvalidParameters();
        }
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (getPool[token0][token1] != address(0)) revert PoolExists();
        uint256 multiplier0 = precisionMultiplier[token0];
        uint256 multiplier1 = precisionMultiplier[token1];
        bytes32 salt = keccak256(abi.encode(token0, token1, amplification, swapFeeBps));
        pool = address(new YNXStablePool{salt: salt}(
            token0, token1, multiplier0, multiplier1, amplification, swapFeeBps, PROTOCOL_FEE_SHARE_BPS
        ));
        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        allPools.push(pool);
        emit PoolCreated(token0, token1, pool, allPools.length);
        emit StablePoolParameters(pool, amplification, swapFeeBps, multiplier0, multiplier1);
    }

    function scheduleTokenSupport(address token, bool allowed) external onlyGovernance {
        uint256 multiplier = _readMultiplier(token);
        uint64 executableAt = uint64(block.timestamp + GOVERNANCE_DELAY);
        pendingTokenChanges[token] = PendingTokenChange(allowed, executableAt, multiplier);
        emit TokenChangeScheduled(token, allowed, executableAt, multiplier);
    }

    function executeTokenSupport(address token) external {
        PendingTokenChange memory change = pendingTokenChanges[token];
        if (change.executableAt == 0 || block.timestamp < change.executableAt) revert DelayNotElapsed();
        delete pendingTokenChanges[token];
        _setToken(token, change.allowed, change.multiplier);
    }

    function scheduleProtocolFeeRecipient(address recipient) external onlyGovernance {
        if (recipient == address(0)) revert InvalidRecipient();
        pendingProtocolFeeRecipient = recipient;
        pendingProtocolFeeRecipientAt = uint64(block.timestamp + GOVERNANCE_DELAY);
        emit ProtocolFeeRecipientScheduled(recipient, pendingProtocolFeeRecipientAt);
    }

    function executeProtocolFeeRecipient() external {
        if (pendingProtocolFeeRecipientAt == 0 || block.timestamp < pendingProtocolFeeRecipientAt) revert DelayNotElapsed();
        protocolFeeRecipient = pendingProtocolFeeRecipient;
        pendingProtocolFeeRecipient = address(0);
        pendingProtocolFeeRecipientAt = 0;
        emit ProtocolFeeRecipientChanged(protocolFeeRecipient);
    }

    function scheduleGovernance(address nextGovernance) external onlyGovernance {
        if (nextGovernance == address(0)) revert InvalidRecipient();
        pendingGovernance = nextGovernance;
        pendingGovernanceAt = uint64(block.timestamp + GOVERNANCE_DELAY);
        emit GovernanceTransferScheduled(nextGovernance, pendingGovernanceAt);
    }

    function executeGovernance() external {
        if (pendingGovernanceAt == 0 || block.timestamp < pendingGovernanceAt) revert DelayNotElapsed();
        address previous = governance;
        governance = pendingGovernance;
        pendingGovernance = address(0);
        pendingGovernanceAt = 0;
        emit GovernanceTransferred(previous, governance);
    }

    function _readMultiplier(address token) private view returns (uint256 multiplier) {
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        uint8 tokenDecimals;
        try IYNXStableMetadata(token).decimals() returns (uint8 value) { tokenDecimals = value; }
        catch { revert InvalidToken(); }
        if (tokenDecimals > 18) revert InvalidToken();
        multiplier = 10 ** (18 - tokenDecimals);
    }

    function _setToken(address token, bool allowed, uint256 multiplier) private {
        supportedToken[token] = allowed;
        precisionMultiplier[token] = multiplier;
        emit TokenSupportChanged(token, allowed, multiplier);
    }
}
