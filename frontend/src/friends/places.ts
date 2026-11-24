import { t, type Lang } from '../i18n/strings'
import type { ChaiInviteView, DistrictId } from '../net/protocol'
import { DISTRICT_NAMES } from '../world/districtNames'

/** A district's name, or its id for one this page does not know yet (a newer server). */
export const districtLabel = (id: DistrictId, lang: Lang): string =>
  (DISTRICT_NAMES as Partial<Record<DistrictId, Record<Lang, string>>>)[id]?.[lang] ?? id

/** Where an invite for chai is: the kind of seat and its district, in words (never more exact than that). */
export const chaiPlace = (c: Pick<ChaiInviteView, 'kind' | 'district'>, lang: Lang): string =>
  t(c.kind === 'tapri' ? 'chaiPlaceTapri' : 'chaiPlaceBench', lang, {
    district: districtLabel(c.district, lang),
  })
