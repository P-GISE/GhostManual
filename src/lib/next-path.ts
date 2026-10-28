// Only same-site paths; "//host" or "/\host" would leave the site.
export function safeNextPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/manuals";
}
