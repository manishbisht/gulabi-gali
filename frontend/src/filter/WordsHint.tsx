import { t, type Lang } from '../i18n/strings'
import { useWordHint } from './hints'

/** The gentle "some words aren't okay" line under a field, once its text trips the hint. Nothing otherwise. */
export function WordsHint({ text, lang }: { text: string; lang: Lang }) {
  return useWordHint(text) ? (
    <small className="words-hint" role="status">
      {t('wordsHint', lang)}
    </small>
  ) : null
}
