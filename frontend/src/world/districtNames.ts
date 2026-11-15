import type { DistrictId } from '../net/protocol'

/** Each district's name, kept out of the district chunks so the travel sheet can list them all before loading any. */
export const DISTRICT_NAMES: Record<DistrictId, { hi: string; en: string }> = {
  'walled-city': { hi: 'Gulabi Shahar', en: 'Pink City' },
  'mi-road': { hi: 'MI Road–Raja Park', en: 'MI Road & Raja Park' },
  university: { hi: 'University–JKK', en: 'University & JKK' },
  'malviya-nagar': { hi: 'Malviya Nagar–WTP', en: 'Malviya Nagar & WTP' },
  amer: { hi: 'Amer', en: 'Amer' },
}

/**
 * What the HUD's place chip shows: the name without its second half, so the chip, the weather and the stamps
 * keep one row on a small phone. The chip's accessible name is still the full name above.
 */
export const DISTRICT_SHORT_NAMES: Record<DistrictId, { hi: string; en: string }> = {
  'walled-city': DISTRICT_NAMES['walled-city'],
  'mi-road': { hi: 'MI Road', en: 'MI Road' },
  university: { hi: 'University', en: 'University' },
  'malviya-nagar': { hi: 'Malviya Nagar', en: 'Malviya Nagar' },
  amer: DISTRICT_NAMES.amer,
}
