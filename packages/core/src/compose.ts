export type AcidKind =
  | "receipted"
  | "invariant"
  | "idempotent"
  | "saga"
  | "user";

const ACID_META = Symbol.for("openacid.meta");

export interface AcidMeta {
  kind: AcidKind;
  inner: unknown;
}

export function tagWrapper<F extends object>(
  fn: F,
  kind: AcidKind,
  inner: unknown,
): F {
  Object.defineProperty(fn, ACID_META, {
    value: { kind, inner } satisfies AcidMeta,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return fn;
}

export function getMeta(fn: unknown): AcidMeta | null {
  if (fn == null || (typeof fn !== "function" && typeof fn !== "object")) {
    return null;
  }
  const meta = (fn as Record<symbol, unknown>)[ACID_META];
  return (meta as AcidMeta) ?? null;
}

/**
 * Returns a human-readable label for a composed wrapper, e.g.
 * `receipted→invariant→idempotent→saga`. Useful for logging and trace
 * decoration. Returns `"user"` when the function is not an OpenACID-tagged
 * wrapper.
 */
export function getCompositionLabel(fn: unknown): string {
  const order = inspectComposition(fn);
  if (order.length === 0) return "user";
  return order.join("→");
}

export function inspectComposition(fn: unknown): AcidKind[] {
  const order: AcidKind[] = [];
  let cur: unknown = fn;
  while (cur != null) {
    const meta = getMeta(cur);
    if (!meta) break;
    order.push(meta.kind);
    cur = meta.inner;
  }
  return order;
}

const RECOMMENDED: readonly AcidKind[] = [
  "receipted",
  "invariant",
  "idempotent",
  "saga",
];

export interface CompositionWarning {
  message: string;
  observed: AcidKind[];
  recommended: readonly AcidKind[];
}

export function checkComposition(fn: unknown): CompositionWarning[] {
  const observed = inspectComposition(fn);
  const warnings: CompositionWarning[] = [];

  if (observed.length === 0) return warnings;

  const seen = new Set<AcidKind>();
  for (const kind of observed) {
    if (seen.has(kind)) {
      warnings.push({
        message: `'${kind}' wraps another '${kind}' — likely a mistake`,
        observed,
        recommended: RECOMMENDED,
      });
    }
    seen.add(kind);
  }

  const observedRanked = observed.filter((k) =>
    RECOMMENDED.includes(k),
  );
  for (let i = 0; i < observedRanked.length - 1; i++) {
    const cur = RECOMMENDED.indexOf(observedRanked[i]!);
    const next = RECOMMENDED.indexOf(observedRanked[i + 1]!);
    if (cur > next) {
      warnings.push({
        message: `'${observedRanked[i]}' should be outside '${observedRanked[i + 1]}' (recommended order: ${RECOMMENDED.join(" → ")}); current ordering loses semantics`,
        observed,
        recommended: RECOMMENDED,
      });
    }
  }

  return warnings;
}
