import { t, type Lang, type StringKey } from '../i18n/strings'
import type { ReactionNotice, ReactionRefusal } from '../world/useReactions'

const WHY: Record<ReactionRefusal, StringKey> = {
  far: 'reactFar',
  wait: 'reactWait',
  gone: 'reactGone',
  ghost: 'reactGhost',
  muted: 'reactMuted',
  offline: 'reactOffline',
}

/**
 * The passing toast for a reaction: who greeted the player, gently, or why the player's own greeting did not
 * go. The same person greeting again and again gets a one-tap block right here.
 */
export function ReactionToast({
  notice,
  lang,
  onBlock,
}: {
  notice: ReactionNotice
  lang: Lang
  onBlock(id: string, name: string): void
}) {
  if (notice.t === 'no')
    return (
      <div className="toast" role="status">
        {t(WHY[notice.why], lang)}
      </div>
    )
  const { id, name, kind, again } = notice
  return (
    <div className="toast reaction-toast" role="status">
      <span>{t(kind === 'namaste' ? 'reactGotNamaste' : 'reactGotWave', lang, { name })}</span>
      {again && (
        <>
          <span className="reaction-again">{t('reactAgain', lang, { name })}</span>
          <button
            type="button"
            className="reaction-block"
            aria-label={t('reactBlock', lang, { name })}
            onClick={() => onBlock(id, name)}
          >
            {t('blockButton', lang)}
          </button>
        </>
      )}
    </div>
  )
}
