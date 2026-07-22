// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice Conservative, signer-authorized Testnet sponsorship budgets for ERC-4337 UserOperations.
contract YNXSponsorPaymaster is BasePaymaster, EIP712 {
    enum SponsorType { Product, FirstAction, Merchant, Developer }

    struct ProductBudget {
        uint128 dailyLimit;
        uint128 perOperationLimit;
        uint128 perSubjectDailyLimit;
        uint128 firstActionLimit;
        uint128 reservedToday;
        uint128 observedToday;
        uint64 day;
        uint8 allowedTypes;
        address requiredTarget;
        bool enabled;
    }

    struct SubjectUsage {
        uint128 reservedToday;
        uint64 day;
    }

    struct SponsorAuthorization {
        bytes32 authorizationId;
        bytes32 productId;
        bytes32 subjectId;
        bytes32 policyId;
        SponsorType sponsorType;
        address destination;
        uint128 authorizationMaxCost;
        uint48 validAfter;
        uint48 validUntil;
    }

    error InvalidConfiguration();
    error SponsorshipDisabled();
    error PolicyViolation();
    error BudgetExceeded();
    error AuthorizationReplay();
    error UnauthorizedRiskAction();

    event ProductBudgetConfigured(bytes32 indexed productId, uint128 dailyLimit, uint128 perOperationLimit, uint8 allowedTypes);
    event MerchantApprovalChanged(bytes32 indexed productId, address indexed merchant, bool approved);
    event SponsorshipReserved(bytes32 indexed authorizationId, bytes32 indexed productId, bytes32 indexed subjectId, uint256 maxCost, SponsorType sponsorType);
    event SponsorshipObserved(bytes32 indexed authorizationId, bytes32 indexed productId, uint256 reservedCost, uint256 actualGasCost, uint256 actualUserOpFeePerGas, PostOpMode mode);
    event ProductDisabled(bytes32 indexed productId, address indexed actor);
    event GlobalSponsorshipChanged(bool enabled, address indexed actor);
    event PolicySignerChanged(address indexed oldSigner, address indexed newSigner);
    event RiskOfficerChanged(address indexed oldOfficer, address indexed newOfficer);

    bytes32 public constant SPONSOR_TYPEHASH = keccak256(
        "YNXSponsorAuthorization(bytes32 authorizationId,bytes32 productId,bytes32 subjectId,bytes32 policyId,uint8 sponsorType,address destination,uint128 authorizationMaxCost,uint48 validAfter,uint48 validUntil,bytes32 userOperationCoreHash)"
    );
    bytes32 public constant USER_OPERATION_CORE_TYPEHASH = keccak256(
        "YNXUserOperationCore(address sender,uint256 nonce,bytes32 initCodeHash,bytes32 callDataHash,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes32 paymasterStaticHash)"
    );
    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 private constant EXECUTE_SESSION_SELECTOR = bytes4(keccak256("executeSession(address,address,uint256,bytes)"));

    address public policySigner;
    address public riskOfficer;
    bool public sponsorshipEnabled;
    mapping(bytes32 productId => ProductBudget) public productBudgets;
    mapping(bytes32 productId => mapping(bytes32 subjectId => SubjectUsage)) public subjectUsage;
    mapping(bytes32 productId => mapping(bytes32 subjectId => bool)) public firstActionUsed;
    mapping(bytes32 productId => mapping(address merchant => bool)) public approvedMerchants;
    mapping(bytes32 authorizationId => bool) public consumedAuthorizations;

    constructor(IEntryPoint entryPoint_, address policySigner_, address riskOfficer_)
        BasePaymaster(entryPoint_)
        EIP712("YNX Sponsor Paymaster", "1")
    {
        if (policySigner_ == address(0) || riskOfficer_ == address(0)) revert InvalidConfiguration();
        policySigner = policySigner_;
        riskOfficer = riskOfficer_;
    }

    function configureProduct(
        bytes32 productId,
        uint128 dailyLimit,
        uint128 perOperationLimit,
        uint128 perSubjectDailyLimit,
        uint128 firstActionLimit,
        uint8 allowedTypes,
        address requiredTarget,
        bool enabled
    ) external onlyOwner {
        if (
            productId == bytes32(0) || dailyLimit == 0 || perOperationLimit == 0 || perSubjectDailyLimit == 0
                || perOperationLimit > dailyLimit || perSubjectDailyLimit > dailyLimit || firstActionLimit > perOperationLimit
                || allowedTypes == 0 || allowedTypes & 0xf0 != 0
        ) revert InvalidConfiguration();
        ProductBudget storage current = productBudgets[productId];
        uint64 today = uint64(block.timestamp / 1 days);
        uint128 reserved = current.day == today ? current.reservedToday : 0;
        uint128 observed = current.day == today ? current.observedToday : 0;
        if (reserved > dailyLimit) revert InvalidConfiguration();
        productBudgets[productId] = ProductBudget(
            dailyLimit, perOperationLimit, perSubjectDailyLimit, firstActionLimit,
            reserved, observed, today, allowedTypes, requiredTarget, enabled
        );
        emit ProductBudgetConfigured(productId, dailyLimit, perOperationLimit, allowedTypes);
    }

    function setMerchant(bytes32 productId, address merchant, bool approved) external onlyOwner {
        if (productId == bytes32(0) || merchant == address(0)) revert InvalidConfiguration();
        approvedMerchants[productId][merchant] = approved;
        emit MerchantApprovalChanged(productId, merchant, approved);
    }

    function disableProduct(bytes32 productId) external {
        if (msg.sender != owner() && msg.sender != riskOfficer) revert UnauthorizedRiskAction();
        productBudgets[productId].enabled = false;
        emit ProductDisabled(productId, msg.sender);
    }

    function setSponsorshipEnabled(bool enabled) external {
        if (enabled) {
            if (msg.sender != owner()) revert UnauthorizedRiskAction();
        } else if (msg.sender != owner() && msg.sender != riskOfficer) {
            revert UnauthorizedRiskAction();
        }
        sponsorshipEnabled = enabled;
        emit GlobalSponsorshipChanged(enabled, msg.sender);
    }

    function setPolicySigner(address newSigner) external onlyOwner {
        if (newSigner == address(0) || newSigner == policySigner) revert InvalidConfiguration();
        address oldSigner = policySigner;
        policySigner = newSigner;
        emit PolicySignerChanged(oldSigner, newSigner);
    }

    function setRiskOfficer(address newOfficer) external onlyOwner {
        if (newOfficer == address(0) || newOfficer == riskOfficer) revert InvalidConfiguration();
        address oldOfficer = riskOfficer;
        riskOfficer = newOfficer;
        emit RiskOfficerChanged(oldOfficer, newOfficer);
    }

    function getSponsorHash(PackedUserOperation calldata userOp, SponsorAuthorization memory authorization)
        public
        view
        returns (bytes32)
    {
        bytes32 operationCoreHash = keccak256(abi.encode(
            USER_OPERATION_CORE_TYPEHASH,
            userOp.sender,
            userOp.nonce,
            keccak256(userOp.initCode),
            keccak256(userOp.callData),
            userOp.accountGasLimits,
            userOp.preVerificationGas,
            userOp.gasFees,
            keccak256(userOp.paymasterAndData[:52])
        ));
        return _hashTypedDataV4(keccak256(abi.encode(
            SPONSOR_TYPEHASH,
            authorization.authorizationId,
            authorization.productId,
            authorization.subjectId,
            authorization.policyId,
            uint8(authorization.sponsorType),
            authorization.destination,
            authorization.authorizationMaxCost,
            authorization.validAfter,
            authorization.validUntil,
            operationCoreHash
        )));
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        override
        returns (bytes memory context, uint256 validationData)
    {
        if (!sponsorshipEnabled) revert SponsorshipDisabled();
        (SponsorAuthorization memory authorization, bytes memory signature) = abi.decode(
            userOp.paymasterAndData[52:], (SponsorAuthorization, bytes)
        );
        if (
            authorization.authorizationId == bytes32(0) || authorization.productId == bytes32(0)
                || authorization.subjectId == bytes32(0) || authorization.policyId == bytes32(0)
                || authorization.validUntil <= authorization.validAfter
        ) revert PolicyViolation();
        if (consumedAuthorizations[authorization.authorizationId]) revert AuthorizationReplay();

        (address recovered, ECDSA.RecoverError recoverError,) = ECDSA.tryRecover(
            getSponsorHash(userOp, authorization), signature
        );
        if (recoverError != ECDSA.RecoverError.NoError || recovered != policySigner) {
            return ("", _packValidationData(true, authorization.validUntil, authorization.validAfter));
        }

        ProductBudget storage product = productBudgets[authorization.productId];
        uint8 sponsorBit = uint8(1 << uint8(authorization.sponsorType));
        if (!product.enabled || product.allowedTypes & sponsorBit == 0) revert SponsorshipDisabled();
        if (maxCost > authorization.authorizationMaxCost || maxCost > product.perOperationLimit) revert BudgetExceeded();
        address destination = _destination(userOp.callData);
        if (destination != authorization.destination) revert PolicyViolation();
        if (product.requiredTarget != address(0) && destination != product.requiredTarget) revert PolicyViolation();
        if (authorization.sponsorType == SponsorType.Merchant && !approvedMerchants[authorization.productId][destination]) {
            revert PolicyViolation();
        }
        if (authorization.sponsorType == SponsorType.FirstAction) {
            if (firstActionUsed[authorization.productId][authorization.subjectId] || maxCost > product.firstActionLimit) {
                revert BudgetExceeded();
            }
            firstActionUsed[authorization.productId][authorization.subjectId] = true;
        }

        uint64 today = uint64(block.timestamp / 1 days);
        if (product.day != today) {
            product.day = today;
            product.reservedToday = 0;
            product.observedToday = 0;
        }
        SubjectUsage storage subject = subjectUsage[authorization.productId][authorization.subjectId];
        if (subject.day != today) {
            subject.day = today;
            subject.reservedToday = 0;
        }
        if (maxCost > product.dailyLimit - product.reservedToday) revert BudgetExceeded();
        if (maxCost > product.perSubjectDailyLimit - subject.reservedToday) revert BudgetExceeded();
        product.reservedToday += uint128(maxCost);
        subject.reservedToday += uint128(maxCost);
        consumedAuthorizations[authorization.authorizationId] = true;
        emit SponsorshipReserved(
            authorization.authorizationId, authorization.productId, authorization.subjectId, maxCost, authorization.sponsorType
        );
        context = abi.encode(authorization.authorizationId, authorization.productId, uint128(maxCost));
        validationData = _packValidationData(false, authorization.validUntil, authorization.validAfter);
    }

    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas)
        internal
        override
    {
        (bytes32 authorizationId, bytes32 productId, uint128 reservedCost) = abi.decode(
            context, (bytes32, bytes32, uint128)
        );
        ProductBudget storage product = productBudgets[productId];
        uint64 today = uint64(block.timestamp / 1 days);
        if (product.day == today) {
            uint256 nextObserved = uint256(product.observedToday) + actualGasCost;
            product.observedToday = nextObserved > type(uint128).max ? type(uint128).max : uint128(nextObserved);
        }
        emit SponsorshipObserved(authorizationId, productId, reservedCost, actualGasCost, actualUserOpFeePerGas, mode);
    }

    function _destination(bytes calldata callData) private pure returns (address destination) {
        if (callData.length < 4) revert PolicyViolation();
        bytes4 selector = bytes4(callData[:4]);
        if (selector == EXECUTE_SELECTOR) {
            (destination,,) = abi.decode(callData[4:], (address, uint256, bytes));
        } else if (selector == EXECUTE_SESSION_SELECTOR) {
            (, destination,,) = abi.decode(callData[4:], (address, address, uint256, bytes));
        } else {
            revert PolicyViolation();
        }
    }
}
