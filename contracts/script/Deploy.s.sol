// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

contract Deploy is Script {
    function run() external returns (ReceiptRegistry registry) {
        string memory raw = vm.envString("ZEROG_CHAIN_PRIVATE_KEY");
        if (bytes(raw).length == 64) {
            raw = string.concat("0x", raw);
        }
        uint256 pk = vm.parseUint(raw);
        vm.startBroadcast(pk);
        registry = new ReceiptRegistry();
        vm.stopBroadcast();
        console.log("ReceiptRegistry deployed at:", address(registry));
    }
}
