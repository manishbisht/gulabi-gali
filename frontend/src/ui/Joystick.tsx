import { useRef, useState, type PointerEvent } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { Vec2 } from '../world/types'

/** Knob travel from centre, in CSS px. A push this far is full speed. */
const RADIUS = 48

const isCoarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

interface Props {
  lang: Lang
  /** x is right, z is forward (screen up), length at most 1. */
  onChange: (v: Vec2) => void
}

export function Joystick({ lang, onChange }: Props) {
  const [coarse] = useState(isCoarse)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const origin = useRef<{ id: number; x: number; y: number } | null>(null)
  if (!coarse) return null

  const report = (e: PointerEvent<HTMLDivElement>) => {
    const o = origin.current
    if (!o || o.id !== e.pointerId) return
    let dx = e.clientX - o.x
    let dy = e.clientY - o.y
    const len = Math.hypot(dx, dy)
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS
      dy = (dy / len) * RADIUS
    }
    setKnob({ x: dx, y: dy })
    onChange({ x: dx / RADIUS, z: -dy / RADIUS })
  }
  const release = (e: PointerEvent<HTMLDivElement>) => {
    if (origin.current?.id !== e.pointerId) return
    origin.current = null
    setKnob({ x: 0, y: 0 })
    onChange({ x: 0, z: 0 })
  }

  return (
    <div
      className="joystick"
      role="group"
      aria-label={t('joystickLabel', lang)}
      onPointerDown={(e) => {
        if (origin.current) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const r = e.currentTarget.getBoundingClientRect()
        origin.current = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 }
        report(e)
      }}
      onPointerMove={report}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  )
}
