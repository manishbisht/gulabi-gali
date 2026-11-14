import { t, type Lang } from '../i18n/strings'

interface Props {
  state: 'ghost' | 'resident'
  lang: Lang
  /** The ghost's way out: sign in, or finish the profile. Absent for a resident. */
  cta?: { label: string; onClick: () => void }
}

/** Says whether anyone can see the player in the city. */
export function VisibilityChip({ state, lang, cta }: Props) {
  return (
    <div className="visibility" data-state={state}>
      <span className="hud-chip">
        {t(state === 'resident' ? 'visibilityResident' : 'visibilityGhost', lang)}
      </span>
      {state === 'ghost' && cta && (
        <button type="button" className="sign-in-button" onClick={cta.onClick}>
          {cta.label}
        </button>
      )}
    </div>
  )
}
