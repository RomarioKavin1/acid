ETHGlobal Open Agents - Submission Content


SHORT DESCRIPTION

The missing durability layer for AI agents that hold real money.


DESCRIPTION

The next wave of AI agents isn't answering questions or summarizing documents -- it's executing trades, managing portfolios, routing payments, and interacting with DeFi protocols autonomously. These agents hold real value and take real actions. But the infrastructure layer underneath them is missing something fundamental: the durability primitives that every backend engineer takes for granted.

When a Postgres transaction fails halfway through, the database rolls back cleanly. When a web server receives a duplicate request, idempotency keys prevent double-processing. When a distributed system writes to disk, the WAL guarantees the write survives a crash. Forty years of database research produced four properties -- Atomicity, Consistency, Isolation, Durability -- that make stateful systems reliable. On-chain AI agents have none of them.

The failure modes are predictable and expensive. An agent process crashes mid-broadcast: on restart it re-sends the same transaction, executing the swap twice, paying double gas, over-rotating the portfolio. An LLM planning loop times out waiting for a tool response and re-emits the same call: two concurrent executions race for the same on-chain action. A multi-step DeFi operation completes the approval in step 1 and fails during the swap in step 2: the approval sits on-chain indefinitely, a standing invitation for a phishing exploit. An agent acts on stale price data because nobody enforced a freshness invariant before execution. Every team running production on-chain agents has hit at least three of these in the first month. The fixes are always bespoke -- a Redis lock that doesn't survive a restart, a hash-of-args cache bolted onto the exception handler, a "compensate manually if anything looks wrong" comment in the code. Nobody has shipped the obvious shared library.

openacid is that library.

It exposes four composable higher-order functions, each mapping directly to one of the four classical database guarantees.

saga gives multi-step actions transactional semantics. You declare a sequence of steps and their compensating inverse actions. If step N fails, compensations for steps N-1 through 1 execute automatically in reverse order -- the same pattern as the original Sagas paper from Garcia-Molina and Salem (1987), applied to on-chain agent actions. Saga state is persisted to durable storage after every step, so a crash mid-execution resumes from the last completed step rather than restarting from zero. Compensations are themselves idempotent, so a crash during compensation is also safe.

invariant enforces pre and post predicates at action boundaries. Pre-conditions run before execution and reject the call if violated -- stale price data, insufficient balance, gas cap exceeded. Post-conditions run after execution and verify the outcome matches the expected state -- no orphaned approvals, balance within expected bounds, slippage within tolerance. A failing post-condition is treated identically to a step failure: if a saga is wrapped inside invariant, the post-condition violation triggers the saga's compensation chain automatically. The library ships a built-in invariant library covering the most common DeFi invariants: noOrphanAllowances, balanceWithinBound, gasUnderCap, slippageBelow.

idempotent makes any async function exactly-once. It derives a deterministic key from the call arguments, writes an in-flight marker to durable storage via atomic compare-and-swap before execution, and writes a completed result record after. Duplicate calls within the TTL window return the cached result immediately without re-executing. Concurrent duplicate calls block on the in-flight marker rather than racing. On process restart, if an in-flight marker exists without a completed record, the library enters chain-aware reconciliation mode: it queries the chain for a transaction matching the stored broadcast hash, determines whether it mined, replaced, or is still pending, and resolves accordingly -- no re-broadcast if the transaction already landed.

receipted produces a signed, content-addressed, chained record of every wrapped call. Each receipt captures the function name, a hash of the inputs, a hash of the outputs, any on-chain transaction references, start and end timestamps, retry count, and a pointer to the previous receipt -- forming a tamper-evident linked chain. Receipts are signed using EIP-712 typed data, making them verifiable by on-chain contracts via ecrecover without any off-chain library. They are persisted to 0G Storage as content-addressed blobs; the CID is derived from the receipt content, so a receipt is immutable by construction. A ReceiptRegistry smart contract deployed on 0G Chain anchors merkle roots of receipt batches on-chain, providing a trustless verification path for any third party. Each agent gets an ENS subname under openacid.eth; the latest receipt CID is mirrored to the subname's text records on every write, making the full audit trail resolvable via any ENS client -- no library installed, no API key, just a name lookup.

The four primitives are higher-order functions with a uniform signature: take a function, return a function. They compose freely in any order, though the recommended nesting is receipted(invariant(idempotent(saga()))) -- outermost to innermost -- because each layer's semantics build correctly on the one inside it. The library validates composition at construction time and emits warnings when the order changes the semantic guarantees.

All four primitives are chain-agnostic and framework-agnostic. They operate behind three adapter interfaces: StorageAdapter for durable state, ChainAdapter for chain queries, and SignerAdapter for receipt signing. The reference adapters are @openacid/adapter-0g-storage for production durability on 0G Storage, @openacid/adapter-viem for EVM chain operations, and @openacid/adapter-ens for ENS text record mirroring. An in-memory adapter ships for tests.

