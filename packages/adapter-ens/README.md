# @openacid/adapter-ens

> **Mirror [@openacid/acid](https://www.npmjs.com/package/@openacid/acid) receipts to ENS text records.**
> Any third party can resolve `<your-name>.eth` and read the latest receipt — no library install required.

`EnsReceiptMirror` plugs into `receipted()`'s `onReceipt` callback. Every emitted receipt updates three text records on a name you control:

- `receipt.latest` — CID of the most recent receipt
- `receipt.head` — `callId` of the receipt at the head of the agent's chain
- `agent.signer` — the EIP-712 signature (one-time, pinned)

Pair with the receipt blob persisted on 0G Storage and you have an audit trail anyone can verify with two lookups: ENS resolver → receipt blob → `ecrecover`.

## Install

```bash
npm i @openacid/adapter-ens @openacid/acid viem
```

## Usage

```ts
import { createWalletClient, http } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { EnsReceiptMirror } from '@openacid/adapter-ens'
import { receipted } from '@openacid/acid'

const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC),
  account: privateKeyToAccount(process.env.ENS_PRIVATE_KEY as `0x${string}`),
})

const mirror = new EnsReceiptMirror({
  walletClient,
  resolver: '0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5',  // Sepolia public resolver
  subname: 'openacid.eth',                                  // your registered name
})

const action = receipted({
  storage,
  signer,
  chain: { chainId: 16602 },
  onReceipt: mirror.onReceipt,        // ← every receipt now lands on chain
})(saga)

await action(args)
```

After each receipt, three text records are written via `setText` on the resolver. The first call also publishes `agent.signer` (skipped on subsequent calls).

## Third-party verification

The whole point: you do **not** need to install this library to verify a receipt. Any ENS resolver lookup works.

```bash
# Read the latest receipt CID for the agent
cast call 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5 \
  "text(bytes32,string)(string)" \
  $(cast namehash openacid.eth) "receipt.latest" \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com
# → "0xa1b4a08643877b30..."

# Pull the receipt blob from 0G Storage by that root hash, then verifyReceipt(...)
```

This satisfies the **ENS Creative track** narrative: a verifiable activity log via DNS-style ENS resolution.

## Configuration

```ts
new EnsReceiptMirror({
  walletClient,                       // viem wallet on the network where ENS lives
  resolver: '0x...',                  // a public resolver supporting setText
  subname: 'agent.openacid.eth',      // your registered (sub)name

  keys: {                             // optional — override record key names
    latest: 'receipt.latest',
    head:   'receipt.head',
    signer: 'agent.signer',
  },

  publishSignerOnce: true,            // optional — skip writing agent.signer on later calls
})
```

The mirror's `onReceipt` is `async` — it submits 1–3 `setText` transactions per receipt. Use the `EnsReceiptMirror` only when you want the audit trail public; otherwise just persist receipts to your storage adapter.

## Live deployment

The reference agent in this repo mirrors to **`openacid.eth`** on Sepolia ENS. Inspect the live records:

- ENS app: [sepolia.app.ens.domains/openacid.eth](https://sepolia.app.ens.domains/openacid.eth)
- Resolver: `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`
- Records: `receipt.latest`, `receipt.head`, `agent.signer`, `description`

## Pre-requisites

- An **ENS name** you own on the network you wire (Sepolia for testing, mainnet for production). Register at [app.ens.domains](https://app.ens.domains).
- A **public resolver** set on that name. Most names use the network's standard public resolver — see ENS docs for the address per network.
- A **wallet** funded with enough ETH to pay for `setText` transactions (each is ~21k gas + small calldata).

## Honest limitations

- Each receipt costs **3 setText transactions** (or 2 after the first call when `publishSignerOnce: true`). On mainnet that's real money — keep this for receipts you actually want public.
- The resolver typically takes **one block** (~12s on Sepolia, ~12s on mainnet) before reads reflect the new value. Polling code should accommodate that.
- The mirror is **fire-and-forget at the protocol level** — if `setText` fails for some reason, the wrapped action still succeeds (the receipt is in your storage). The agent caller catches and logs mirror errors.

## License

MIT — part of the [openacid](https://www.npmjs.com/package/@openacid/acid) library.
