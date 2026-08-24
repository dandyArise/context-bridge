const RAW_PREFIX = "__LM_STUDIO_INTERNAL_LSEP_";
const ESCAPED_PREFIX = "\\_\\_LM\\_STUDIO\\_INTERNAL\\_LSEP\\_";
const PREFIXES = [RAW_PREFIX, ESCAPED_PREFIX];

const RAW_SEPARATOR = /__LM_STUDIO_INTERNAL_LSEP_[A-Z0-9_]+?__/giu;
const ESCAPED_SEPARATOR =
  /\\_\\_LM\\_STUDIO\\_INTERNAL\\_LSEP\\_(?:[A-Z0-9]|\\_)+?\\_\\_/giu;

export function stripInternalSeparators(text: string): string {
  return text.replace(RAW_SEPARATOR, "").replace(ESCAPED_SEPARATOR, "");
}

function firstPrefixIndex(text: string): number {
  let result = -1;
  for (const prefix of PREFIXES) {
    const index = text.indexOf(prefix);
    if (index >= 0 && (result < 0 || index < result)) result = index;
  }
  return result;
}

function partialPrefixLength(text: string): number {
  let result = 0;
  for (const prefix of PREFIXES) {
    const maximum = Math.min(text.length, prefix.length - 1);
    for (let length = maximum; length > result; length--) {
      if (text.endsWith(prefix.slice(0, length))) {
        result = length;
        break;
      }
    }
  }
  return result;
}

/** Filters private LM Studio separators even when a marker spans fragments. */
export class InternalSeparatorStreamFilter {
  private pending = "";

  push(fragment: string): string {
    this.pending = stripInternalSeparators(this.pending + fragment);
    const markerStart = firstPrefixIndex(this.pending);
    if (markerStart >= 0) {
      const visible = this.pending.slice(0, markerStart);
      this.pending = this.pending.slice(markerStart);
      return visible;
    }

    const heldLength = partialPrefixLength(this.pending);
    const visibleEnd = this.pending.length - heldLength;
    const visible = this.pending.slice(0, visibleEnd);
    this.pending = this.pending.slice(visibleEnd);
    return visible;
  }

  flush(): string {
    const cleaned = stripInternalSeparators(this.pending);
    this.pending = "";
    const markerStart = firstPrefixIndex(cleaned);
    if (markerStart >= 0) return cleaned.slice(0, markerStart);
    const heldLength = partialPrefixLength(cleaned);
    return cleaned.slice(0, cleaned.length - heldLength);
  }
}
