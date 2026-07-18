// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {YNXDexPool} from "./YNXDexPool.sol";

/// @notice Versioned immutable-pool registry with delayed governance changes.
contract YNXDexFactory {
    uint256 public constant GOVERNANCE_DELAY = 2 days;
    uint16 public constant SWAP_FEE_BPS = 30;
    uint16 public constant PROTOCOL_FEE_SHARE_BPS = 1_667; // ~1/6 of swap fee
    string public constant deploymentVersion = "ynx-dex-cpmm-v1";

    address public governance;
    address public protocolFeeRecipient;
    mapping(address => bool) public supportedToken;
    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;

    struct PendingTokenChange { bool allowed; uint64 executableAt; }
    mapping(address => PendingTokenChange) public pendingTokenChanges;
    address public pendingProtocolFeeRecipient;
    uint64 public pendingProtocolFeeRecipientAt;
    address public pendingGovernance;
    uint64 public pendingGovernanceAt;

    event PoolCreated(address indexed token0, address indexed token1, address pool, uint256 index);
    event TokenChangeScheduled(address indexed token, bool allowed, uint256 executableAt);
    event TokenSupportChanged(address indexed token, bool allowed);
    event ProtocolFeeRecipientScheduled(address indexed recipient, uint256 executableAt);
    event ProtocolFeeRecipientChanged(address indexed recipient);
    event GovernanceTransferScheduled(address indexed governance, uint256 executableAt);
    event GovernanceTransferred(address indexed previousGovernance, address indexed governance);

    error Unauthorized();
    error InvalidToken();
    error UnsupportedToken();
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
            address token = initialTokens[i];
            if (token == address(0) || token.code.length == 0) revert InvalidToken();
            supportedToken[token] = true;
            emit TokenSupportChanged(token, true);
        }
    }

    function allPoolsLength() external view returns (uint256) { return allPools.length; }

    function createPool(address tokenA, address tokenB) external returns (address pool) {
        if (tokenA == tokenB || tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (!supportedToken[tokenA] || !supportedToken[tokenB]) revert UnsupportedToken();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (getPool[token0][token1] != address(0)) revert PoolExists();
        pool = address(new YNXDexPool{salt: keccak256(abi.encode(token0, token1))}(
            token0, token1, SWAP_FEE_BPS, PROTOCOL_FEE_SHARE_BPS
        ));
        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        allPools.push(pool);
        emit PoolCreated(token0, token1, pool, allPools.length);
    }

    function scheduleTokenSupport(address token, bool allowed) external onlyGovernance {
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        uint64 executableAt = uint64(block.timestamp + GOVERNANCE_DELAY);
        pendingTokenChanges[token] = PendingTokenChange(allowed, executableAt);
        emit TokenChangeScheduled(token, allowed, executableAt);
    }

    function executeTokenSupport(address token) external {
        PendingTokenChange memory change = pendingTokenChanges[token];
        if (change.executableAt == 0 || block.timestamp < change.executableAt) revert DelayNotElapsed();
        delete pendingTokenChanges[token];
        supportedToken[token] = change.allowed;
        emit TokenSupportChanged(token, change.allowed);
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
}
