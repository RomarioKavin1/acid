export type Wrapper<A, R> = (
  fn: (args: A) => Promise<R>,
) => (args: A) => Promise<R>;

export interface Receipt {
  callId: string;
  prevReceipt: string | null;
  fnName: string;
  inputHash: string;
  outputHash: string;
  txRefs: string[];
  startedAt: number;
  endedAt: number;
  retries: number;
  signature: string;
  cid: string;
}

export interface SagaStep<A = unknown> {
  id: string;
  do: (ctx: SagaContext<A>) => Promise<unknown>;
  compensateOn?: "failure" | "never";
}

export interface SagaContext<A = unknown> {
  args: A;
  sagaId: string;
  attempt: number;
  results: Record<string, unknown>;
}

export type CompensationFn<A = unknown> = (
  ctx: SagaContext<A>,
  stepResult: unknown,
) => Promise<void>;

export interface InvariantViolation {
  reason: string;
  severity: "critical" | "high" | "medium";
  context?: Record<string, unknown>;
}

export interface InvariantContext {
  fnName: string;
  startedAt: number;
}
