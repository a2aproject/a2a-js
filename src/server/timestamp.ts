const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i;

/** The whole second, plus the fraction Date.parse would drop past the millisecond. */
function timestampParts(timestamp: string): { seconds: number; nanos: number } | undefined {
  const match = TIMESTAMP.exec(timestamp.trim());
  if (!match) {
    return undefined;
  }
  const seconds = Date.parse(`${match[1]}${match[3]}`);
  if (Number.isNaN(seconds)) {
    return undefined;
  }
  const nanos = Number((match[2] ?? '').padEnd(9, '0').slice(0, 9));
  return { seconds, nanos };
}

/**
 * True when `candidate` is strictly later than `boundary`.
 * An equal instant is not later. Fractions past the millisecond stay in the comparison.
 */
export function isTimestampStrictlyAfter(candidate: string, boundary: string): boolean {
  const left = timestampParts(candidate);
  const right = timestampParts(boundary);
  if (left && right) {
    if (left.seconds !== right.seconds) {
      return left.seconds > right.seconds;
    }
    return left.nanos > right.nanos;
  }

  const leftMs = Date.parse(candidate);
  const rightMs = Date.parse(boundary);
  return !Number.isNaN(leftMs) && !Number.isNaN(rightMs) && leftMs > rightMs;
}
