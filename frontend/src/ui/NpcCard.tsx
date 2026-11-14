import { t, type Lang } from '../i18n/strings'
import type { NpcDef } from '../world/types'

interface Props {
  npc: NpcDef
  lang: Lang
  onClose: () => void
}

/** The same bottom card as a landmark's. No message button: these characters are not real. */
export function NpcCard({ npc, lang, onClose }: Props) {
  return (
    <section className="landmark-card npc-card" aria-label={npc.name}>
      <h2>
        <span className="npc-badge" aria-hidden="true">
          ✦
        </span>{' '}
        {npc.name}
      </h2>
      <p className="npc-role">{npc.role[lang]}</p>
      <p>“{npc.status[lang]}”</p>
      <p className="npc-notreal">{t('npcNotReal', lang)}</p>
      <button type="button" className="landmark-stamp" onClick={onClose}>
        {t('npcClose', lang)}
      </button>
    </section>
  )
}
