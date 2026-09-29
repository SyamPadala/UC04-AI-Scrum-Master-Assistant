/**
 * Work item keys in whatever form a member types them (SPEC-004 item 21).
 *
 * 29 Sep 2026: "scrum 25" and "scrum-24" were missed while "SCRUM-24" was
 * found. The key format is a fact, so code normalises it; the model is never
 * left to decide whether "scrum 25" and "SCRUM-25" are the same thing.
 */

function escapeForRegExp (text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`)
}

function keyPattern (projectKey: string): RegExp {
  return new RegExp(`\\b${escapeForRegExp(projectKey)}[\\s_-]*(\\d+)\\b`, 'gi')
}

/** "scrum 25", "Scrum-25", "SCRUM25", "scrum_25" → "SCRUM-25" in a member's text. */
export function normaliseKeysInText (text: string, projectKey: string): string {
  if (projectKey === '') return text
  return text.replace(keyPattern(projectKey), (_match, number: string) => `${projectKey.toUpperCase()}-${number}`)
}

/** The canonical keys named in a text, in order of first mention. */
export function keysInText (text: string, projectKey: string): string[] {
  if (projectKey === '') return []
  const keys = [...text.matchAll(keyPattern(projectKey))].map((match) => `${projectKey.toUpperCase()}-${match[1]}`)
  return [...new Set(keys)]
}

/** A key the model returned, in canonical form: upper case, one hyphen. */
export function canonicalKey (ref: string): string {
  const match = ref.trim().match(/^([A-Za-z][A-Za-z0-9]*)[\s_-]*(\d+)$/)
  return match === null ? ref.trim() : `${match[1].toUpperCase()}-${match[2]}`
}
