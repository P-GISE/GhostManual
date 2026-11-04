// URL parsers strip ASCII controls and normalize backslashes before resolving hosts.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject raw controls before URL normalization.
const asciiControls = /[\x00-\x1f\x7f]/;

export function safeNextPath(value: unknown): string {
  return typeof value === "string" && !asciiControls.test(value) && /^\/(?![/\\])/.test(value)
    ? value
    : "/manuals";
}
