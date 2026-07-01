// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract YnxResourceMarketEscrow {
    struct Rental {
        address renter;
        address provider;
        uint256 computeUnits;
        uint256 expiresAt;
        uint256 pricePaid;
        bool settled;
    }

    address payable public operator;
    uint256 public nextRentalId;
    mapping(uint256 => Rental) public rentals;

    event RentalOpened(
        uint256 indexed rentalId,
        address indexed renter,
        address indexed provider,
        uint256 computeUnits,
        uint256 expiresAt,
        uint256 pricePaid
    );
    event RentalSettled(uint256 indexed rentalId, address indexed provider, uint256 payout);

    constructor(address payable initialOperator) {
        require(initialOperator != address(0), "zero operator");
        operator = initialOperator;
    }

    function openRental(address provider, uint256 computeUnits, uint256 durationSeconds)
        external
        payable
        returns (uint256 rentalId)
    {
        require(provider != address(0), "zero provider");
        require(computeUnits > 0, "zero compute");
        require(durationSeconds > 0, "zero duration");
        require(msg.value > 0, "YNXT payment required");

        rentalId = ++nextRentalId;
        rentals[rentalId] = Rental({
            renter: msg.sender,
            provider: provider,
            computeUnits: computeUnits,
            expiresAt: block.timestamp + durationSeconds,
            pricePaid: msg.value,
            settled: false
        });

        emit RentalOpened(rentalId, msg.sender, provider, computeUnits, block.timestamp + durationSeconds, msg.value);
    }

    function settleRental(uint256 rentalId) external {
        Rental storage rental = rentals[rentalId];
        require(rental.renter != address(0), "unknown rental");
        require(!rental.settled, "already settled");
        require(msg.sender == rental.provider || msg.sender == operator, "not settlement actor");
        rental.settled = true;
        uint256 payout = rental.pricePaid;
        payable(rental.provider).transfer(payout);
        emit RentalSettled(rentalId, rental.provider, payout);
    }
}
