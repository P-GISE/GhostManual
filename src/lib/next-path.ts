// URL parsers strip ASCII controls and normalize backslashes before resolving hosts.
export function safeNextPath(value: unknown): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject raw controls before URL normalization.
  return typeof value === "string" &&
    !/[\x00-\x1f\x7f]/.test(value) &&
    /^\/(?![/\\])/.test(value)
    ? value
    : "/manuals";
}
