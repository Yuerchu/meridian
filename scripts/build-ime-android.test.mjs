import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { loadAlignments, misaligned, newestVersion } from './build-ime-android.mjs'

const READELF = `
Program Headers:
  Type           Offset   VirtAddr           PhysAddr           FileSiz  MemSiz   Flg Align
  PHDR           0x000040 0x0000000000000040 0x0000000000000040 0x000230 0x000230 R   0x8
  LOAD           0x000000 0x0000000000000000 0x0000000000000000 0x09e35c 0x09e35c R   0x4000
  LOAD           0x09e35c 0x00000000000a235c 0x00000000000a235c 0x1bed94 0x1bed94 R E 0x10000
  DYNAMIC        0x26d8a8 0x00000000002758a8 0x00000000002758a8 0x0001f0 0x0001f0 RW  0x8
`

test('reads only LOAD segments', () => {
  assert.deepEqual(loadAlignments(READELF), [0x4000, 0x10000])
})

test('16 KB and above pass; 4 KB and a library with no segments do not', () => {
  assert.deepEqual(misaligned([0x4000, 0x10000]), [])
  assert.deepEqual(misaligned([0x4000, 0x1000]), ['0x1000'])
  assert.deepEqual(misaligned([]), ['no LOAD segments'])
  assert.deepEqual(misaligned([Number.NaN]), ['0xNaN'])
})

test('the newest NDK is chosen by version, not by string', () => {
  assert.equal(newestVersion(['27.0.12077973', '28.2.13676358', '9.9.1', '.DS_Store']), '28.2.13676358')
  assert.equal(newestVersion(['28.10.1', '28.9.9']), '28.10.1')
  assert.equal(newestVersion([]), null)
})
