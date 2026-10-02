// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITestERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function TEST_MARKER() external view returns (bytes32);
    function symbol() external view returns (string memory);
    function name() external view returns (string memory);
    function cap() external view returns (uint256);
}

/// @notice Bilateral, atomic Testnet-only stock-versus-tUSD settlement.
contract TestDvP {
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ORDER_TYPEHASH = keccak256("Order(address seller,address buyer,uint256 shares,uint256 quote,uint256 expiry,uint256 sellerNonce,uint256 buyerNonce,bytes32 salt)");
    bytes32 private constant NAME_HASH = keccak256("YNX Test Market DvP");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant SECP256K1_HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 private constant INVALIDATED = bytes32(type(uint256).max);

    ITestERC20 public immutable stock;
    ITestERC20 public immutable tusd;
    bytes32 public immutable stockCodeHash;
    bytes32 public immutable tusdCodeHash;
    address public immutable feeRecipient;
    uint256 public immutable feeBps;
    mapping(bytes32 => uint256) public filledShares;
    mapping(bytes32 => bool) public cancelled;
    mapping(address => mapping(uint256 => bytes32)) public sellerNonceOrder;
    mapping(address => mapping(uint256 => bytes32)) public buyerNonceOrder;
    uint256 private entered;

    struct Order {
        address seller;
        address buyer;
        uint256 shares;
        uint256 quote;
        uint256 expiry;
        uint256 sellerNonce;
        uint256 buyerNonce;
        bytes32 salt;
    }

    struct Balances {
        uint256 stockSeller;
        uint256 stockBuyer;
        uint256 cashBuyer;
        uint256 cashSeller;
        uint256 cashFeeRecipient;
    }

    event Filled(bytes32 indexed orderHash, address indexed seller, address indexed buyer, uint256 shares, uint256 quote, uint256 fee, uint256 cumulativeShares);
    event Cancelled(bytes32 indexed orderHash, address indexed caller);
    event NonceInvalidated(address indexed caller, bool seller, uint256 nonce);

    error Invalid();
    error Unauthorized();
    error Expired();
    error AlreadyUsed();
    error TransferFailed();

    constructor(address stock_, address tusd_, bytes32 stockCodeHash_, bytes32 tusdCodeHash_, address feeRecipient_, uint256 feeBps_) {
        if (block.chainid != 6423 || stock_ == address(0) || tusd_ == address(0) || stock_ == tusd_ ||
            feeRecipient_ == address(0) || feeBps_ > 500 || stockCodeHash_ == bytes32(0) || tusdCodeHash_ == bytes32(0) ||
            stock_.codehash != stockCodeHash_ || tusd_.codehash != tusdCodeHash_) revert Invalid();
        stock = ITestERC20(stock_);
        tusd = ITestERC20(tusd_);
        stockCodeHash = stockCodeHash_;
        tusdCodeHash = tusdCodeHash_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        if (stock.TEST_MARKER() != bytes32("YNX-6423-TEST-ONLY") || tusd.TEST_MARKER() != bytes32("YNX-6423-TEST-ONLY") ||
            stock.decimals() != 6 || tusd.decimals() != 6 ||
            keccak256(bytes(stock.symbol())) != keccak256("TEST-AAPL") ||
            keccak256(bytes(tusd.symbol())) != keccak256("tUSD") ||
            keccak256(bytes(stock.name())) != keccak256("YNX Test AAPL") ||
            keccak256(bytes(tusd.name())) != keccak256("YNX Test USD") ||
            stock.cap() != 1_000_000_000_000 || tusd.cap() != 10_000_000_000_000) revert Invalid();
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function orderHash(Order memory order) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(ORDER_TYPEHASH, order.seller, order.buyer, order.shares, order.quote,
            order.expiry, order.sellerNonce, order.buyerNonce, order.salt));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function cancel(Order calldata order) external {
        if (msg.sender != order.seller && msg.sender != order.buyer) revert Unauthorized();
        bytes32 digest = orderHash(order);
        cancelled[digest] = true;
        emit Cancelled(digest, msg.sender);
    }

    function invalidateNonce(uint256 nonce, bool asSeller) external {
        mapping(uint256 => bytes32) storage slots = asSeller ? sellerNonceOrder[msg.sender] : buyerNonceOrder[msg.sender];
        if (slots[nonce] != bytes32(0)) revert AlreadyUsed();
        slots[nonce] = INVALIDATED;
        emit NonceInvalidated(msg.sender, asSeller, nonce);
    }

    function fill(Order calldata order, uint256 shares, bytes calldata sellerSignature, bytes calldata buyerSignature) external {
        if (entered != 0) revert AlreadyUsed();
        entered = 1;
        if (order.seller == address(0) || order.buyer == address(0) || order.seller == order.buyer ||
            feeRecipient == order.seller || feeRecipient == order.buyer ||
            order.shares == 0 || order.quote == 0 || shares == 0) revert Invalid();
        if (address(stock).codehash != stockCodeHash || address(tusd).codehash != tusdCodeHash) revert Invalid();
        if (block.timestamp > order.expiry) revert Expired();
        bytes32 digest = orderHash(order);
        if (cancelled[digest] || _recover(digest, sellerSignature) != order.seller ||
            _recover(digest, buyerSignature) != order.buyer) revert Unauthorized();
        if (sellerNonceOrder[order.seller][order.sellerNonce] != bytes32(0) &&
            sellerNonceOrder[order.seller][order.sellerNonce] != digest) revert AlreadyUsed();
        if (buyerNonceOrder[order.buyer][order.buyerNonce] != bytes32(0) &&
            buyerNonceOrder[order.buyer][order.buyerNonce] != digest) revert AlreadyUsed();
        uint256 beforeShares = filledShares[digest];
        if (beforeShares + shares > order.shares) revert AlreadyUsed();
        uint256 afterShares = beforeShares + shares;
        uint256 quoteDue = (order.quote * afterShares / order.shares) - (order.quote * beforeShares / order.shares);
        uint256 feeDue = (order.quote * afterShares / order.shares * feeBps / 10000) -
            (order.quote * beforeShares / order.shares * feeBps / 10000);
        if (quoteDue == 0) revert Invalid();
        sellerNonceOrder[order.seller][order.sellerNonce] = digest;
        buyerNonceOrder[order.buyer][order.buyerNonce] = digest;
        filledShares[digest] = afterShares;
        Balances memory beforeBalance = _balances(order);
        _safeTransferFrom(stock, order.seller, order.buyer, shares);
        _safeTransferFrom(tusd, order.buyer, order.seller, quoteDue);
        if (feeDue != 0) _safeTransferFrom(tusd, order.buyer, feeRecipient, feeDue);
        Balances memory afterBalance = _balances(order);
        if (beforeBalance.stockSeller < shares || afterBalance.stockSeller != beforeBalance.stockSeller - shares ||
            afterBalance.stockBuyer != beforeBalance.stockBuyer + shares ||
            beforeBalance.cashBuyer < quoteDue + feeDue || afterBalance.cashBuyer != beforeBalance.cashBuyer - quoteDue - feeDue ||
            afterBalance.cashSeller != beforeBalance.cashSeller + quoteDue ||
            afterBalance.cashFeeRecipient != beforeBalance.cashFeeRecipient + feeDue) revert TransferFailed();
        emit Filled(digest, order.seller, order.buyer, shares, quoteDue, feeDue, afterShares);
        entered = 0;
    }

    function _balances(Order calldata order) private view returns (Balances memory result) {
        result.stockSeller = stock.balanceOf(order.seller);
        result.stockBuyer = stock.balanceOf(order.buyer);
        result.cashBuyer = tusd.balanceOf(order.buyer);
        result.cashSeller = tusd.balanceOf(order.seller);
        result.cashFeeRecipient = tusd.balanceOf(feeRecipient);
    }

    function _safeTransferFrom(ITestERC20 token, address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = address(token).call(abi.encodeCall(ITestERC20.transferFrom, (from, to, amount)));
        if (!success || (data.length != 0 && (data.length != 32 || !abi.decode(data, (bool))))) revert TransferFailed();
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert Invalid();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1_HALF_N || v < 27 || v > 28) revert Invalid();
        return ecrecover(digest, v, r, s);
    }
}
