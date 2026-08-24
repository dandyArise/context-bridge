const SYNTHETIC_REASONING_END =
  /(?:__|\*\*|\\_\\_)?LM\\?_STUDIO\\?_INTERNAL\\?_LSEP\\?_SYNTHETIC\\?_REASONING\\?_END\\?_[a-f0-9]{32}(?:__|\*\*|\\_\\_)?/giu;

export function stripInternalSeparators(text: string): string {
  return text.replace(SYNTHETIC_REASONING_END, "");
}
