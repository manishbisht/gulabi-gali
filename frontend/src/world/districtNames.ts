import type { DistrictId } from '../net/protocol'

/** Each district's name, kept out of the district chunks so the metro can list them all before loading any. */
export const DISTRICT_NAMES: Record<DistrictId, { hi: string; en: string }> = {
  'walled-city': { hi: 'Gulabi Shahar', en: 'Pink City' },
  'mi-road': { hi: 'MI Road–Raja Park', en: 'MI Road & Raja Park' },
  university: { hi: 'University–JKK', en: 'University & JKK' },
  'malviya-nagar': { hi: 'Malviya Nagar–WTP', en: 'Malviya Nagar & WTP' },
}
