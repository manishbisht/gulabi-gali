/// <reference types="node" />
import { existsSync } from 'node:fs'
import { allPreviewPages } from './pages'

/*
 * What vite.config.ts emits: every preview page, made while this module loads (Vite's module runner closes once
 * the import is done, so the districts are loaded here, not after). Never imported by the app.
 */
const PUBLIC = new URL('../../public/', import.meta.url)

export const pages = await allPreviewPages((file) => existsSync(new URL(file, PUBLIC)))
