export const VERSION = "0.0.0";

export type {
  Wrapper,
  Receipt,
  SagaStep,
  SagaContext,
  CompensationFn,
  InvariantViolation,
  InvariantContext,
} from "./types.js";

export type { StorageAdapter } from "./adapters/storage.js";
export type { ChainAdapter, TxStatus } from "./adapters/chain.js";
export type { SignerAdapter } from "./adapters/signer.js";

export {
  idempotent,
  type IdempotentOpts,
  type IdempotentInFlightMode,
} from "./idempotent.js";

export { saga, type SagaOpts } from "./saga.js";

export {
  invariant,
  type InvariantOpts,
  type InvariantOnViolation,
} from "./invariant.js";

export {
  balanceWithinBound,
  gasUnderCap,
  slippageBelow,
  noOrphanAllowances,
  recipientWhitelist,
} from "./invariants/index.js";

export { withTimeout, TimeoutError, type WithTimeoutOpts } from "./with-timeout.js";

export { receipted, type ReceiptedOpts } from "./receipted.js";

export {
  verifyReceipt,
  receiptDigest,
  buildDomain,
  hashCanonical,
  hashTxRefs,
  deriveCallId,
  RECEIPT_DOMAIN_NAME,
  RECEIPT_DOMAIN_VERSION,
  RECEIPT_TYPES,
  type ReceiptDomain,
} from "./receipt.js";

export {
  inspectComposition,
  checkComposition,
  getCompositionLabel,
  type AcidKind,
  type CompositionWarning,
} from "./compose.js";

export {
  storageConformanceCases,
  type ConformanceCase,
} from "./conformance/storage.js";

export {
  chainAwareBroadcast,
  inspectInFlight,
  type BroadcastRecord,
  type BroadcastOutcome,
  type ChainAwareBroadcastOpts,
  type InspectInFlightOpts,
} from "./chain-aware.js";

export {
  AcidError,
  NonDeterministicKeyError,
  IdempotentInFlightError,
  IdempotentInFlightLostError,
  InvariantViolationError,
  SagaCompensationError,
  SagaStepError,
  ReceiptVerificationError,
} from "./errors.js";
