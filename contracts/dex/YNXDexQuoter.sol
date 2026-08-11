// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IYNXDexRouterQuotes {
    function quoteExactInput(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function quoteExactOutput(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts);
}

/// @notice Stable read-only quoting surface separated from transaction routing.
/// It delegates to the exact Router arithmetic so clients cannot drift from
/// execution semantics, and it never holds approvals or assets.
contract YNXDexQuoter {
    address public immutable router;
    error InvalidRouter();

    constructor(address router_) {
        if (router_ == address(0)) revert InvalidRouter();
        router = router_;
    }

    function quoteExactInput(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        return IYNXDexRouterQuotes(router).quoteExactInput(amountIn, path);
    }

    function quoteExactOutput(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts) {
        return IYNXDexRouterQuotes(router).quoteExactOutput(amountOut, path);
    }
}
