import type { Lang } from '../i18n/strings'
import { HOME_AREAS, type HomeArea } from '../net/protocol'

export { HOME_AREAS }

export const areaLabel = (area: HomeArea, lang: Lang): string =>
  area === 'Outside Jaipur' && lang === 'hi' ? 'Jaipur ke bahar' : area
