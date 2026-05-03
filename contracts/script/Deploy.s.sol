// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

contract Deploy is Script {
    function run() external returns (ReceiptRegistry registry) {
        uint256 pk = vm.envUint("ZEROG_CHAIN_PRIVATE_KEY");
        vm.startBroadcast(pk);
        registry = new ReceiptRegistry();
        vm.stopBroadcast();
        console.log("ReceiptRegistry deployed at:", address(registry));
    }
}
