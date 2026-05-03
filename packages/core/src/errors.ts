export class AcidError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message);
    this.name = "AcidError";
    if (opts?.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

export class NonDeterministicKeyError extends AcidError {
  constructor(public readonly samples: [string, string]) {
    super(
      `idempotent key function produced different outputs for identical args: ${JSON.stringify(samples[0])} vs ${JSON.stringify(samples[1])}. Idempotency keys must be deterministic.`,
    );
    this.name = "NonDeterministicKeyError";
  }
}

export class IdempotentInFlightError extends AcidError {
  constructor(public readonly key: string) {
    super(
      `another execution of key '${key}' is currently in flight (mode: reject)`,
    );
    this.name = "IdempotentInFlightError";
  }
}

export class IdempotentInFlightLostError extends AcidError {
  constructor(public readonly key: string) {
    super(
      `in-flight execution of key '${key}' disappeared from storage before completing; the prior attempt likely crashed or threw`,
    );
    this.name = "IdempotentInFlightLostError";
  }
}

export class InvariantViolationError extends AcidError {
  constructor(
    public readonly phase: "pre" | "post",
    public readonly reason: string,
    public readonly severity: "critical" | "high" | "medium",
    public readonly context?: Record<string, unknown>,
  ) {
    const ctx =
      context && Object.keys(context).length > 0
        ? ` context=${safeStringify(context)}`
        : "";
    super(
      `invariant ${phase}-condition violated [${severity}]: ${reason}${ctx}`,
    );
    this.name = "InvariantViolationError";
  }
}

export interface SagaErrorMeta {
  sagaId?: string;
  attempt?: number;
}

export class SagaCompensationError extends AcidError {
  public readonly sagaId?: string;
  public readonly attempt?: number;
  constructor(
    public readonly stepId: string,
    public override readonly cause: unknown,
    meta?: SagaErrorMeta,
  ) {
    super(
      `compensation for step '${stepId}' threw${formatMeta(meta)}: ${describe(cause)}`,
      { cause },
    );
    this.name = "SagaCompensationError";
    if (meta?.sagaId !== undefined) this.sagaId = meta.sagaId;
    if (meta?.attempt !== undefined) this.attempt = meta.attempt;
  }
}

export class SagaStepError extends AcidError {
  public readonly sagaId?: string;
  public readonly attempt?: number;
  constructor(
    public readonly stepId: string,
    public override readonly cause: unknown,
    meta?: SagaErrorMeta,
  ) {
    super(
      `saga step '${stepId}' failed${formatMeta(meta)}: ${describe(cause)}`,
      { cause },
    );
    this.name = "SagaStepError";
    if (meta?.sagaId !== undefined) this.sagaId = meta.sagaId;
    if (meta?.attempt !== undefined) this.attempt = meta.attempt;
  }
}

export class ReceiptVerificationError extends AcidError {
  constructor(public readonly reason: string) {
    super(`receipt verification failed: ${reason}`);
    this.name = "ReceiptVerificationError";
  }
}

function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return safeStringify(e);
}

function formatMeta(meta?: SagaErrorMeta): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (meta.sagaId) parts.push(`saga=${meta.sagaId}`);
  if (meta.attempt !== undefined) parts.push(`attempt=${meta.attempt}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
