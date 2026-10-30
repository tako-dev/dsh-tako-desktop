/** Credential reference the Tako plugin and the desktop host share. */
export const TAKO_CREDENTIAL_REF = 'TAKO_API_KEY'

/** The slice of `remote.credentials.describe` this page reads. */
export interface TakoCredentialDescribe {
  describe(refs: string[]): Promise<{ ok: boolean, value: Record<string, { configured?: boolean } | undefined> }>
}

/** Whether a credentials.describe answer says the Tako key is stored. */
export function takoCredentialConfigured(
  described: { ok?: boolean, value?: Record<string, { configured?: boolean } | undefined> } | undefined,
  ref = TAKO_CREDENTIAL_REF,
): boolean {
  if (described?.ok !== true) return false
  return described.value?.[ref]?.configured === true
}
