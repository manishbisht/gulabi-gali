export const PALETTE = {
  pink: '#E4917A',
  terracotta: '#B85C45',
  sandstone: '#D9B382',
  ochre: '#C98A2B',
  white: '#F6EFE4',
  teal: '#2F7F86',
  marigold: '#F2A81D',
  road: '#4A4543',
  grass: '#7C9A5A',
  glass: '#5F9FC4',
} as const

export type PaletteKey = keyof typeof PALETTE