openacid is not a workflow engine, not a monitoring dashboard, not an agent framework. It is a small library with a sharp scope: give the actions your agent already takes the same reliability guarantees your database gives your queries. One install. Four wrappers. Agents stop losing money.


HOW IT'S MADE

Core library -- pnpm monorepo, built with tsup for dual ESM/CJS output, tested with vitest. The four primitives (saga, invariant, idempotent, receipted) are higher-order functions with a uniform signature: take an async function, return an async function with added guarantees. Zero runtime dependencies beyond their own adapter interfaces -- chain-agnostic and framework-agnostic by design. The only public configuration surface is three adapter interfaces: StorageAdapter, ChainAdapter, SignerAdapter. Swap the adapters, same guarantees. The library validates composition order at construction time and emits warnings when the nesting order changes the semantic guarantees.

Install: pnpm add @openacid/acid
npm: https://www.npmjs.com/package/@openacid/acid

0G Storage (@0gfoundation/0g-storage-ts-sdk) is the primary durability backend. In-flight idempotency markers and result caches go to 0G KV via Batcher/KvClient for low-latency atomic reads. Receipts and saga state are written as content-addressed blobs via indexer.upload / ZgFile -- the CID is derived from the content, so a receipt is immutable by construction. Large saga states are streamed via the stream method on the adapter rather than chunked put calls.

The notably hacky part: the cas (compare-and-swap) operation underpinning idempotent's in-flight markers is built on top of 0G KV's versioned writes. Two concurrent callers racing on the same idempotency key will have exactly one win and one block. No distributed lock manager, no external coordinator -- the storage layer itself is the mutex. This is the entire isolation guarantee, and it survives process restarts because the marker lives in 0G KV, not in process memory.

0G Compute (@0gfoundation/0g-compute-ts-sdk) drives the reasoning layer of the example agent. Rather than pinning a model name at build time, the model is resolved at runtime via broker.inference.getServiceMetadata() -- the 0G Compute catalog is dynamic and provider-dependent, so hardcoding a model string is a reliability hazard. Auth is handled via on-chain signed requests or a CLI-issued Bearer token.

Receipt signing uses EIP-712 typed data via viem's signTypedData / verifyTypedData. The domain separator includes chainId 16602 (0G Galileo testnet), making receipts chain-scoped -- a receipt signed on 0G Chain cannot be presented as valid on any other chain. The full Receipt struct (callId, fnName, inputHash, outputHash, txRefs, timestamps, retries, prevReceipt) is part of the typed schema, so an auditor reading the signature sees structured fields, not an opaque hash. ReceiptRegistry.sol (Solidity 0.8, deployed on 0G Chain via Foundry) accepts merkle roots of receipt batches and verifies signatures via ecrecover on the struct hash -- no off-chain library needed.

Chain-aware crash recovery is the most technically interesting piece. When idempotent begins executing a call, it writes an in-flight marker to 0G KV containing the broadcast tx hash. On process restart, if a marker exists without a completed record, the viem chain adapter queries 0G Chain by that tx hash and determines pending / mined / replaced / failed. If mined: mark complete, return cached result, skip re-broadcast. If replaced: surface the replacement to the caller. If pending: block until finality, then resolve. This is what makes the kill -9 demo work: five transactions intended, exactly five mined, restart handled without a single duplicate.

Uniswap V4 -- noOrphanAllowances was built specifically to address the standing-approval problem that V4 multi-step execution creates. In any approve to swap to stake flow, a failed swap leaves a non-zero ERC-20 allowance pointing at the router. noOrphanAllowances detects this post-execution and triggers the saga's compensation chain to revoke it before the action is marked complete. chainAwareBroadcast prevents re-broadcasting an already-mined approval on restart -- closing the double-approval vector that every Uniswap integration hits.

ENS -- each agent gets a subname under openacid.eth via a custom subname registrar built with viem ENS helpers. The @openacid/adapter-ens package hooks into the receipted primitive's onReceipt callback and mirrors receipt.latest and receipt.head CIDs into ENS text records on every write. The result: alice-bot.openacid.eth resolves to the latest receipt CID via any standard ENS resolver, which fetches the full signed receipt from 0G Storage -- complete, tamper-evident audit trail, queryable from a standard ENS lookup, no library installed.


PRIZE JUSTIFICATIONS


0G -- $15,000

openacid is built on 0G end-to-end -- not integrated with it, built on it. Every durability guarantee the library provides runs on 0G infrastructure. ZeroGStorageAdapter (packages/adapter-0g-storage/src/zerog-storage.ts) implements the full StorageAdapter interface using @0gfoundation/0g-storage-ts-sdk -- receipts and saga state are uploaded as content-addressed blobs via Indexer and ZgFile, with a hot in-process cache for low-latency reads. The stream() method handles large saga states as streaming uploads. The CAS operation that makes idempotent's exactly-once guarantee work -- storage.cas(key, null, claim) at idempotent.ts line 85 -- runs through this adapter, making 0G KV the actual mutex for concurrent agent calls. @0gfoundation/0g-compute-ts-sdk drives reasoning in the example agent with runtime model discovery via broker.inference.getServiceMetadata(). ReceiptRegistry.sol on 0G Chain (chainId 16602) anchors receipt merkle roots on-chain, verifiable via ecrecover against the EIP-712 struct hash in receipt.ts.

