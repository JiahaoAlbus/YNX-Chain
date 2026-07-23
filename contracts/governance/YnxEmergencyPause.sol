// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title YnxEmergencyPause
 * @notice Emergency pause mechanism for YNX protocol components
 * @dev Allows Emergency Council to temporarily pause specific targets with multi-sig approval
 */
contract YnxEmergencyPause {
    // Maximum emergency duration (7 days)
    uint256 public constant MAX_EMERGENCY_DURATION = 7 days;
    
    // Minimum approvals required for emergency action
    uint256 public constant REQUIRED_APPROVALS = 3;
    
    // Emergency scope types
    enum EmergencyScope {
        Bridge,
        OracleRoute,
        Market,
        Vault,
        Provider,
        Upgrade
    }
    
    // Emergency action
    struct EmergencyAction {
        bytes32 id;
        EmergencyScope scope;
        string target;
        address[] approvers;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 closedAt;
        bool active;
        bool expired;
    }
    
    // Governance contract
    address public governance;
    
    // Emergency council members
    mapping(address => bool) public councilMembers;
    address[] public councilList;
    
    // Emergency storage
    mapping(bytes32 => EmergencyAction) public emergencies;
    mapping(bytes32 => mapping(address => bool)) public hasApproved;
    
    // Pause status for each target
    mapping(EmergencyScope => mapping(string => bool)) public isPaused;
    
    // Events
    event EmergencyCreated(bytes32 indexed emergencyId, EmergencyScope scope, string target, uint256 expiresAt);
    event EmergencyApproved(bytes32 indexed emergencyId, address indexed approver);
    event EmergencyActivated(bytes32 indexed emergencyId, uint256 activatedAt);
    event EmergencyClosed(bytes32 indexed emergencyId, uint256 closedAt);
    event EmergencyExpired(bytes32 indexed emergencyId, uint256 expiredAt);
    event CouncilMemberAdded(address indexed member);
    event CouncilMemberRemoved(address indexed member);
    
    // Errors
    error UnauthorizedCaller(address caller);
    error NotCouncilMember(address caller);
    error EmergencyNotFound(bytes32 emergencyId);
    error EmergencyAlreadyApproved(bytes32 emergencyId, address approver);
    error EmergencyExpired(bytes32 emergencyId);
    error InsufficientApprovals(bytes32 emergencyId, uint256 current, uint256 required);
    error InvalidDuration(uint256 duration);
    error TargetNotPaused(EmergencyScope scope, string target);
    
    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedCaller(msg.sender);
        _;
    }
    
    modifier onlyCouncil() {
        if (!councilMembers[msg.sender]) revert NotCouncilMember(msg.sender);
        _;
    }
    
    constructor(address _governance) {
        governance = _governance;
    }
    
    /**
     * @notice Add a council member (governance only)
     */
    function addCouncilMember(address member) external onlyGovernance {
        require(!councilMembers[member], "Already a council member");
        councilMembers[member] = true;
        councilList.push(member);
        emit CouncilMemberAdded(member);
    }
    
    /**
     * @notice Remove a council member (governance only)
     */
    function removeCouncilMember(address member) external onlyGovernance {
        require(councilMembers[member], "Not a council member");
        councilMembers[member] = false;
        
        // Remove from list
        for (uint256 i = 0; i < councilList.length; i++) {
            if (councilList[i] == member) {
                councilList[i] = councilList[councilList.length - 1];
                councilList.pop();
                break;
            }
        }
        
        emit CouncilMemberRemoved(member);
    }
    
    /**
     * @notice Create an emergency pause proposal
     * @param emergencyId Unique emergency identifier
     * @param scope Emergency scope (bridge, oracle, etc.)
     * @param target Specific target identifier to pause
     * @param duration Duration in seconds (max 7 days)
     */
    function createEmergency(
        bytes32 emergencyId,
        EmergencyScope scope,
        string calldata target,
        uint256 duration
    ) external onlyCouncil {
        require(emergencies[emergencyId].id == bytes32(0), "Emergency already exists");
        if (duration > MAX_EMERGENCY_DURATION) revert InvalidDuration(duration);
        
        address[] memory approvers = new address[](1);
        approvers[0] = msg.sender;
        
        emergencies[emergencyId] = EmergencyAction({
            id: emergencyId,
            scope: scope,
            target: target,
            approvers: approvers,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            closedAt: 0,
            active: false,
            expired: false
        });
        
        hasApproved[emergencyId][msg.sender] = true;
        
        emit EmergencyCreated(emergencyId, scope, target, block.timestamp + duration);
        emit EmergencyApproved(emergencyId, msg.sender);
        
        // Auto-activate if threshold met
        if (approvers.length >= REQUIRED_APPROVALS) {
            _activateEmergency(emergencyId);
        }
    }
    
    /**
     * @notice Approve an emergency pause proposal
     * @param emergencyId Emergency to approve
     */
    function approveEmergency(bytes32 emergencyId) external onlyCouncil {
        EmergencyAction storage emergency = emergencies[emergencyId];
        
        if (emergency.id == bytes32(0)) revert EmergencyNotFound(emergencyId);
        if (hasApproved[emergencyId][msg.sender]) {
            revert EmergencyAlreadyApproved(emergencyId, msg.sender);
        }
        if (block.timestamp >= emergency.expiresAt) revert EmergencyExpired(emergencyId);
        
        hasApproved[emergencyId][msg.sender] = true;
        emergency.approvers.push(msg.sender);
        
        emit EmergencyApproved(emergencyId, msg.sender);
        
        // Activate if threshold met
        if (emergency.approvers.length >= REQUIRED_APPROVALS && !emergency.active) {
            _activateEmergency(emergencyId);
        }
    }
    
    /**
     * @notice Internal function to activate emergency pause
     */
    function _activateEmergency(bytes32 emergencyId) internal {
        EmergencyAction storage emergency = emergencies[emergencyId];
        
        emergency.active = true;
        isPaused[emergency.scope][emergency.target] = true;
        
        emit EmergencyActivated(emergencyId, block.timestamp);
    }
    
    /**
     * @notice Close an emergency pause (governance or council)
     * @param emergencyId Emergency to close
     */
    function closeEmergency(bytes32 emergencyId) external {
        if (msg.sender != governance && !councilMembers[msg.sender]) {
            revert UnauthorizedCaller(msg.sender);
        }
        
        EmergencyAction storage emergency = emergencies[emergencyId];
        
        if (emergency.id == bytes32(0)) revert EmergencyNotFound(emergencyId);
        require(emergency.active, "Emergency not active");
        
        emergency.active = false;
        emergency.closedAt = block.timestamp;
        isPaused[emergency.scope][emergency.target] = false;
        
        emit EmergencyClosed(emergencyId, block.timestamp);
    }
    
    /**
     * @notice Expire an emergency pause automatically
     * @param emergencyId Emergency to expire
     */
    function expireEmergency(bytes32 emergencyId) external {
        EmergencyAction storage emergency = emergencies[emergencyId];
        
        if (emergency.id == bytes32(0)) revert EmergencyNotFound(emergencyId);
        require(emergency.active, "Emergency not active");
        require(block.timestamp >= emergency.expiresAt, "Emergency not yet expired");
        
        emergency.active = false;
        emergency.expired = true;
        isPaused[emergency.scope][emergency.target] = false;
        
        emit EmergencyExpired(emergencyId, block.timestamp);
    }
    
    /**
     * @notice Check if a target is currently paused
     */
    function isTargetPaused(EmergencyScope scope, string calldata target) external view returns (bool) {
        return isPaused[scope][target];
    }
    
    /**
     * @notice Get emergency details
     */
    function getEmergency(bytes32 emergencyId) external view returns (EmergencyAction memory) {
        return emergencies[emergencyId];
    }
    
    /**
     * @notice Get council member count
     */
    function getCouncilSize() external view returns (uint256) {
        return councilList.length;
    }
    
    /**
     * @notice Check if address is council member
     */
    function isCouncilMember(address account) external view returns (bool) {
        return councilMembers[account];
    }
}
