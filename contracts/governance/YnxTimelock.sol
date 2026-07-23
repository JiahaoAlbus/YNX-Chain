// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title YnxTimelock
 * @notice Enforces time delays on governance proposal execution
 * @dev Provides security buffer and allows for emergency cancellation
 */
contract YnxTimelock {
    // Minimum and maximum timelock durations
    uint256 public constant MIN_DELAY = 1 days;
    uint256 public constant MAX_DELAY = 30 days;
    
    // Timelock entry
    struct TimelockEntry {
        bytes32 proposalId;
        uint256 executeAfter;
        bytes32 operationHash;
        bool executed;
        bool cancelled;
    }
    
    // Governance contract
    address public governance;
    
    // Timelock storage
    mapping(bytes32 => TimelockEntry) public timelocks;
    
    // Events
    event TimelockScheduled(bytes32 indexed proposalId, uint256 executeAfter, bytes32 operationHash);
    event TimelockExecuted(bytes32 indexed proposalId, uint256 executedAt);
    event TimelockCancelled(bytes32 indexed proposalId, address indexed canceller);
    
    // Errors
    error UnauthorizedCaller(address caller);
    error InvalidDelay(uint256 delay);
    error TimelockNotReady(bytes32 proposalId, uint256 remainingTime);
    error TimelockAlreadyExecuted(bytes32 proposalId);
    error TimelockCancelled(bytes32 proposalId);
    error TimelockNotFound(bytes32 proposalId);
    
    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedCaller(msg.sender);
        _;
    }
    
    constructor(address _governance) {
        governance = _governance;
    }
    
    /**
     * @notice Schedule a governance operation for execution after timelock
     * @param proposalId Unique proposal identifier
     * @param delay Time delay in seconds before execution is allowed
     * @param operationHash Hash of the operation to be executed
     */
    function schedule(
        bytes32 proposalId,
        uint256 delay,
        bytes32 operationHash
    ) external onlyGovernance {
        if (delay < MIN_DELAY || delay > MAX_DELAY) {
            revert InvalidDelay(delay);
        }
        
        require(timelocks[proposalId].proposalId == bytes32(0), "Timelock already scheduled");
        
        uint256 executeAfter = block.timestamp + delay;
        
        timelocks[proposalId] = TimelockEntry({
            proposalId: proposalId,
            executeAfter: executeAfter,
            operationHash: operationHash,
            executed: false,
            cancelled: false
        });
        
        emit TimelockScheduled(proposalId, executeAfter, operationHash);
    }
    
    /**
     * @notice Execute a timelocked operation
     * @param proposalId Proposal to execute
     */
    function execute(bytes32 proposalId) external onlyGovernance returns (bool) {
        TimelockEntry storage entry = timelocks[proposalId];
        
        if (entry.proposalId == bytes32(0)) revert TimelockNotFound(proposalId);
        if (entry.cancelled) revert TimelockCancelled(proposalId);
        if (entry.executed) revert TimelockAlreadyExecuted(proposalId);
        
        if (block.timestamp < entry.executeAfter) {
            revert TimelockNotReady(proposalId, entry.executeAfter - block.timestamp);
        }
        
        entry.executed = true;
        
        emit TimelockExecuted(proposalId, block.timestamp);
        
        return true;
    }
    
    /**
     * @notice Cancel a scheduled timelock (emergency only)
     * @param proposalId Proposal to cancel
     */
    function cancel(bytes32 proposalId) external onlyGovernance {
        TimelockEntry storage entry = timelocks[proposalId];
        
        if (entry.proposalId == bytes32(0)) revert TimelockNotFound(proposalId);
        if (entry.executed) revert TimelockAlreadyExecuted(proposalId);
        
        entry.cancelled = true;
        
        emit TimelockCancelled(proposalId, msg.sender);
    }
    
    /**
     * @notice Check if timelock is ready for execution
     */
    function isReady(bytes32 proposalId) external view returns (bool) {
        TimelockEntry storage entry = timelocks[proposalId];
        
        if (entry.proposalId == bytes32(0)) return false;
        if (entry.executed || entry.cancelled) return false;
        
        return block.timestamp >= entry.executeAfter;
    }
    
    /**
     * @notice Get timelock details
     */
    function getTimelock(bytes32 proposalId) external view returns (TimelockEntry memory) {
        return timelocks[proposalId];
    }
    
    /**
     * @notice Get remaining time until execution is allowed
     */
    function getRemainingTime(bytes32 proposalId) external view returns (uint256) {
        TimelockEntry storage entry = timelocks[proposalId];
        
        if (entry.proposalId == bytes32(0)) return 0;
        if (block.timestamp >= entry.executeAfter) return 0;
        
        return entry.executeAfter - block.timestamp;
    }
}