Code: https://github.com/RomarioKavin1/acid/blob/main/packages/adapter-0g-storage/src/zerog-storage.ts

Ease: 7/10

Feedback: The 0G Storage SDK's blob upload API is flexible and capable -- supporting both single and multi-file upload paths cleanly. The Compute SDK's runtime model discovery via getServiceMetadata() is a genuinely elegant design that decouples agents from hardcoded model names. One thing that would make the experience even smoother: a one-page auth decision guide covering when to use on-chain signed requests vs the CLI-issued Bearer token path -- both work well, but knowing which to reach for upfront would save initial setup time. Overall the SDK surface is well-designed for production use.


ENS -- $5,000

EnsReceiptMirror (packages/adapter-ens/src/mirror.ts) plugs directly into receipted's onReceipt callback and writes three text records to the agent's ENS subname on every receipt: receipt.latest (most recent CID), receipt.head (chain head CID), and agent.signer (public key, published once). namehash from viem derives the ENS node. The result: alice-bot.openacid.eth is a live, tamper-evident activity log -- any ENS resolver returns the 0G Storage CID of the latest signed receipt without installing the library. ENS is used not as identity but as a human-readable index into a decentralized audit trail, which is a genuinely novel application of the protocol.

Code: https://github.com/RomarioKavin1/acid/blob/main/packages/adapter-ens/src/mirror.ts

Ease: 7/10

Feedback: viem's ENS helpers made read operations and namehash derivation clean and straightforward. The setText flow via a custom resolver worked reliably once wired up. An official ENS-maintained subname registrar template for programmatic subname issuance would be a great addition -- projects that want to use ENS as a programmable namespace for agent identities would benefit enormously from a reference implementation. The protocol is clearly capable of this use case; lowering that entry point would unlock a lot of agent-identity tooling.


UNISWAP FOUNDATION -- $5,000

openacid's noOrphanAllowances postcondition (packages/core/src/invariants/no-orphan-allowances.ts) was built specifically to address the standing-approval problem that Uniswap V4 multi-step execution creates at scale. In any approve to swap to stake flow, a failed swap leaves a non-zero ERC-20 allowance pointing at the router -- a phishing vector and audit failure. noOrphanAllowances detects allowance greater than zero for any non-whitelisted spender post-execution, returns an InvariantViolation with severity critical, and triggers the saga's compensation chain to call approve(token, router, 0) before the action is ever marked complete. chainAwareBroadcast (packages/core/src/chain-aware.ts) prevents re-broadcasting an already-mined approval on agent restart -- closing the double-approval vector that every team running Uniswap integrations has hit. The entire receipted(invariant(idempotent(saga()))) composition exists to make Uniswap V4 multi-step execution safe for autonomous agents by default.

Code: https://github.com/RomarioKavin1/acid/blob/main/packages/core/src/invariants/no-orphan-allowances.ts

Ease: 7/10

Feedback: V4's multicall architecture is well-suited for saga-style atomic execution -- the design clearly anticipates multi-step flows and gives integrators meaningful control over execution order. One addition that would make V4 significantly more accessible for agent builders: a guide covering retry-safe and idempotency-aware execution patterns -- what to check before resubmitting, how to structure multicall so a failed step 2 doesn't leave step 1's approval standing. This is a natural fit for V4's design and documenting it officially would make autonomous agent integration much smoother for the growing class of on-chain agents managing real funds.


TECH STACK

Ethereum developer tools: Foundry, viem

Blockchain networks: 0G Chain (Galileo testnet, chainId 16602), Ethereum (ENS resolution)

Programming languages: TypeScript, Solidity

Web frameworks: None (CLI + library)

Databases: 0G Storage (content-addressed blob + KV)

Other technologies: @0gfoundation/0g-storage-ts-sdk, @0gfoundation/0g-compute-ts-sdk, Uniswap V4 (PoolManager, exactInput router), ENS (viem ENS helpers + custom subname registrar), tsup, vitest, pnpm workspaces, EIP-712 typed data signing

AI tools: 0G Compute (@0gfoundation/0g-compute-ts-sdk) is the primary inference backend for the example agent, with the model resolved dynamically at runtime via broker.inference.getServiceMetadata(). Anthropic Claude Sonnet 4.6 is the local-dev fallback when 0G Compute credentials are unavailable -- same agent logic, swapped inference backend. Claude Code was used during development for architecture decisions, PRD authoring, and implementation planning.
