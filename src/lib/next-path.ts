// URL parsers strip ASCII controls and normalize backslashes before resolving hosts.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject raw controls before URL normalization.
const asciiControls = /[\x00-\x1f\x7f]/;

// 목적지가 없거나 안전하지 않을 때 가는 곳: 내 문서함.
export const homePath = "/library";

export function safeNextPath(value: unknown): string {
  return typeof value === "string" && !asciiControls.test(value) && /^\/(?![/\\])/.test(value)
    ? value
    : homePath;
}
