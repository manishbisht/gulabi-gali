import { t, type Lang } from '../i18n/strings'
import { DISTRICT_NAMES } from '../world/districtNames'
import { DISHES, DISH_EMOJI, dishDistricts, swaadComplete, type DishId } from '../world/swaad'
import { DISH_TEXT } from '../world/swaadText'

/**
 * Jaipur ka Swaad, inside the Darshan sheet: all eight dishes by name with the districts that serve each (so
 * there is somewhere to go), the tasted ones with their note. Kept on this device only.
 */
export function SwaadList({ dishes, lang }: { dishes: readonly DishId[]; lang: Lang }) {
  return (
    <>
      {swaadComplete(dishes) && <p className="swaad-done">{t('swaadDone', lang)}</p>}
      <ul className="darshan-list" aria-label={t('swaadListLabel', lang)}>
        {DISHES.map((dish) => {
          const got = dishes.includes(dish)
          const text = DISH_TEXT[dish]
          return (
            <li key={dish} data-id={dish} data-got={got}>
              <strong>
                <span aria-hidden="true">{got ? DISH_EMOJI[dish] : '○'}</span> {text.name[lang]}
              </strong>
              <span className="darshan-district">
                {dishDistricts(dish)
                  .map((d) => DISTRICT_NAMES[d][lang])
                  .join(' · ')}
              </span>
              <em>{got ? `${text.what[lang]} ${text.where[lang]}` : t('swaadLocked', lang)}</em>
            </li>
          )
        })}
      </ul>
      <p className="swaad-local">{t('swaadLocal', lang)}</p>
    </>
  )
}
