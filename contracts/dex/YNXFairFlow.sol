// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IYNXFairFlowFactory {
    function supportedToken(address token) external view returns (bool);
}

interface IYNXFairFlowToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Non-custodial uniform-price intent auction with bonded solver competition.
/// @dev Users retain assets until the winning solution settles atomically. This
///      contract deliberately has no upgrade, arbitrary-call or governance
///      withdrawal path for tokens.
contract YNXFairFlow {
    uint256 public constant Q96 = 1 << 96;
    uint256 public constant MAX_INTENTS = 64;
    uint256 public constant MAX_SOLVERS = 32;
    uint256 public constant MAX_REBATE_BPS = 2_000;
    uint256 public constant MAX_PRICE_X96 = type(uint128).max;
    bytes32 public immutable intentDomain;
    address public immutable governance;
    address public immutable treasury;
    address public immutable factory;
    uint256 public immutable minimumSolverBond;

    enum BatchStatus { None, Accepting, Finalized, Settled, Aborted, Failed }
    enum IntentStatus { None, Open, Cancelled, Settled }

    struct Batch {
        address token0;
        address token1;
        uint64 intentEnd;
        uint64 commitEnd;
        uint64 revealEnd;
        uint64 settleEnd;
        uint32 intentCount;
        uint32 activeIntentCount;
        BatchStatus status;
        address bestSolver;
        uint128 bestPriceX96;
        uint16 bestRebateBps;
        uint256 bestScoreToken0;
        bytes32 bestExecutionDigest;
        bytes32 bestRouteHash;
        bytes32 activeSetHash;
    }

    struct Intent {
        address owner;
        uint64 batchId;
        uint64 validTo;
        uint96 sellAmount;
        uint128 minBuyAmount;
        bool zeroForOne;
        IntentStatus status;
    }

    struct Solver {
        uint256 bond;
        uint256 locked;
        uint64 completed;
        uint64 failed;
        uint64 fraud;
    }

    struct Commitment {
        bytes32 digest;
        uint128 priceX96;
        uint16 rebateBps;
        uint256 scoreToken0;
        bool revealed;
        bool resolved;
    }

    struct SettlementTotals {
        uint256 input0;
        uint256 input1;
        uint256 output0;
        uint256 output1;
    }

    uint64 public nextBatchId = 1;
    mapping(address => uint64) public userNonces;
    mapping(uint64 => Batch) private _batches;
    mapping(bytes32 => Intent) public intents;
    mapping(uint64 => bytes32[]) private _batchIntents;
    mapping(uint64 => address[]) private _batchSolvers;
    mapping(uint64 => mapping(address => Commitment)) public commitments;
    mapping(address => Solver) public solvers;
    uint256 public treasuryCredit;
    uint256 private _locked = 1;

    event BatchOpened(uint64 indexed batchId, address indexed token0, address indexed token1, uint256 intentEnd, uint256 commitEnd, uint256 revealEnd, uint256 settleEnd);
    event IntentSubmitted(bytes32 indexed intentId, uint64 indexed batchId, address indexed owner, bool zeroForOne, uint256 sellAmount, uint256 minBuyAmount, uint256 validTo, uint256 nonce);
    event IntentCancelled(bytes32 indexed intentId, uint64 indexed batchId, address indexed owner, bool batchAborted);
    event SolverBondChanged(address indexed solver, uint256 bond, uint256 locked);
    event SolutionCommitted(uint64 indexed batchId, address indexed solver, bytes32 commitment);
    event SolutionRevealed(uint64 indexed batchId, address indexed solver, uint256 priceX96, uint256 rebateBps, uint256 scoreToken0, bytes32 routeHash, bytes32 executionDigest);
    event WinnerFinalized(uint64 indexed batchId, address indexed solver, uint256 priceX96, uint256 rebateBps, uint256 scoreToken0, bytes32 routeHash, bytes32 bestExecutionDigest);
    event IntentSettled(bytes32 indexed intentId, uint64 indexed batchId, address indexed owner, uint256 sellAmount, uint256 baseBuyAmount, uint256 solverFundedRebate, uint256 priceImprovement);
    event BatchSettled(uint64 indexed batchId, address indexed solver, uint256 userInput0, uint256 userInput1, uint256 userOutput0, uint256 userOutput1, uint256 externalInput0, uint256 externalInput1, uint256 solverOutput0, uint256 solverOutput1, bytes32 bestExecutionDigest);
    event BatchFailed(uint64 indexed batchId, address indexed solver, bytes32 reason, uint256 slashedBond);
    event SolverSlashed(uint64 indexed batchId, address indexed solver, bytes32 indexed reason, uint256 amount);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);

    error Unauthorized();
    error InvalidAddress();
    error InvalidWindow();
    error InvalidState();
    error InvalidIntent();
    error InvalidSolution();
    error InvalidCommitment();
    error LimitExceeded();
    error InsufficientBond();
    error TransferFailed();
    error ReentrantCall();

    modifier nonReentrant() {
        if (_locked != 1) revert ReentrantCall();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address governance_, address treasury_, address factory_, uint256 minimumSolverBond_) {
        if (governance_ == address(0) || treasury_ == address(0) || factory_ == address(0) || factory_.code.length == 0) revert InvalidAddress();
        if (minimumSolverBond_ == 0) revert InsufficientBond();
        governance = governance_;
        treasury = treasury_;
        factory = factory_;
        minimumSolverBond = minimumSolverBond_;
        intentDomain = keccak256(abi.encode("YNX_FAIRFLOW_INTENT_V1", block.chainid, address(this)));
    }

    receive() external payable { revert Unauthorized(); }

    function openBatch(address tokenA, address tokenB, uint64 intentDuration, uint64 commitDuration, uint64 revealDuration, uint64 settleDuration)
        external returns (uint64 batchId)
    {
        if (msg.sender != governance) revert Unauthorized();
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) revert InvalidAddress();
        if (!IYNXFairFlowFactory(factory).supportedToken(tokenA) || !IYNXFairFlowFactory(factory).supportedToken(tokenB)) revert InvalidAddress();
        if (intentDuration < 30 || commitDuration < 30 || revealDuration < 30 || settleDuration < 30 || intentDuration > 1 days || commitDuration > 1 days || revealDuration > 1 days || settleDuration > 1 days) revert InvalidWindow();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        batchId = nextBatchId++;
        uint64 intentEnd = uint64(block.timestamp) + intentDuration;
        uint64 commitEnd = intentEnd + commitDuration;
        uint64 revealEnd = commitEnd + revealDuration;
        uint64 settleEnd = revealEnd + settleDuration;
        Batch storage batch = _batches[batchId];
        batch.token0 = token0;
        batch.token1 = token1;
        batch.intentEnd = intentEnd;
        batch.commitEnd = commitEnd;
        batch.revealEnd = revealEnd;
        batch.settleEnd = settleEnd;
        batch.status = BatchStatus.Accepting;
        emit BatchOpened(batchId, token0, token1, intentEnd, commitEnd, revealEnd, settleEnd);
    }

    function submitIntent(uint64 batchId, address sellToken, uint96 sellAmount, uint128 minBuyAmount, uint64 validTo)
        external returns (bytes32 intentId)
    {
        Batch storage batch = _batches[batchId];
        if (batch.status != BatchStatus.Accepting || block.timestamp >= batch.intentEnd) revert InvalidState();
        if (batch.intentCount >= MAX_INTENTS || sellAmount == 0 || minBuyAmount == 0 || validTo < batch.settleEnd) revert InvalidIntent();
        bool zeroForOne;
        if (sellToken == batch.token0) zeroForOne = true;
        else if (sellToken != batch.token1) revert InvalidIntent();
        uint64 nonce = userNonces[msg.sender]++;
        intentId = keccak256(abi.encode(intentDomain, msg.sender, nonce, batchId, sellToken, sellAmount, minBuyAmount, validTo));
        intents[intentId] = Intent(msg.sender, batchId, validTo, sellAmount, minBuyAmount, zeroForOne, IntentStatus.Open);
        _batchIntents[batchId].push(intentId);
        batch.intentCount++;
        batch.activeIntentCount++;
        emit IntentSubmitted(intentId, batchId, msg.sender, zeroForOne, sellAmount, minBuyAmount, validTo, nonce);
    }

    function cancelIntent(bytes32 intentId) external {
        Intent storage intent = intents[intentId];
        if (intent.owner != msg.sender || intent.status != IntentStatus.Open) revert Unauthorized();
        Batch storage batch = _batches[intent.batchId];
        intent.status = IntentStatus.Cancelled;
        batch.activeIntentCount--;
        bool aborted;
        if (block.timestamp >= batch.intentEnd && (batch.status == BatchStatus.Accepting || batch.status == BatchStatus.Finalized)) {
            _abortBatch(intent.batchId);
            aborted = true;
        }
        emit IntentCancelled(intentId, intent.batchId, msg.sender, aborted);
    }

    function depositSolverBond() external payable {
        if (msg.value == 0) revert InsufficientBond();
        solvers[msg.sender].bond += msg.value;
        emit SolverBondChanged(msg.sender, solvers[msg.sender].bond, solvers[msg.sender].locked);
    }

    function withdrawSolverBond(uint256 amount) external nonReentrant {
        Solver storage solver = solvers[msg.sender];
        if (amount == 0 || amount > solver.bond - solver.locked) revert InsufficientBond();
        solver.bond -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit SolverBondChanged(msg.sender, solver.bond, solver.locked);
    }

    function computeCommitment(uint64 batchId, address solver, uint128 priceX96, uint16 rebateBps, bytes32 activeSetHash_, bytes32 routeHash, bytes32 salt)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(intentDomain, batchId, solver, priceX96, rebateBps, activeSetHash_, routeHash, salt));
    }

    function commitSolution(uint64 batchId, bytes32 digest) external {
        Batch storage batch = _batches[batchId];
        if (batch.status != BatchStatus.Accepting || block.timestamp < batch.intentEnd || block.timestamp >= batch.commitEnd || digest == bytes32(0)) revert InvalidState();
        Commitment storage commitment = commitments[batchId][msg.sender];
        if (commitment.digest != bytes32(0) || _batchSolvers[batchId].length >= MAX_SOLVERS) revert LimitExceeded();
        Solver storage solver = solvers[msg.sender];
        if (solver.bond - solver.locked < minimumSolverBond) revert InsufficientBond();
        solver.locked += minimumSolverBond;
        commitment.digest = digest;
        _batchSolvers[batchId].push(msg.sender);
        emit SolutionCommitted(batchId, msg.sender, digest);
    }

    function revealSolution(uint64 batchId, uint128 priceX96, uint16 rebateBps, bytes32 activeSetHash_, bytes32 routeHash, bytes32 salt) external {
        Batch storage batch = _batches[batchId];
        if (batch.status != BatchStatus.Accepting || block.timestamp < batch.commitEnd || block.timestamp >= batch.revealEnd) revert InvalidState();
        if (priceX96 == 0 || priceX96 > MAX_PRICE_X96 || rebateBps > MAX_REBATE_BPS) revert InvalidSolution();
        Commitment storage commitment = commitments[batchId][msg.sender];
        if (commitment.digest == bytes32(0) || commitment.revealed || commitment.digest != computeCommitment(batchId, msg.sender, priceX96, rebateBps, activeSetHash_, routeHash, salt)) revert InvalidCommitment();
        bytes32 currentSetHash = activeSetHash(batchId);
        if (activeSetHash_ != currentSetHash || batch.activeIntentCount == 0) revert InvalidSolution();
        uint256 score = scoreSolution(batchId, priceX96, rebateBps);
        bytes32 proof = keccak256(abi.encode(intentDomain, batchId, msg.sender, currentSetHash, priceX96, rebateBps, score, routeHash));
        commitment.priceX96 = priceX96;
        commitment.rebateBps = rebateBps;
        commitment.scoreToken0 = score;
        commitment.revealed = true;
        bool better = batch.bestSolver == address(0) || score > batch.bestScoreToken0 || (score == batch.bestScoreToken0 && uint160(msg.sender) < uint160(batch.bestSolver));
        if (better) {
            batch.bestSolver = msg.sender;
            batch.bestPriceX96 = priceX96;
            batch.bestRebateBps = rebateBps;
            batch.bestScoreToken0 = score;
            batch.bestExecutionDigest = proof;
            batch.bestRouteHash = routeHash;
            batch.activeSetHash = currentSetHash;
        }
        emit SolutionRevealed(batchId, msg.sender, priceX96, rebateBps, score, routeHash, proof);
    }

    function finalizeWinner(uint64 batchId) external {
        Batch storage batch = _batches[batchId];
        if (batch.status != BatchStatus.Accepting || block.timestamp < batch.revealEnd) revert InvalidState();
        address[] storage candidates = _batchSolvers[batchId];
        for (uint256 i; i < candidates.length; ++i) {
            address candidate = candidates[i];
            Commitment storage commitment = commitments[batchId][candidate];
            if (candidate == batch.bestSolver) continue;
            if (commitment.revealed) _unlock(candidate);
            else {
                _slash(batchId, candidate, keccak256("SOLUTION_NOT_REVEALED"));
                solvers[candidate].failed++;
            }
            commitment.resolved = true;
        }
        if (batch.bestSolver == address(0)) {
            batch.status = BatchStatus.Aborted;
            emit BatchFailed(batchId, address(0), keccak256("NO_VALID_SOLUTION"), 0);
            return;
        }
        batch.status = BatchStatus.Finalized;
        emit WinnerFinalized(batchId, batch.bestSolver, batch.bestPriceX96, batch.bestRebateBps, batch.bestScoreToken0, batch.bestRouteHash, batch.bestExecutionDigest);
    }

    function settleBatch(uint64 batchId, bytes32[] calldata intentIds) external nonReentrant {
        Batch storage batch = _batches[batchId];
        if (batch.status != BatchStatus.Finalized || msg.sender != batch.bestSolver || block.timestamp >= batch.settleEnd || intentIds.length != batch.activeIntentCount) revert InvalidState();
        if (activeSetHash(batchId) != batch.activeSetHash) revert InvalidSolution();
        uint256 start0 = IYNXFairFlowToken(batch.token0).balanceOf(address(this));
        uint256 start1 = IYNXFairFlowToken(batch.token1).balanceOf(address(this));
        (uint256[] memory baseBuys, uint256[] memory rebates, SettlementTotals memory totals) = _collectInputs(batchId, intentIds);
        uint256 external0 = totals.output0 > totals.input0 ? totals.output0 - totals.input0 : 0;
        uint256 external1 = totals.output1 > totals.input1 ? totals.output1 - totals.input1 : 0;
        if (external0 != 0) _pullExact(batch.token0, msg.sender, external0);
        if (external1 != 0) _pullExact(batch.token1, msg.sender, external1);
        for (uint256 i; i < intentIds.length; ++i) {
            Intent storage intent = intents[intentIds[i]];
            uint256 totalBuy = baseBuys[i] + rebates[i];
            _pushExact(intent.zeroForOne ? batch.token1 : batch.token0, intent.owner, totalBuy);
            intent.status = IntentStatus.Settled;
            emit IntentSettled(intentIds[i], batchId, intent.owner, intent.sellAmount, baseBuys[i], rebates[i], totalBuy - intent.minBuyAmount);
        }
        uint256 solverOutput0 = totals.input0 > totals.output0 ? totals.input0 - totals.output0 : 0;
        uint256 solverOutput1 = totals.input1 > totals.output1 ? totals.input1 - totals.output1 : 0;
        if (solverOutput0 != 0) _pushExact(batch.token0, msg.sender, solverOutput0);
        if (solverOutput1 != 0) _pushExact(batch.token1, msg.sender, solverOutput1);
        if (IYNXFairFlowToken(batch.token0).balanceOf(address(this)) != start0 || IYNXFairFlowToken(batch.token1).balanceOf(address(this)) != start1) revert TransferFailed();
        batch.status = BatchStatus.Settled;
        batch.activeIntentCount = 0;
        commitments[batchId][msg.sender].resolved = true;
        _unlock(msg.sender);
        solvers[msg.sender].completed++;
        _emitBatchSettled(batchId, totals, external0, external1, solverOutput0, solverOutput1);
    }

    function proveWinningSolverSelfTrade(uint64 batchId, bytes32 intentId) external {
        Batch storage batch = _batches[batchId];
        Intent storage intent = intents[intentId];
        if (batch.status != BatchStatus.Finalized || intent.batchId != batchId || intent.status != IntentStatus.Open || intent.owner != batch.bestSolver) revert InvalidSolution();
        address solver = batch.bestSolver;
        uint256 amount = _slash(batchId, solver, keccak256("PROVEN_DIRECT_SELF_TRADE"));
        commitments[batchId][solver].resolved = true;
        batch.status = BatchStatus.Failed;
        solvers[solver].fraud++;
        emit BatchFailed(batchId, solver, keccak256("PROVEN_DIRECT_SELF_TRADE"), amount);
    }

    function timeoutBatch(uint64 batchId) external {
        Batch storage batch = _batches[batchId];
        if (batch.status != BatchStatus.Finalized || block.timestamp < batch.settleEnd) revert InvalidState();
        address solver = batch.bestSolver;
        uint256 amount = _slash(batchId, solver, keccak256("SETTLEMENT_TIMEOUT"));
        commitments[batchId][solver].resolved = true;
        batch.status = BatchStatus.Failed;
        solvers[solver].failed++;
        emit BatchFailed(batchId, solver, keccak256("SETTLEMENT_TIMEOUT"), amount);
    }

    function withdrawTreasuryCredit() external nonReentrant {
        if (msg.sender != treasury || treasuryCredit == 0) revert Unauthorized();
        uint256 amount = treasuryCredit;
        treasuryCredit = 0;
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit TreasuryWithdrawn(treasury, amount);
    }

    function activeSetHash(uint64 batchId) public view returns (bytes32 digest) {
        bytes32[] storage ids = _batchIntents[batchId];
        digest = keccak256(abi.encode(intentDomain, batchId));
        for (uint256 i; i < ids.length; ++i) if (intents[ids[i]].status == IntentStatus.Open) digest = keccak256(abi.encode(digest, ids[i]));
    }

    function scoreSolution(uint64 batchId, uint128 priceX96, uint16 rebateBps) public view returns (uint256 scoreToken0) {
        if (priceX96 == 0 || priceX96 > MAX_PRICE_X96 || rebateBps > MAX_REBATE_BPS) revert InvalidSolution();
        bytes32[] storage ids = _batchIntents[batchId];
        uint256 active;
        for (uint256 i; i < ids.length; ++i) {
            Intent storage intent = intents[ids[i]];
            if (intent.status != IntentStatus.Open) continue;
            active++;
            (, , uint256 totalBuy) = _output(intent, priceX96, rebateBps);
            if (totalBuy < intent.minBuyAmount) revert InvalidSolution();
            uint256 improvement = totalBuy - intent.minBuyAmount;
            scoreToken0 += intent.zeroForOne ? improvement * Q96 / priceX96 : improvement;
        }
        if (active == 0) revert InvalidSolution();
    }

    function batchIntentIds(uint64 batchId) external view returns (bytes32[] memory) { return _batchIntents[batchId]; }
    function batchSolvers(uint64 batchId) external view returns (address[] memory) { return _batchSolvers[batchId]; }
    function batchSchedule(uint64 batchId) external view returns (address token0, address token1, uint64 intentEnd, uint64 commitEnd, uint64 revealEnd, uint64 settleEnd, uint32 intentCount, uint32 activeIntentCount, BatchStatus status) {
        Batch storage batch = _batches[batchId];
        return (batch.token0, batch.token1, batch.intentEnd, batch.commitEnd, batch.revealEnd, batch.settleEnd, batch.intentCount, batch.activeIntentCount, batch.status);
    }
    function batchWinner(uint64 batchId) external view returns (address solver, uint128 priceX96, uint16 rebateBps, uint256 scoreToken0, bytes32 routeHash, bytes32 bestExecutionDigest, bytes32 activeSetHash_) {
        Batch storage batch = _batches[batchId];
        return (batch.bestSolver, batch.bestPriceX96, batch.bestRebateBps, batch.bestScoreToken0, batch.bestRouteHash, batch.bestExecutionDigest, batch.activeSetHash);
    }
    function solverReputation(address solverAddress) external view returns (int256) {
        Solver storage solver = solvers[solverAddress];
        return int256(uint256(solver.completed)) * 100 - int256(uint256(solver.failed)) * 25 - int256(uint256(solver.fraud)) * 100;
    }

    function _output(Intent storage intent, uint128 priceX96, uint16 rebateBps) private view returns (uint256 baseBuy, uint256 rebate, uint256 totalBuy) {
        baseBuy = intent.zeroForOne ? uint256(intent.sellAmount) * priceX96 / Q96 : uint256(intent.sellAmount) * Q96 / priceX96;
        rebate = baseBuy * rebateBps / 10_000;
        totalBuy = baseBuy + rebate;
    }

    function _collectInputs(uint64 batchId, bytes32[] calldata intentIds)
        private returns (uint256[] memory baseBuys, uint256[] memory rebates, SettlementTotals memory totals)
    {
        Batch storage batch = _batches[batchId];
        baseBuys = new uint256[](intentIds.length);
        rebates = new uint256[](intentIds.length);
        for (uint256 i; i < intentIds.length; ++i) {
            Intent storage intent = intents[intentIds[i]];
            if (intent.status != IntentStatus.Open || intent.batchId != batchId || block.timestamp > intent.validTo || intent.owner == msg.sender) revert InvalidIntent();
            for (uint256 j; j < i; ++j) if (intentIds[j] == intentIds[i]) revert InvalidIntent();
            (uint256 baseBuy, uint256 rebate, uint256 totalBuy) = _output(intent, batch.bestPriceX96, batch.bestRebateBps);
            if (totalBuy < intent.minBuyAmount) revert InvalidSolution();
            baseBuys[i] = baseBuy;
            rebates[i] = rebate;
            if (intent.zeroForOne) {
                totals.input0 += intent.sellAmount;
                totals.output1 += totalBuy;
                _pullExact(batch.token0, intent.owner, intent.sellAmount);
            } else {
                totals.input1 += intent.sellAmount;
                totals.output0 += totalBuy;
                _pullExact(batch.token1, intent.owner, intent.sellAmount);
            }
        }
    }

    function _emitBatchSettled(uint64 batchId, SettlementTotals memory totals, uint256 external0, uint256 external1, uint256 solverOutput0, uint256 solverOutput1) private {
        Batch storage batch = _batches[batchId];
        emit BatchSettled(batchId, msg.sender, totals.input0, totals.input1, totals.output0, totals.output1, external0, external1, solverOutput0, solverOutput1, batch.bestExecutionDigest);
    }

    function _abortBatch(uint64 batchId) private {
        Batch storage batch = _batches[batchId];
        batch.status = BatchStatus.Aborted;
        address[] storage candidates = _batchSolvers[batchId];
        for (uint256 i; i < candidates.length; ++i) {
            Commitment storage commitment = commitments[batchId][candidates[i]];
            if (!commitment.resolved) {
                commitment.resolved = true;
                _unlock(candidates[i]);
            }
        }
    }

    function _unlock(address solverAddress) private {
        Solver storage solver = solvers[solverAddress];
        solver.locked -= minimumSolverBond;
        emit SolverBondChanged(solverAddress, solver.bond, solver.locked);
    }

    function _slash(uint64 batchId, address solverAddress, bytes32 reason) private returns (uint256 amount) {
        Solver storage solver = solvers[solverAddress];
        amount = minimumSolverBond;
        solver.locked -= amount;
        solver.bond -= amount;
        treasuryCredit += amount;
        emit SolverSlashed(batchId, solverAddress, reason, amount);
        emit SolverBondChanged(solverAddress, solver.bond, solver.locked);
    }

    function _pullExact(address token, address from, uint256 amount) private {
        uint256 beforeBalance = IYNXFairFlowToken(token).balanceOf(address(this));
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IYNXFairFlowToken.transferFrom, (from, address(this), amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))) || IYNXFairFlowToken(token).balanceOf(address(this)) - beforeBalance != amount) revert TransferFailed();
    }

    function _pushExact(address token, address to, uint256 amount) private {
        uint256 beforeRecipient = IYNXFairFlowToken(token).balanceOf(to);
        uint256 beforeContract = IYNXFairFlowToken(token).balanceOf(address(this));
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IYNXFairFlowToken.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))) || IYNXFairFlowToken(token).balanceOf(to) - beforeRecipient != amount || beforeContract - IYNXFairFlowToken(token).balanceOf(address(this)) != amount) revert TransferFailed();
    }
}
