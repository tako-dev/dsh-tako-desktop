/** DSH Tako hero copy, registered only while the Tako profile is active. */

/** English DSH Tako brand dictionary. */
export const en = {
  heroHeadline: 'Let Tako get it done',
}

/** Chinese DSH Tako brand dictionary. */
export const zh: Record<keyof typeof en, string> = {
  heroHeadline: '让 Tako 帮你完成任务',
}

/** DSH Tako brand dictionary key. */
export type TakoBrandKey = keyof typeof en
