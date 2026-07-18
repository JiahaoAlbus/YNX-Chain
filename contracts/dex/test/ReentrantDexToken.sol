// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ReentrantDexToken {
    string public constant name = "Reentrant test token";
    string public constant symbol = "REENT";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public attackTarget;
    bytes public attackData;
    bool public attackEnabled;

    function mint(address to, uint256 amount) external { totalSupply += amount; balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function configureAttack(address target, bytes calldata data, bool enabled) external { attackTarget = target; attackData = data; attackEnabled = enabled; }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount;
        if (attackEnabled && msg.sender == attackTarget) {
            (bool ok,) = attackTarget.call(attackData);
            require(ok, "reentrant callback rejected");
        }
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) allowance[from][msg.sender] = permitted - amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}
