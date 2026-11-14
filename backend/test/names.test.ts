import { describe, expect, it } from 'vitest'
import { cleanName } from '../src/names'

describe('cleanName', () => {
  it('trims, collapses whitespace, caps at 24 chars', () => {
    expect(cleanName('  Ada   Lovelace  ')).toBe('Ada Lovelace')
    expect(cleanName('x'.repeat(40))).toBe('x'.repeat(24))
  })
  it('rejects empty and non-strings', () => {
    expect(cleanName('   ')).toBeNull()
    expect(cleanName(42)).toBeNull()
    expect(cleanName(undefined)).toBeNull()
  })
  it('rejects one-character names', () => {
    expect(cleanName('A')).toBeNull()
    expect(cleanName(' A ')).toBeNull()
    expect(cleanName('Aa')).toBe('Aa')
  })
  it('strips what draws as nothing or turns the text around', () => {
    expect(cleanName('Ann‮gnp.exe')).toBe('Anngnp.exe')
    expect(cleanName('⁦Ben⁩')).toBe('Ben')
    expect(cleanName('Z​o​e')).toBe('Zoe')
    expect(cleanName('Cy\u0000\u0007\u007F')).toBe('Cy')
    expect(cleanName('Soft­hyphen')).toBe('Softhyphen')
    for (const blank of ['​​', 'ㅤ', '⠀⠀', '‮', '‍', '﻿']) expect(cleanName(blank)).toBeNull()
  })
  it('keeps the joiners and selectors real names and emoji are made of', () => {
    expect(cleanName('👩‍💻 Dev')).toBe('👩‍💻 Dev')
    expect(cleanName('❤️❤')).toBe('❤️❤')
    expect(cleanName('می‌خواهم')).toBe('می‌خواهم')
    expect(cleanName('‍Ann‍')).toBe('Ann')
  })
  it('composes to NFC, and keeps accents to a sane height', () => {
    expect(cleanName('Zoé')).toBe('Zoé')
    expect(cleanName('Zoé')!.length).toBe(3)
    expect(cleanName('Z' + '̶'.repeat(40))).toBe('Z' + '̶'.repeat(3))
  })
  it('caps by characters as a reader counts them, never splitting one', () => {
    expect([...cleanName('😀'.repeat(30))!]).toHaveLength(24)
    const family = '👨‍👩‍👧'
    expect(cleanName('x'.repeat(22) + family)).toBe('x'.repeat(22))
    expect(cleanName('x'.repeat(19) + family)).toBe('x'.repeat(19) + family)
  })
})
