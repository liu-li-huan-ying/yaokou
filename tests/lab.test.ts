import { describe, expect, it } from 'vitest'
import { labToRgb, rgbToLab } from '../src/sim/lab'

// 锚点值 2026-09-19 由 culori 与 chroma-js 双方一致给出（这两家在 Lab↔sRGB 上无分歧，
// 分歧只在 CIEDE2000；D65 白点）。
describe('lab 转换', () => {
  it('白与黑', () => {
    expect(rgbToLab({ r: 255, g: 255, b: 255 })).toMatchObject({ l: 100, a: 0, b: 0 })
    expect(rgbToLab({ r: 0, g: 0, b: 0 })).toMatchObject({ l: 0, a: 0, b: 0 })
    const white = labToRgb({ l: 100, a: 0, b: 0 })
    expect([white.r, white.g, white.b, white.inGamut]).toEqual([255, 255, 255, true])
    const black = labToRgb({ l: 0, a: 0, b: 0 })
    expect([black.r, black.g, black.b, black.inGamut]).toEqual([0, 0, 0, true])
  })

  it('中灰 128 → L* 53.585', () => {
    const lab = rgbToLab({ r: 128, g: 128, b: 128 })
    expect(lab.l).toBeCloseTo(53.585, 3)
    expect(lab.a).toBeCloseTo(0, 6)
    expect(lab.b).toBeCloseTo(0, 6)
    expect(labToRgb({ l: 53.585, a: 0, b: 0 }).r).toBe(128)
  })

  it('sRGB 纯红 → (53.2408, 80.0925, 67.2032)', () => {
    const lab = rgbToLab({ r: 255, g: 0, b: 0 })
    expect(lab.l).toBeCloseTo(53.2408, 3)
    expect(lab.a).toBeCloseTo(80.0925, 3)
    expect(lab.b).toBeCloseTo(67.2032, 3)
  })

  it('色域外标记为 inGamut false', () => {
    const result = labToRgb({ l: 50, a: 128, b: 0 })
    expect(result.inGamut).toBe(false)
    expect(result.r).toBe(255)
  })

  it('往返一致', () => {
    for (let i = 0; i < 256; i += 7) {
      for (let j = 0; j < 256; j += 11) {
        for (let k = 0; k < 256; k += 13) {
          const src = { r: i, g: j, b: k }
          const back = labToRgb(rgbToLab(src))
          expect([back.r, back.g, back.b]).toEqual([i, j, k])
        }
      }
    }
  })
})
