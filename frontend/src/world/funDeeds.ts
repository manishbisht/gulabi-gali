import { onCricketPlayed } from './cricketPitch'
import { emitDeed } from './deeds'
import { onEmoted } from './emoting'
import { onShowWatched } from './shows'
import { onTasted } from './swaad'
import { onTouched } from './touched'

/*
 * The things to do, as deeds for "Aaj ka Darshan": each feature already says, DOM-free and at the one moment it
 * happens, that an innings ended, something was touched, a dish was tasted, a show was watched to its end or an
 * emote was played. This joins those five to `emitDeed`, so the features know nothing of the day's goal and the
 * goal nothing of them. Local to this page; nothing is sent.
 */

/**
 * Listens to the five; returns the way to stop. Pigeons sent up are not a `touch` deed: that happens by walking
 * past, and a goal is something done on purpose. Any dish counts (not only a first taste), any show (the
 * evening's dancers too, though the goal never needs them), any emote, an innings with any score.
 */
export function listenForFun(): () => void {
  const stops = [
    onCricketPlayed(() => emitDeed({ kind: 'cricket' })),
    onTouched((kind) => {
      if (kind !== 'pigeons') emitDeed({ kind: 'touch' })
    }),
    onTasted(() => emitDeed({ kind: 'swaad' })),
    onShowWatched(() => emitDeed({ kind: 'show' })),
    onEmoted(() => emitDeed({ kind: 'emote' })),
  ]
  return () => {
    for (const stop of stops) stop()
  }
}
