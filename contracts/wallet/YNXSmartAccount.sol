// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseAccount} from "@account-abstraction/contracts/core/BaseAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ISenderCreator} from "@account-abstraction/contracts/interfaces/ISenderCreator.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS, _packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/// @notice ERC-4337 testnet account with owner, UV-required passkey, bounded session keys and delayed guardian recovery.
contract YNXSmartAccount is BaseAccount {
    struct Session {
        address target;
        bytes4 selector;
        uint48 validAfter;
        uint48 validUntil;
        uint128 maxValuePerCall;
        uint128 dailyValueLimit;
        uint128 spentToday;
        uint64 day;
        uint64 epoch;
        bool enabled;
    }

    struct Recovery {
        address newOwner;
        bytes32 newPasskeyX;
        bytes32 newPasskeyY;
        uint48 executeAfter;
    }

    error Unauthorized();
    error InvalidConfiguration();
    error SessionNotActive();
    error SessionPolicyViolation();
    error RecoveryNotReady();

    event SessionConfigured(address indexed sessionKey, address indexed target, bytes4 indexed selector, uint48 validUntil);
    event SessionRevoked(address indexed sessionKey);
    event AllSessionsRevoked(uint64 indexed epoch, address indexed actor);
    event RecoveryRequested(address indexed guardian, address indexed newOwner, uint48 executeAfter);
    event RecoveryCancelled(address indexed actor);
    event RecoveryExecuted(address indexed oldOwner, address indexed newOwner, uint64 sessionEpoch);
    event GuardianChanged(address indexed oldGuardian, address indexed newGuardian);

    IEntryPoint private immutable _entryPoint;
    address public owner;
    address public guardian;
    bytes32 public passkeyX;
    bytes32 public passkeyY;
    uint48 public immutable recoveryDelay;
    uint64 public sessionEpoch = 1;
    Recovery public recovery;
    mapping(address sessionKey => Session) public sessions;

    constructor(
        IEntryPoint entryPoint_,
        address owner_,
        bytes32 passkeyX_,
        bytes32 passkeyY_,
        address guardian_,
        uint48 recoveryDelay_
    ) {
        if (
            address(entryPoint_) == address(0) || owner_ == address(0) || guardian_ == address(0)
                || passkeyX_ == bytes32(0) || passkeyY_ == bytes32(0) || recoveryDelay_ < 1 days
                || recoveryDelay_ > 30 days
        ) revert InvalidConfiguration();
        _entryPoint = entryPoint_;
        owner = owner_;
        guardian = guardian_;
        passkeyX = passkeyX_;
        passkeyY = passkeyY_;
        recoveryDelay = recoveryDelay_;
    }

    receive() external payable {}

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    function configureSession(
        address sessionKey,
        address target,
        bytes4 selector,
        uint48 validAfter,
        uint48 validUntil,
        uint128 maxValuePerCall,
        uint128 dailyValueLimit
    ) external onlyOwnerOrSelf {
        if (
            sessionKey == address(0) || target == address(0) || selector == bytes4(0) || validUntil <= validAfter
                || validUntil <= block.timestamp || validUntil - validAfter > 30 days || maxValuePerCall > dailyValueLimit
                || dailyValueLimit == 0
        ) revert InvalidConfiguration();
        sessions[sessionKey] = Session({
            target: target,
            selector: selector,
            validAfter: validAfter,
            validUntil: validUntil,
            maxValuePerCall: maxValuePerCall,
            dailyValueLimit: dailyValueLimit,
            spentToday: 0,
            day: uint64(block.timestamp / 1 days),
            epoch: sessionEpoch,
            enabled: true
        });
        emit SessionConfigured(sessionKey, target, selector, validUntil);
    }

    function revokeSession(address sessionKey) external onlyOwnerOrSelf {
        sessions[sessionKey].enabled = false;
        emit SessionRevoked(sessionKey);
    }

    function revokeAllSessions() external {
        if (msg.sender != owner && msg.sender != guardian && msg.sender != address(this)) revert Unauthorized();
        unchecked { ++sessionEpoch; }
        emit AllSessionsRevoked(sessionEpoch, msg.sender);
    }

    function executeSession(address sessionKey, address target, uint256 value, bytes calldata data) external {
        _requireFromEntryPoint();
        Session storage session = sessions[sessionKey];
        if (
            !session.enabled || session.epoch != sessionEpoch || block.timestamp < session.validAfter
                || block.timestamp > session.validUntil
        ) revert SessionNotActive();
        bytes4 selector = data.length < 4 ? bytes4(0) : bytes4(data[:4]);
        if (target != session.target || selector != session.selector || value > session.maxValuePerCall) {
            revert SessionPolicyViolation();
        }
        uint64 today = uint64(block.timestamp / 1 days);
        if (session.day != today) {
            session.day = today;
            session.spentToday = 0;
        }
        if (value > session.dailyValueLimit - session.spentToday) revert SessionPolicyViolation();
        session.spentToday += uint128(value);
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
    }

    function requestRecovery(address newOwner, bytes32 newPasskeyX, bytes32 newPasskeyY) external {
        if (msg.sender != guardian) revert Unauthorized();
        if (newOwner == address(0) || newPasskeyX == bytes32(0) || newPasskeyY == bytes32(0)) {
            revert InvalidConfiguration();
        }
        uint48 executeAfter = uint48(block.timestamp) + recoveryDelay;
        recovery = Recovery(newOwner, newPasskeyX, newPasskeyY, executeAfter);
        emit RecoveryRequested(msg.sender, newOwner, executeAfter);
    }

    function cancelRecovery() external {
        if (msg.sender != owner && msg.sender != address(this)) revert Unauthorized();
        delete recovery;
        emit RecoveryCancelled(msg.sender);
    }

    function executeRecovery() external {
        Recovery memory pending = recovery;
        if (pending.executeAfter == 0 || block.timestamp < pending.executeAfter) revert RecoveryNotReady();
        address oldOwner = owner;
        owner = pending.newOwner;
        passkeyX = pending.newPasskeyX;
        passkeyY = pending.newPasskeyY;
        delete recovery;
        unchecked { ++sessionEpoch; }
        emit RecoveryExecuted(oldOwner, owner, sessionEpoch);
    }

    function changeGuardian(address newGuardian) external onlyOwnerOrSelf {
        if (newGuardian == address(0) || newGuardian == guardian) revert InvalidConfiguration();
        address oldGuardian = guardian;
        guardian = newGuardian;
        delete recovery;
        emit GuardianChanged(oldGuardian, newGuardian);
    }

    function _requireForExecute() internal view override {
        if (msg.sender != address(entryPoint()) && msg.sender != owner) revert Unauthorized();
    }

    function _validateSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
        internal
        view
        override
        returns (uint256)
    {
        bytes calldata signature = userOp.signature;
        if (signature.length < 2) return SIG_VALIDATION_FAILED;
        uint8 mode = uint8(signature[0]);
        if (mode == 0) {
            (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecoverCalldata(userOpHash, signature[1:]);
            return error == ECDSA.RecoverError.NoError && recovered == owner ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
        }
        if (mode == 1) {
            (bool decoded, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn.tryDecodeAuth(signature[1:]);
            return decoded && WebAuthn.verify(abi.encodePacked(userOpHash), auth, passkeyX, passkeyY)
                ? SIG_VALIDATION_SUCCESS
                : SIG_VALIDATION_FAILED;
        }
        if (mode == 2 && signature.length == 86 && userOp.callData.length >= 36) {
            address sessionKey = address(bytes20(signature[1:21]));
            Session storage session = sessions[sessionKey];
            if (!session.enabled || session.epoch != sessionEpoch || bytes4(userOp.callData[:4]) != this.executeSession.selector) {
                return SIG_VALIDATION_FAILED;
            }
            address callSessionKey = address(bytes20(userOp.callData[16:36]));
            if (callSessionKey != sessionKey) return SIG_VALIDATION_FAILED;
            (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecoverCalldata(userOpHash, signature[21:]);
            bool failed = error != ECDSA.RecoverError.NoError || recovered != sessionKey;
            return _packValidationData(failed, session.validUntil, session.validAfter);
        }
        return SIG_VALIDATION_FAILED;
    }

    modifier onlyOwnerOrSelf() {
        if (msg.sender != owner && msg.sender != address(this)) revert Unauthorized();
        _;
    }
}

contract YNXSmartAccountFactory {
    IEntryPoint public immutable entryPoint;
    ISenderCreator public immutable senderCreator;

    constructor(IEntryPoint entryPoint_) {
        if (address(entryPoint_) == address(0)) revert YNXSmartAccount.InvalidConfiguration();
        entryPoint = entryPoint_;
        senderCreator = entryPoint_.senderCreator();
    }

    function createAccount(
        address owner,
        bytes32 passkeyX,
        bytes32 passkeyY,
        address guardian,
        uint48 recoveryDelay,
        bytes32 salt
    ) external returns (YNXSmartAccount account) {
        if (msg.sender != address(senderCreator)) revert YNXSmartAccount.Unauthorized();
        address predicted = getAddress(owner, passkeyX, passkeyY, guardian, recoveryDelay, salt);
        if (predicted.code.length != 0) return YNXSmartAccount(payable(predicted));
        account = new YNXSmartAccount{salt: salt}(entryPoint, owner, passkeyX, passkeyY, guardian, recoveryDelay);
    }

    function getAddress(
        address owner,
        bytes32 passkeyX,
        bytes32 passkeyY,
        address guardian,
        uint48 recoveryDelay,
        bytes32 salt
    ) public view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(YNXSmartAccount).creationCode,
                abi.encode(entryPoint, owner, passkeyX, passkeyY, guardian, recoveryDelay)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
