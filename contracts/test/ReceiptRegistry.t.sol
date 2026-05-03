// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

contract ReceiptRegistryTest is Test {
    ReceiptRegistry registry;
    uint256 signerKey = 0xA11CE;
    address signerAddr;

    function setUp() public {
        registry = new ReceiptRegistry();
        signerAddr = vm.addr(signerKey);
    }

    function test_AnchorEmitsEvent() public {
        bytes32 root = keccak256("root-1");
        vm.prank(signerAddr);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ReceiptRegistry.ReceiptBatchAnchored(
            keccak256(abi.encode(signerAddr, root)),
            signerAddr,
            root,
            5,
            "batch-1"
        );
        registry.anchor(root, 5, "batch-1");
    }

    function test_AnchorRecordsState() public {
        bytes32 root = keccak256("root-2");
        vm.prank(signerAddr);
        bytes32 id = registry.anchor(root, 3, "batch-2");

        (
            address recordedSigner,
            bytes32 recordedRoot,
            uint64 receiptCount,
            uint64 anchoredAt,
            string memory descriptor
        ) = registry.anchors(id);

        assertEq(recordedSigner, signerAddr);
        assertEq(recordedRoot, root);
        assertEq(receiptCount, 3);
        assertGt(anchoredAt, 0);
        assertEq(descriptor, "batch-2");
        assertEq(registry.anchorCount(signerAddr), 1);
    }

    function test_RejectEmptyBatch() public {
        vm.prank(signerAddr);
        vm.expectRevert(ReceiptRegistry.EmptyBatch.selector);
        registry.anchor(keccak256("x"), 0, "");
    }

    function test_RejectDuplicateAnchor() public {
        bytes32 root = keccak256("root-3");
        vm.startPrank(signerAddr);
        bytes32 id = registry.anchor(root, 1, "");
        vm.expectRevert(
            abi.encodeWithSelector(ReceiptRegistry.AnchorAlreadyExists.selector, id)
        );
        registry.anchor(root, 1, "");
        vm.stopPrank();
    }

    function test_VerifyReceiptInTreeOfOne() public {
        bytes32 digest = keccak256("receipt-A");
        bytes32 root = digest;

        vm.prank(signerAddr);
        bytes32 anchorId = registry.anchor(root, 1, "");

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes32[] memory emptyProof = new bytes32[](0);
        bool ok = registry.verifyReceipt(anchorId, digest, emptyProof, sig);
        assertTrue(ok);
    }

    function test_VerifyReceiptInTreeOfTwo() public {
        bytes32 a = keccak256("A");
        bytes32 b = keccak256("B");
        bytes32 root = a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));

        vm.prank(signerAddr);
        bytes32 anchorId = registry.anchor(root, 2, "");

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, a);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = b;

        bool ok = registry.verifyReceipt(anchorId, a, proof, sig);
        assertTrue(ok);
    }

    function test_RejectsWrongSigner() public {
        bytes32 digest = keccak256("receipt-X");
        bytes32 root = digest;

        vm.prank(signerAddr);
        bytes32 anchorId = registry.anchor(root, 1, "");

        uint256 otherKey = 0xB0B;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes32[] memory emptyProof = new bytes32[](0);
        bool ok = registry.verifyReceipt(anchorId, digest, emptyProof, sig);
        assertFalse(ok);
    }

    function test_RejectsTamperedDigest() public {
        bytes32 digest = keccak256("receipt-Y");
        bytes32 root = digest;

        vm.prank(signerAddr);
        bytes32 anchorId = registry.anchor(root, 1, "");

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes32[] memory emptyProof = new bytes32[](0);
        bool ok = registry.verifyReceipt(
            anchorId,
            keccak256("different"),
            emptyProof,
            sig
        );
        assertFalse(ok);
    }
}
