/**
 * One-shot registration of `openacid.eth` on Sepolia ENS, plus a smoke-test
 * text record write.
 *
 * Reads from .env at repo root:
 *   EVM_PRIVATE_KEY  — funded wallet on Ethereum Sepolia (NOT Base Sepolia)
 *   SEPOLIA_RPC      — defaults to https://ethereum-sepolia-rpc.publicnode.com
 *
 * Usage:
 *   npx tsx scripts/register-ens.ts <label>          # default label "openacid"
 *   npx tsx scripts/register-ens.ts openacid 31536000 # custom 1-year duration
 *
 * The script is idempotent on re-runs: if the name is already owned by you,
 * it skips registration and proceeds to the resolver/text-record phase.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  keccak256,
  encodePacked,
  namehash,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { randomBytes } from "node:crypto";

const REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const ETH_REGISTRAR_CONTROLLER: Address =
  "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968";
const PUBLIC_RESOLVER: Address =
  "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";
const BASE_REGISTRAR: Address =
  "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85";

const CONTROLLER_ABI = [
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "rentPrice",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "string" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [
      {
        components: [
          { name: "base", type: "uint256" },
          { name: "premium", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
  },
  {
    type: "function",
    name: "minCommitmentAge",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxCommitmentAge",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "makeCommitment",
    stateMutability: "pure",
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "data", type: "bytes[]" },
      { name: "reverseRecord", type: "bool" },
      { name: "ownerControlledFuses", type: "uint16" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "owner", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "secret", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "data", type: "bytes[]" },
      { name: "reverseRecord", type: "bool" },
      { name: "ownerControlledFuses", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
] as const;

const RESOLVER_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
] as const;

async function main(): Promise<void> {
  const label = process.argv[2] ?? "openacid";
  const duration = BigInt(process.argv[3] ?? 31_536_000);
  const fullName = `${label}.eth`;

  const pk = process.env.EVM_PRIVATE_KEY;
  if (!pk) throw new Error("EVM_PRIVATE_KEY missing in env");
  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
  );

  const rpc =
    process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpc),
  });
  const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(rpc),
    account,
  });

  log(`signer: ${account.address}`);
  log(`target: ${fullName}`);

  const balance = await publicClient.getBalance({ address: account.address });
  log(`balance: ${(Number(balance) / 1e18).toFixed(6)} Sepolia ETH`);

  const node = namehash(fullName);
  const tokenId = BigInt(keccak256(encodePacked(["string"], [label])));

  const currentOwner = await publicClient.readContract({
    address: BASE_REGISTRAR,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [`0x${tokenId.toString(16).padStart(64, "0")}` as Hex],
  });

  if (
    typeof currentOwner === "string" &&
    currentOwner.toLowerCase() === account.address.toLowerCase()
  ) {
    log(`name is already owned by signer; skipping registration`);
  } else {
    const available = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "available",
      args: [label],
    });
    if (!available) {
      throw new Error(
        `${fullName} is not available on Sepolia (owner ${currentOwner}); pick another label or use the existing owner key`,
      );
    }
    log(`name is available; entering commit/reveal flow`);

    const price = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "rentPrice",
      args: [label, duration],
    });
    const totalCost = price.base + price.premium;
    log(
      `price: base=${price.base}wei premium=${price.premium}wei total=${(Number(totalCost) / 1e18).toFixed(6)} ETH`,
    );

    if (balance < totalCost + parseEther("0.002")) {
      throw new Error(
        `insufficient balance for registration + gas; need ~${((Number(totalCost) + 2e15) / 1e18).toFixed(4)} ETH`,
      );
    }

    const secret =
      `0x${randomBytes(32).toString("hex")}` as Hex;

    const commitment = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "makeCommitment",
      args: [
        label,
        account.address,
        duration,
        secret,
        PUBLIC_RESOLVER,
        [],
        false,
        0,
      ],
    });
    log(`commitment: ${commitment}`);

    const commitTx = await walletClient.writeContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "commit",
      args: [commitment],
    });
    log(`commit tx: ${commitTx}`);
    await publicClient.waitForTransactionReceipt({ hash: commitTx });

    const minAge = await publicClient.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "minCommitmentAge",
    });
    const wait = Number(minAge) + 5;
    log(`waiting ${wait}s for commitment maturation...`);
    await sleep(wait * 1000);

    const registerTx = await walletClient.writeContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "register",
      args: [
        label,
        account.address,
        duration,
        secret,
        PUBLIC_RESOLVER,
        [],
        false,
        0,
      ],
      value: totalCost,
    });
    log(`register tx: ${registerTx}`);
    await publicClient.waitForTransactionReceipt({ hash: registerTx });
    log(`registered ${fullName}`);
  }

  const registryOwner = await publicClient.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  });
  log(`registry owner of ${fullName}: ${registryOwner}`);

  const setResolverTx = await walletClient.writeContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "setResolver",
    args: [node, PUBLIC_RESOLVER],
  });
  log(`setResolver tx: ${setResolverTx}`);
  await publicClient.waitForTransactionReceipt({ hash: setResolverTx });

  const setTextTx = await walletClient.writeContract({
    address: PUBLIC_RESOLVER,
    abi: RESOLVER_ABI,
    functionName: "setText",
    args: [node, "description", "OpenACID — durable execution for AI agents"],
  });
  log(`setText description tx: ${setTextTx}`);
  await publicClient.waitForTransactionReceipt({ hash: setTextTx });

  const readBack = await publicClient.readContract({
    address: PUBLIC_RESOLVER,
    abi: RESOLVER_ABI,
    functionName: "text",
    args: [node, "description"],
  });
  log(`description read-back: "${readBack}"`);

  log(`done`);
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[ens] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[ens] fatal:", err);
  process.exit(1);
});
