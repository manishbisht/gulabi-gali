import { t, type Lang } from '../i18n/strings'
import type { Goal } from '../world/today'
import { goalText, streakText } from '../world/todayText'
import { useDialog } from './useDialog'

/**
 * The "Aaj ka Darshan" chip: an icon only (a small phone's HUD has no room for words). Its name is short and the
 * same every day ("Aaj ka Darshan", or "… ho gaya" once done), so it never sounds like another control (a "Metro"
 * goal must not make a second "Metro" button); the day's goal is its description (the title). Done, it wears a
 * small tick. Opens the sheet.
 */
export function TodayChip({
  goal,
  done,
  lang,
  onOpen,
}: {
  goal: Goal
  done: boolean
  lang: Lang
  onOpen: () => void
}) {
  const label = t(done ? 'todayChipDone' : 'todayChip', lang)
  const title = `${label}: ${goalText(goal, lang).goal}`
  return (
    <button
      type="button"
      className="hud-chip today-chip"
      aria-label={label}
      aria-haspopup="dialog"
      title={title}
      data-done={done ? '' : undefined}
      onClick={onOpen}
    >
      <span aria-hidden="true">🎯</span>
      {done && (
        <span className="today-tick" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  )
}

interface SheetProps {
  goal: Goal
  done: boolean
  streak: number
  best: number
  /** A ghost: the count is this device's only. */
  local: boolean
  lang: Lang
  onClose: () => void
}

/** The day's goal, a hint for how, whether it is done, and the run of days: nothing more. */
export function TodaySheet({ goal, done, streak, best, local, lang, onClose }: SheetProps) {
  const ref = useDialog<HTMLElement>(onClose)
  const text = goalText(goal, lang)
  return (
    <div className="auth-scrim">
      <section
        ref={ref}
        className="auth-sheet today-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('todayTitle', lang)}
      >
        <h2>{t('todayTitle', lang)}</h2>
        <p className="today-goal">
          <strong>{text.goal}</strong>
        </p>
        <p className="today-hint">{text.hint}</p>
        <p className="today-status" data-done={done ? '' : undefined}>
          {t(done ? 'todayDone' : 'todayPending', lang)}
        </p>
        <p className="today-streak">{streakText(streak, best, lang)}</p>
        <p className="today-note">{t('todayNewDay', lang)}</p>
        {local && <p className="today-note">{t('todayLocal', lang)}</p>}
        <button type="button" className="auth-close" onClick={onClose}>
          {t('darshanClose', lang)}
        </button>
      </section>
    </div>
  )
}
