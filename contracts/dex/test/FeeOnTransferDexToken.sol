// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Adversarial token used to prove the router fails closed for taxed input.
contract FeeOnTransferDexToken {
    string public constant name = "Fee Token";
    string public constant symbol = "FEE";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    function mint(address to, uint256 amount) external { totalSupply += amount; balanceOf[to] += amount; emit Transfer(address(0), to, amount); }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; }
    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) { uint256 permitted=allowance[from][msg.sender]; if(permitted!=type(uint256).max) allowance[from][msg.sender]=permitted-amount; _transfer(from,to,amount); return true; }
    function _transfer(address from,address to,uint256 amount) private { uint256 fee=amount/100; balanceOf[from]-=amount; balanceOf[to]+=amount-fee; totalSupply-=fee; emit Transfer(from,to,amount-fee); emit Transfer(from,address(0),fee); }
}
