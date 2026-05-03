// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ReceiptRegistry — anchors OpenACID receipt batches on 0G Chain.
/// @notice Each batch commits to a merkle root over a set of EIP-712 signed
///         OpenACID receipts. Verifiers look up the root, walk the proof, and
///         ecrecover the receipt struct against the agent's signing key.
/// @dev    The registry deliberately stores no receipt content — only the
///         root + signer + metadata. Receipt blobs live in 0G Storage.
contract ReceiptRegistry {
    struct Anchor {
        address signer;
        bytes32 root;
        uint64 receiptCount;
        uint64 anchoredAt;
        string descriptor;
    }

    /// @dev anchorId => Anchor. anchorId = keccak256(signer, root)
    mapping(bytes32 => Anchor) public anchors;

    /// @dev Per-signer monotonic counter (ordering is informational, not
    ///      enforced — out-of-order anchors are valid).
    mapping(address => uint64) public anchorCount;

    event ReceiptBatchAnchored(
        bytes32 indexed anchorId,
        address indexed signer,
        bytes32 indexed root,
        uint64 receiptCount,
        string descriptor
    );

    error AnchorAlreadyExists(bytes32 anchorId);
    error InvalidSignature();
    error EmptyBatch();

    /// @notice Anchor a receipt batch. The caller is the agent whose signer
    ///         attests to all receipts in the batch.
    /// @param  root          merkle root over receipt EIP-712 digests
    /// @param  receiptCount  number of receipts under this root
    /// @param  descriptor    human-readable batch label (e.g., a CID list)
    function anchor(bytes32 root, uint64 receiptCount, string calldata descriptor)
        external
        returns (bytes32 anchorId)
    {
        if (receiptCount == 0) revert EmptyBatch();
        anchorId = keccak256(abi.encode(msg.sender, root));
        if (anchors[anchorId].signer != address(0)) {
            revert AnchorAlreadyExists(anchorId);
        }

        anchors[anchorId] = Anchor({
            signer: msg.sender,
            root: root,
            receiptCount: receiptCount,
            anchoredAt: uint64(block.timestamp),
            descriptor: descriptor
        });
        unchecked {
            anchorCount[msg.sender] += 1;
        }

        emit ReceiptBatchAnchored(anchorId, msg.sender, root, receiptCount, descriptor);
    }

    /// @notice Verify a receipt against an anchored batch.
    /// @param  anchorId        identifier returned by `anchor`
    /// @param  receiptDigest   the EIP-712 typed-data digest of the receipt
    /// @param  proof           merkle proof leaves (sorted-pair scheme)
    /// @param  signature       65-byte signature over receiptDigest
    /// @return ok              true if the digest is in the tree AND the
    ///                         signature recovers to the anchor's signer.
    function verifyReceipt(
        bytes32 anchorId,
        bytes32 receiptDigest,
        bytes32[] calldata proof,
        bytes calldata signature
    )
        external
        view
        returns (bool ok)
    {
        Anchor memory a = anchors[anchorId];
        if (a.signer == address(0)) return false;
        if (!_verifyMerkle(receiptDigest, proof, a.root)) return false;

        address recovered = _recover(receiptDigest, signature);
        if (recovered == address(0)) revert InvalidSignature();
        return recovered == a.signer;
    }

    function _verifyMerkle(bytes32 leaf, bytes32[] calldata proof, bytes32 root)
        private
        pure
        returns (bool)
    {
        bytes32 cur = leaf;
        uint256 len = proof.length;
        for (uint256 i = 0; i < len; ) {
            bytes32 sibling = proof[i];
            cur = cur < sibling
                ? keccak256(abi.encodePacked(cur, sibling))
                : keccak256(abi.encodePacked(sibling, cur));
            unchecked { ++i; }
        }
        return cur == root;
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        return ecrecover(digest, v, r, s);
    }
}
