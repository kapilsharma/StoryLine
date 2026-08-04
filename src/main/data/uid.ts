import { randomBytes } from 'crypto'

/** A fresh note uid: `n_<8 hex>` (see Feature9). */
export function newNoteUid(): string {
  return `n_${randomBytes(4).toString('hex')}`
}

/** A uid not present in `taken` (regenerate on the rare collision). */
export function uniqueNoteUid(taken: Iterable<string>): string {
  const used = new Set(taken)
  let uid = newNoteUid()
  while (used.has(uid)) uid = newNoteUid()
  return uid
}
