import { keccak256, stringToBytes } from "viem";
import type { StorageAdapter } from "./adapters/storage.js";
import type {
  SagaStep,
  SagaContext,
  CompensationFn,
} from "./types.js";
import { SagaCompensationError, SagaStepError } from "./errors.js";
import { tagWrapper } from "./compose.js";
import { canonicalJson } from "./canonical.js";

export interface SagaOpts<A> {
  steps: SagaStep<A>[];
  compensations?: Record<string, CompensationFn<A>>;
  storage: StorageAdapter;
  onPartialFailure?: "compensate" | "halt" | "retry-forward";
  namespace?: string;
}

interface RunningState {
  phase: "running";
  sagaId: string;
  currentStepIndex: number;
  results: Record<string, unknown>;
  startedAt: number;
  attempt: number;
}

interface CompensatingState {
  phase: "compensating";
  sagaId: string;
  failedStepIndex: number;
  results: Record<string, unknown>;
  cause: { name: string; message: string };
  attempt: number;
}

interface CompensatedState {
  phase: "compensated";
  sagaId: string;
  failedStepIndex: number;
  results: Record<string, unknown>;
  cause: { name: string; message: string };
  attempt: number;
}

interface CompletedState {
  phase: "completed";
  sagaId: string;
  results: Record<string, unknown>;
  completedAt: number;
  attempt: number;
}

interface HaltedState {
  phase: "halted";
  sagaId: string;
  failedStepIndex: number;
  results: Record<string, unknown>;
  cause: { name: string; message: string };
  attempt: number;
}

type SagaState =
  | RunningState
  | CompensatingState
  | CompensatedState
  | CompletedState
  | HaltedState;

export function saga<A>(
  opts: SagaOpts<A>,
): (args: A) => Promise<Record<string, unknown>> {
  const {
    steps,
    compensations = {},
    storage,
    onPartialFailure = "compensate",
    namespace = "saga",
  } = opts;

  for (let i = 0; i < steps.length; i++) {
    const id = steps[i]!.id;
    for (let j = i + 1; j < steps.length; j++) {
      if (steps[j]!.id === id) {
        throw new Error(
          `saga step ids must be unique; '${id}' appears more than once`,
        );
      }
    }
  }

  const fn = async (args: A) => {
    const sagaId = sagaIdFromArgs(args);
    const stateKey = `${namespace}:${sagaId}`;

    let state = await storage.get<SagaState>(stateKey);

    if (state?.phase === "completed") return state.results;

    if (state?.phase === "compensated" || state?.phase === "halted") {
      const step = steps[state.failedStepIndex];
      throw new SagaStepError(step?.id ?? `step:${state.failedStepIndex}`, {
        name: state.cause.name,
        message: state.cause.message,
      });
    }

    if (state?.phase === "running") {
      const recovered: CompensatingState = {
        phase: "compensating",
        sagaId,
        failedStepIndex: state.currentStepIndex,
        results: state.results,
        cause: {
          name: "SagaRecoveryError",
          message: `process restarted while step ${state.currentStepIndex} was in flight; compensating prior steps`,
        },
        attempt: state.attempt + 1,
      };
      await storage.put<SagaState>(stateKey, recovered);
      state = recovered;
    }

    if (!state) {
      const fresh: RunningState = {
        phase: "running",
        sagaId,
        currentStepIndex: 0,
        results: {},
        startedAt: Date.now(),
        attempt: 1,
      };
      await storage.put<SagaState>(stateKey, fresh);
      state = fresh;
    }

    if (state.phase === "compensating") {
      await runCompensations(
        storage,
        namespace,
        sagaId,
        steps,
        compensations,
        state,
        args,
      );
      const final: CompensatedState = { ...state, phase: "compensated" };
      await storage.put<SagaState>(stateKey, final);
      const failedStep = steps[state.failedStepIndex];
      throw new SagaStepError(
        failedStep?.id ?? `step:${state.failedStepIndex}`,
        state.cause,
      );
    }

    while (
      state.phase === "running" &&
      state.currentStepIndex < steps.length
    ) {
      const step = steps[state.currentStepIndex]!;
      const ctx: SagaContext<A> = {
        args,
        sagaId,
        attempt: state.attempt,
        results: state.results,
      };

      let stepResult: unknown;
      try {
        stepResult = await step.do(ctx);
      } catch (err) {
        if (onPartialFailure === "halt") {
          const halted: HaltedState = {
            phase: "halted",
            sagaId,
            failedStepIndex: state.currentStepIndex,
            results: state.results,
            cause: serializeError(err),
            attempt: state.attempt,
          };
          await storage.put<SagaState>(stateKey, halted);
          throw new SagaStepError(step.id, err);
        }

        if (onPartialFailure === "retry-forward") {
          throw new SagaStepError(step.id, err);
        }

        const compensating: CompensatingState = {
          phase: "compensating",
          sagaId,
          failedStepIndex: state.currentStepIndex,
          results: state.results,
          cause: serializeError(err),
          attempt: state.attempt,
        };
        await storage.put<SagaState>(stateKey, compensating);

        await runCompensations(
          storage,
          namespace,
          sagaId,
          steps,
          compensations,
          compensating,
          args,
        );

        const final: CompensatedState = {
          ...compensating,
          phase: "compensated",
        };
        await storage.put<SagaState>(stateKey, final);
        throw new SagaStepError(step.id, err);
      }

      const advanced: RunningState = {
        ...state,
        currentStepIndex: state.currentStepIndex + 1,
        results: { ...state.results, [step.id]: stepResult },
      };
      await storage.put<SagaState>(stateKey, advanced);
      state = advanced;
    }

    const completed: CompletedState = {
      phase: "completed",
      sagaId,
      results: state.results,
      completedAt: Date.now(),
      attempt: state.attempt,
    };
    await storage.put<SagaState>(stateKey, completed);
    return state.results;
  };
  return tagWrapper(fn, "saga", null);
}

async function runCompensations<A>(
  storage: StorageAdapter,
  namespace: string,
  sagaId: string,
  steps: SagaStep<A>[],
  compensations: Record<string, CompensationFn<A>>,
  state: CompensatingState,
  args: A,
): Promise<void> {
  for (let i = state.failedStepIndex - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.compensateOn === "never") continue;

    const compFn = compensations[step.id];
    if (!compFn) continue;

    const compKey = `${namespace}:${sagaId}:compensate:${step.id}`;
    const already = await storage.get<{ done: true }>(compKey);
    if (already?.done) continue;

    const ctx: SagaContext<A> = {
      args,
      sagaId,
      attempt: state.attempt,
      results: state.results,
    };
    const stepResult = state.results[step.id];

    try {
      await compFn(ctx, stepResult);
      await storage.put(compKey, { done: true });
    } catch (compErr) {
      throw new SagaCompensationError(step.id, compErr);
    }
  }
}

function sagaIdFromArgs(args: unknown): string {
  return keccak256(stringToBytes(canonicalJson(args))).slice(2, 18);
}

function serializeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "Error", message: String(err) };
}
