import type { Lang, StringKey } from '../i18n/strings'
import { HOME_AREAS, type HereFor, type HomeArea } from '../net/protocol'

export { HOME_AREAS }

export const areaLabel = (area: HomeArea, lang: Lang): string =>
  area === 'Outside Jaipur' && lang === 'hi' ? 'Jaipur ke bahar' : area

export const HERE_FOR_LABEL: Record<HereFor, StringKey> = {
  friends: 'hereForFriends',
  study: 'hereForStudy',
  work: 'hereForWork',
  art: 'hereForArt',
}
