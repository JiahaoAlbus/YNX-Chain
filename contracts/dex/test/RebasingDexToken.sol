// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Adversarial balance-mutating token used only for unsupported-token tests.
contract RebasingDexToken {
    string public constant name = "Rebasing Token";
    string public constant symbol = "RBS";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    function mint(address to,uint256 amount) external { totalSupply+=amount;balanceOf[to]+=amount;emit Transfer(address(0),to,amount); }
    function slash(address account,uint256 amount) external { balanceOf[account]-=amount;totalSupply-=amount;emit Transfer(account,address(0),amount); }
    function approve(address spender,uint256 amount) external returns(bool){allowance[msg.sender][spender]=amount;emit Approval(msg.sender,spender,amount);return true;}
    function transfer(address to,uint256 amount) external returns(bool){balanceOf[msg.sender]-=amount;balanceOf[to]+=amount;emit Transfer(msg.sender,to,amount);return true;}
    function transferFrom(address from,address to,uint256 amount) external returns(bool){uint256 permitted=allowance[from][msg.sender];if(permitted!=type(uint256).max)allowance[from][msg.sender]=permitted-amount;balanceOf[from]-=amount;balanceOf[to]+=amount;emit Transfer(from,to,amount);return true;}
}
