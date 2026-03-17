// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.6.0
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract BlockJarTip is Ownable {
    event TipReceived(address indexed sender, uint256 amount, string message);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function tip(string calldata message) external payable {
        require(msg.value > 0, "Tip amount must be greater than zero");

        if (bytes(message).length > 0) {
            // Store the message on the blockchain (for demonstration purposes, we simply emit an event)
            emit TipReceived(msg.sender, msg.value, message);
        } else {
            emit TipReceived(msg.sender, msg.value, "No message");
        }
    }

    // This function allows the owner of the contract to withdraw all the funds that have been tipped to the contract.
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        payable(owner()).transfer(balance);
    }
}
