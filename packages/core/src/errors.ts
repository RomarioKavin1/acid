export class AcidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcidError";
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
    super(`invariant ${phase}-condition violated: ${reason} (severity: ${severity})`);
    this.name = "InvariantViolationError";
  }
}

export class SagaCompensationError extends AcidError {
  constructor(
    public readonly stepId: string,
    public readonly cause: unknown,
  ) {
    super(`compensation for step '${stepId}' threw: ${describe(cause)}`);
    this.name = "SagaCompensationError";
  }
}

export class SagaStepError extends AcidError {
  constructor(
    public readonly stepId: string,
    public readonly cause: unknown,
  ) {
    super(`saga step '${stepId}' failed: ${describe(cause)}`);
    this.name = "SagaStepError";
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
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
