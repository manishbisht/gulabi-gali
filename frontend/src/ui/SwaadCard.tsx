import { t, type Lang } from '../i18n/strings'
import { DISH_EMOJI, type DishId } from '../world/swaad'
import { DISH_TEXT } from '../world/swaadText'

interface Props {
  dish: DishId
  lang: Lang
  onClose: () => void
}

/**
 * The dish just tasted: the vendor's line, what it is, and where in Jaipur it is loved. The same bottom card as
 * a character's.
 */
export function SwaadCard({ dish, lang, onClose }: Props) {
  const text = DISH_TEXT[dish]
  return (
    <section className="landmark-card swaad-card" aria-label={text.name[lang]}>
      <h2>
        <span aria-hidden="true">{DISH_EMOJI[dish]}</span> {text.name[lang]}
      </h2>
      <p className="swaad-vendor">“{text.vendor[lang]}”</p>
      <p>
        {text.what[lang]}
        <br />
        {text.where[lang]}
      </p>
      <button type="button" className="landmark-stamp" onClick={onClose}>
        {t('swaadClose', lang)}
      </button>
    </section>
  )
}
