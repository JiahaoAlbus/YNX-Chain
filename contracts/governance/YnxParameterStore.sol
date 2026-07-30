// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title YnxParameterStore
 * @notice On-chain storage for protocol parameters with governance-controlled bounds
 * @dev Parameters have type constraints and min/max bounds enforced by policy
 */
contract YnxParameterStore {
    // Parameter types
    enum ParameterType {
        Uint256,
        Int256,
        Address,
        Bool,
        Bytes32,
        String
    }
    
    // Parameter metadata
    struct Parameter {
        string path;
        ParameterType paramType;
        bytes value;
        int256 minimum;
        int256 maximum;
        uint256 lastUpdated;
        bytes32 lastProposalId;
        bool exists;
    }
    
    // Governance contract address
    address public governance;
    
    // Parameter storage
    mapping(string => Parameter) public parameters;
    string[] public parameterPaths;
    
    // Events
    event ParameterUpdated(string indexed path, bytes oldValue, bytes newValue, bytes32 proposalId);
    event ParameterBoundsUpdated(string indexed path, int256 newMinimum, int256 newMaximum);
    event ParameterRegistered(string indexed path, ParameterType paramType);
    
    // Errors
    error UnauthorizedCaller(address caller);
    error ParameterNotFound(string path);
    error ParameterOutOfBounds(string path, int256 value, int256 min, int256 max);
    error InvalidParameterType(string path, ParameterType expected, ParameterType provided);
    
    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedCaller(msg.sender);
        _;
    }
    
    constructor(address _governance) {
        governance = _governance;
    }
    
    /**
     * @notice Register a new parameter with type and bounds
     */
    function registerParameter(
        string calldata path,
        ParameterType paramType,
        bytes calldata initialValue,
        int256 minimum,
        int256 maximum
    ) external onlyGovernance {
        require(!parameters[path].exists, "Parameter already exists");
        
        parameters[path] = Parameter({
            path: path,
            paramType: paramType,
            value: initialValue,
            minimum: minimum,
            maximum: maximum,
            lastUpdated: block.timestamp,
            lastProposalId: bytes32(0),
            exists: true
        });
        
        parameterPaths.push(path);
        
        emit ParameterRegistered(path, paramType);
    }
    
    /**
     * @notice Update a parameter value (governance only)
     */
    function updateParameter(
        string calldata path,
        bytes calldata newValue,
        bytes32 proposalId
    ) external onlyGovernance {
        Parameter storage param = parameters[path];
        if (!param.exists) revert ParameterNotFound(path);
        
        // Validate bounds for numeric types
        if (param.paramType == ParameterType.Uint256 || param.paramType == ParameterType.Int256) {
            int256 numericValue = abi.decode(newValue, (int256));
            if (numericValue < param.minimum || numericValue > param.maximum) {
                revert ParameterOutOfBounds(path, numericValue, param.minimum, param.maximum);
            }
        }
        
        bytes memory oldValue = param.value;
        param.value = newValue;
        param.lastUpdated = block.timestamp;
        param.lastProposalId = proposalId;
        
        emit ParameterUpdated(path, oldValue, newValue, proposalId);
    }
    
    /**
     * @notice Update parameter bounds (governance only)
     */
    function updateParameterBounds(
        string calldata path,
        int256 newMinimum,
        int256 newMaximum
    ) external onlyGovernance {
        Parameter storage param = parameters[path];
        if (!param.exists) revert ParameterNotFound(path);
        
        param.minimum = newMinimum;
        param.maximum = newMaximum;
        
        emit ParameterBoundsUpdated(path, newMinimum, newMaximum);
    }
    
    /**
     * @notice Get parameter value as uint256
     */
    function getUint256(string calldata path) external view returns (uint256) {
        Parameter storage param = parameters[path];
        if (!param.exists) revert ParameterNotFound(path);
        if (param.paramType != ParameterType.Uint256) {
            revert InvalidParameterType(path, ParameterType.Uint256, param.paramType);
        }
        return abi.decode(param.value, (uint256));
    }
    
    /**
     * @notice Get parameter value as int256
     */
    function getInt256(string calldata path) external view returns (int256) {
        Parameter storage param = parameters[path];
        if (!param.exists) revert ParameterNotFound(path);
        if (param.paramType != ParameterType.Int256) {
            revert InvalidParameterType(path, ParameterType.Int256, param.paramType);
        }
        return abi.decode(param.value, (int256));
    }
    
    /**
     * @notice Get parameter value as address
     */
    function getAddress(string calldata path) external view returns (address) {
        Parameter storage param = parameters[path];
        if (!param.exists) revert ParameterNotFound(path);
        if (param.paramType != ParameterType.Address) {
            revert InvalidParameterType(path, ParameterType.Address, param.paramType);
        }
        return abi.decode(param.value, (address));
    }
    
    /**
     * @notice Get parameter value as bool
     */
    function getBool(string calldata path) external view returns (bool) {
        Parameter storage param = parameters[path];
        if (!param.exists) revert ParameterNotFound(path);
        if (param.paramType != ParameterType.Bool) {
            revert InvalidParameterType(path, ParameterType.Bool, param.paramType);
        }
        return abi.decode(param.value, (bool));
    }
    
    /**
     * @notice Get parameter value as bytes32
     */
    function getBytes32(string calldata path) external view returns (bytes32) {
        Parameter storage param = parameters[path];
        if (!param.exists) revert ParameterNotFound(path);
        if (param.paramType != ParameterType.Bytes32) {
            revert InvalidParameterType(path, ParameterType.Bytes32, param.paramType);
        }
        return abi.decode(param.value, (bytes32));
    }
    
    /**
     * @notice Get parameter value as string
     */
    function getString(string calldata path) external view returns (string memory) {
        Parameter storage param = parameters[path];
        if (!param.exists) revert ParameterNotFound(path);
        if (param.paramType != ParameterType.String) {
            revert InvalidParameterType(path, ParameterType.String, param.paramType);
        }
        return abi.decode(param.value, (string));
    }
    
    /**
     * @notice Get parameter metadata
     */
    function getParameter(string calldata path) external view returns (Parameter memory) {
        if (!parameters[path].exists) revert ParameterNotFound(path);
        return parameters[path];
    }
    
    /**
     * @notice Get all parameter paths
     */
    function getAllParameterPaths() external view returns (string[] memory) {
        return parameterPaths;
    }
    
    /**
     * @notice Get total parameter count
     */
    function getParameterCount() external view returns (uint256) {
        return parameterPaths.length;
    }
}
