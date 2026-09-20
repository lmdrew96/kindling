const UUID_ANYWHERE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g

/**
 * Pulls a token out of whatever the user pasted.
 *
 * People paste the whole MCP URL, because that is the string they were told to
 * keep. Rejecting it as "not a valid token" is a bad failure here: an unknown
 * token addresses an empty namespace rather than erroring, so a near-miss
 * renders as a perfectly valid Kindling with no sparks in it — which reads as
 * total data loss rather than as a typo.
 *
 * Takes the LAST uuid in the string, since a pasted URL nested in another
 * query string can contain more than one.
 */
export const parseKindlingToken = (raw: string): string | null => {
  const input = raw.trim()
  if (!input) return null
  const matches = input.match(UUID_ANYWHERE)
  if (!matches || matches.length === 0) return null
  return matches[matches.length - 1].toLowerCase()
}
