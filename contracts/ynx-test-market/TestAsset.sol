// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Controlled, valueless QA inventory for YNX Testnet 6423 only.
contract TestAsset {
    bytes32 public constant TEST_MARKER = bytes32("YNX-6423-TEST-ONLY");
    uint256 public constant CHAIN_ID = 6423;
    uint8 public constant decimals = 6;

    string public name;
    string public symbol;
    uint256 public immutable cap;
    address public admin;
    address public issuer;
    bool public paused;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event IssuerChanged(address indexed previousIssuer, address indexed nextIssuer);
    event Paused(bool paused);

    error Unauthorized();
    error Invalid();
    error Limit();

    modifier onlyAdmin() { if (msg.sender != admin) revert Unauthorized(); _; }
    modifier onlyIssuer() { if (msg.sender != issuer) revert Unauthorized(); _; }
    modifier active() { if (paused) revert Unauthorized(); _; }

    constructor(string memory name_, string memory symbol_, uint256 cap_, address admin_, address issuer_) {
        if (block.chainid != CHAIN_ID || admin_ == address(0) || issuer_ == address(0) || cap_ == 0) revert Invalid();
        name = name_;
        symbol = symbol_;
        cap = cap_;
        admin = admin_;
        issuer = issuer_;
    }

    function setIssuer(address next) external onlyAdmin {
        if (next == address(0)) revert Invalid();
        emit IssuerChanged(issuer, next);
        issuer = next;
    }

    function setPaused(bool value) external onlyAdmin {
        paused = value;
        emit Paused(value);
    }

    function mint(address to, uint256 amount) external onlyIssuer active {
        if (to == address(0) || amount == 0) revert Invalid();
        if (amount > cap - totalSupply) revert Limit();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function redeem(uint256 amount) external active {
        _burn(msg.sender, amount);
    }

    function redeemFrom(address owner, uint256 amount) external onlyIssuer active {
        _spendAllowance(owner, msg.sender, amount);
        _burn(owner, amount);
    }

    function transfer(address to, uint256 amount) external active returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external active returns (bool) {
        if (spender == address(0)) revert Invalid();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external active returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    function _spendAllowance(address owner, address spender, uint256 amount) internal {
        uint256 allowed = allowance[owner][spender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert Limit();
            allowance[owner][spender] = allowed - amount;
            emit Approval(owner, spender, allowed - amount);
        }
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert Invalid();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert Limit();
        balanceOf[from] = balance - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _burn(address owner, uint256 amount) internal {
        if (amount == 0) revert Invalid();
        uint256 balance = balanceOf[owner];
        if (balance < amount) revert Limit();
        balanceOf[owner] = balance - amount;
        totalSupply -= amount;
        emit Transfer(owner, address(0), amount);
    }
}
