// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title YnxGovernance
 * @notice On-chain governance for YNX Chain protocol parameters and upgrades
 * @dev Integrates with off-chain governance service for proposal lifecycle
 */
contract YnxGovernance {
    // Governance domain identifier
    string public constant DOMAIN = "ynx-governance-action/v1";
    uint256 public immutable chainId;
    
    // Proposal states
    enum ProposalStatus {
        Deposit,
        Discussion,
        Voting,
        Rejected,
        Timelocked,
        Executing,
        Executed,
        RolledBack,
        Cancelled,
        Expired
    }
    
    // Proposal structure
    struct Proposal {
        bytes32 id;
        address proposer;
        string scope;
        string summary;
        ProposalStatus status;
        uint256 createdAt;
        uint256 createdHeight;
        uint256 votingOpensAt;
        uint256 votingClosesAt;
        uint256 timelockEndsAt;
        uint256 executedAt;
        uint256 executedHeight;
        bytes32 upgradeHash;
        bool exists;
    }
    
    // Vote structure
    struct Vote {
        address voter;
        uint8 position; // 0=approve, 1=reject, 2=abstain
        uint256 power;
        uint256 castAt;
        uint256 castHeight;
        bytes32 txHash;
    }
    
    // Role structure
    struct Role {
        address account;
        string role;
        uint256 assignedAt;
        uint256 expiresAt;
        bytes32 proposalId;
        bool active;
    }
    
    // Emergency action structure
    struct Emergency {
        bytes32 id;
        string scope;
        string target;
        string action;
        address[] approvals;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 closedAt;
        bool active;
    }
    
    // State storage
    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => mapping(address => Vote)) public votes;
    mapping(bytes32 => uint256) public voteCount;
    mapping(address => Role) public roles;
    mapping(bytes32 => Emergency) public emergencies;
    mapping(address => uint256) public accountNonces;
    
    // Events
    event ProposalCreated(bytes32 indexed proposalId, address indexed proposer, string scope);
    event VoteCast(bytes32 indexed proposalId, address indexed voter, uint8 position, uint256 power);
    event ProposalExecuted(bytes32 indexed proposalId, uint256 height, bytes32 txHash);
    event ProposalRolledBack(bytes32 indexed proposalId, string reason);
    event RoleAssigned(address indexed account, string role, uint256 expiresAt);
    event RoleRemoved(address indexed account, string role);
    event EmergencyCreated(bytes32 indexed emergencyId, string scope, string target);
    event EmergencyClosed(bytes32 indexed emergencyId, uint256 closedAt);
    
    // Errors
    error UnauthorizedAction(address caller);
    error ProposalNotFound(bytes32 proposalId);
    error InvalidProposalStatus(bytes32 proposalId, ProposalStatus current);
    error AlreadyVoted(bytes32 proposalId, address voter);
    error VotingNotOpen(bytes32 proposalId);
    error TimelockNotExpired(bytes32 proposalId, uint256 remainingTime);
    error RoleExpired(address account);
    error EmergencyNotActive(bytes32 emergencyId);
    
    constructor(uint256 _chainId) {
        chainId = _chainId;
    }
    
    /**
     * @notice Create a new governance proposal
     * @param proposalId Unique proposal identifier (hash of canonical envelope)
     * @param scope Governance scope (e.g., "fee_burn_issuance")
     * @param summary Human-readable proposal summary
     * @param upgradeHash Optional upgrade manifest hash for protocol upgrades
     */
    function createProposal(
        bytes32 proposalId,
        string calldata scope,
        string calldata summary,
        bytes32 upgradeHash
    ) external {
        require(!proposals[proposalId].exists, "Proposal already exists");
        
        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            scope: scope,
            summary: summary,
            status: ProposalStatus.Deposit,
            createdAt: block.timestamp,
            createdHeight: block.number,
            votingOpensAt: 0,
            votingClosesAt: 0,
            timelockEndsAt: 0,
            executedAt: 0,
            executedHeight: 0,
            upgradeHash: upgradeHash,
            exists: true
        });
        
        emit ProposalCreated(proposalId, msg.sender, scope);
    }
    
    /**
     * @notice Cast a vote on a proposal
     * @param proposalId Proposal to vote on
     * @param position Vote position (0=approve, 1=reject, 2=abstain)
     * @param power Voting power (computed off-chain from stake/delegation)
     */
    function castVote(
        bytes32 proposalId,
        uint8 position,
        uint256 power
    ) external {
        Proposal storage proposal = proposals[proposalId];
        if (!proposal.exists) revert ProposalNotFound(proposalId);
        if (proposal.status != ProposalStatus.Voting) {
            revert InvalidProposalStatus(proposalId, proposal.status);
        }
        if (block.timestamp < proposal.votingOpensAt || block.timestamp > proposal.votingClosesAt) {
            revert VotingNotOpen(proposalId);
        }
        if (votes[proposalId][msg.sender].voter != address(0)) {
            revert AlreadyVoted(proposalId, msg.sender);
        }
        
        votes[proposalId][msg.sender] = Vote({
            voter: msg.sender,
            position: position,
            power: power,
            castAt: block.timestamp,
            castHeight: block.number,
            txHash: blockhash(block.number - 1)
        });
        
        voteCount[proposalId]++;
        
        emit VoteCast(proposalId, msg.sender, position, power);
    }
    
    /**
     * @notice Execute a timelocked proposal
     * @param proposalId Proposal to execute
     */
    function executeProposal(bytes32 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (!proposal.exists) revert ProposalNotFound(proposalId);
        if (proposal.status != ProposalStatus.Timelocked) {
            revert InvalidProposalStatus(proposalId, proposal.status);
        }
        if (block.timestamp < proposal.timelockEndsAt) {
            revert TimelockNotExpired(proposalId, proposal.timelockEndsAt - block.timestamp);
        }
        
        proposal.status = ProposalStatus.Executed;
        proposal.executedAt = block.timestamp;
        proposal.executedHeight = block.number;
        
        emit ProposalExecuted(proposalId, block.number, blockhash(block.number - 1));
    }
    
    /**
     * @notice Assign a governance role
     * @param account Account to assign role to
     * @param roleName Role identifier
     * @param expiresAt Role expiration timestamp
     * @param proposalId Authorizing proposal
     */
    function assignRole(
        address account,
        string calldata roleName,
        uint256 expiresAt,
        bytes32 proposalId
    ) external {
        // TODO: Add authorization check
        roles[account] = Role({
            account: account,
            role: roleName,
            assignedAt: block.timestamp,
            expiresAt: expiresAt,
            proposalId: proposalId,
            active: true
        });
        
        emit RoleAssigned(account, roleName, expiresAt);
    }
    
    /**
     * @notice Create an emergency pause action
     * @param emergencyId Unique emergency identifier
     * @param scope Emergency scope (bridge, oracle_route, market, etc.)
     * @param target Specific target identifier
     * @param action Action to take (pause)
     * @param duration Maximum duration in seconds
     */
    function createEmergency(
        bytes32 emergencyId,
        string calldata scope,
        string calldata target,
        string calldata action,
        uint256 duration
    ) external {
        require(!emergencies[emergencyId].active, "Emergency already active");
        require(duration <= 7 days, "Duration exceeds maximum");
        
        address[] memory approvals = new address[](1);
        approvals[0] = msg.sender;
        
        emergencies[emergencyId] = Emergency({
            id: emergencyId,
            scope: scope,
            target: target,
            action: action,
            approvals: approvals,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            closedAt: 0,
            active: true
        });
        
        emit EmergencyCreated(emergencyId, scope, target);
    }
    
    /**
     * @notice Close an emergency action
     * @param emergencyId Emergency to close
     */
    function closeEmergency(bytes32 emergencyId) external {
        Emergency storage emergency = emergencies[emergencyId];
        if (!emergency.active) revert EmergencyNotActive(emergencyId);
        
        emergency.active = false;
        emergency.closedAt = block.timestamp;
        
        emit EmergencyClosed(emergencyId, block.timestamp);
    }
    
    /**
     * @notice Get proposal details
     */
    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        if (!proposals[proposalId].exists) revert ProposalNotFound(proposalId);
        return proposals[proposalId];
    }
    
    /**
     * @notice Get vote details
     */
    function getVote(bytes32 proposalId, address voter) external view returns (Vote memory) {
        return votes[proposalId][voter];
    }
    
    /**
     * @notice Check if account has active role
     */
    function hasActiveRole(address account) external view returns (bool) {
        Role memory role = roles[account];
        return role.active && block.timestamp < role.expiresAt;
    }
}
