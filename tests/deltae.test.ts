import { describe, expect, it } from 'vitest'
import { diff } from 'color-diff'
import { deltaE2000, type Lab } from '../src/sim/deltae'

// 期望值 2026-09-19 由 color-diff@1.4.0 本机实跑取得。
// 其中前三行同时命中 Sharma 等人 2005 年公开测试表的 2.0425 / 2.8615 / 1.0000，
// 这是把 color-diff 当 oracle 而非 chroma-js / culori（后两者在蓝区系统性偏小）的依据。
const FIXTURES: Array<{ name: string; x: Lab; y: Lab; expected: number }> = [
  { name: '蓝区高彩度', x: { l: 50, a: 2.6772, b: -79.7751 }, y: { l: 50, a: 0, b: -82.7485 }, expected: 2.04246 },
  { name: '蓝区高彩度第二组', x: { l: 50, a: 3.1571, b: -77.2803 }, y: { l: 50, a: 0, b: -82.7485 }, expected: 2.86151 },
  { name: '近中性青', x: { l: 50, a: -1.3802, b: -84.2814 }, y: { l: 50, a: 0, b: -82.7485 }, expected: 0.999999 },
  { name: '无彩近邻', x: { l: 50, a: 0, b: 0 }, y: { l: 50, a: 0, b: -0.0001 }, expected: 0.0001 },
  { name: '色相旋转区翻转', x: { l: 50, a: 2.49, b: -0.0001 }, y: { l: 50, a: -2.49, b: 0.0001 }, expected: 7.179331 },
  { name: '极小 b 差', x: { l: 50, a: 2.49, b: 0.0001 }, y: { l: 50, a: 2.49, b: -0.0001 }, expected: 0.000186 },
  { name: '纯明度差', x: { l: 0, a: 0, b: 0 }, y: { l: 100, a: 0, b: 0 }, expected: 100 },
  { name: '一般色差', x: { l: 70, a: -12, b: 25 }, y: { l: 62, a: -4, b: 31 }, expected: 9.802175 },
  { name: '大色差', x: { l: 50, a: 60, b: -30 }, y: { l: 40, a: 20, b: 10 }, expected: 25.436199 },
]

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('deltaE2000', () => {
  for (const f of FIXTURES) {
    it(`${f.name} 命中参考值`, () => {
      expect(deltaE2000(f.x, f.y)).toBeCloseTo(f.expected, 4)
    })
  }

  it('自身与 color-diff 在 300 组 seeded 随机 Lab 上一致', () => {
    const rnd = mulberry32(20260919)
    for (let i = 0; i < 300; i++) {
      const x: Lab = { l: rnd() * 100, a: rnd() * 160 - 80, b: rnd() * 160 - 80 }
      const y: Lab = { l: rnd() * 100, a: rnd() * 160 - 80, b: rnd() * 160 - 80 }
      const mine = deltaE2000(x, y)
      const oracle = diff({ L: x.l, a: x.a, b: x.b }, { L: y.l, a: y.a, b: y.b })
      expect(Math.abs(mine - oracle)).toBeLessThan(1e-9)
    }
  })

  it('同一颜色距离为 0', () => {
    expect(deltaE2000({ l: 62, a: -8, b: 14 }, { l: 62, a: -8, b: 14 })).toBe(0)
  })

  it('对称', () => {
    const x: Lab = { l: 70, a: 20, b: -30 }
    const y: Lab = { l: 45, a: -12, b: 8 }
    expect(deltaE2000(x, y)).toBeCloseTo(deltaE2000(y, x), 12)
  })

  it('非负', () => {
    const rnd = mulberry32(7)
    for (let i = 0; i < 200; i++) {
      const x: Lab = { l: rnd() * 100, a: rnd() * 160 - 80, b: rnd() * 160 - 80 }
      const y: Lab = { l: rnd() * 100, a: rnd() * 160 - 80, b: rnd() * 160 - 80 }
      expect(deltaE2000(x, y)).toBeGreaterThanOrEqual(0)
    }
  })

  // 平均 L* 恰为 50 时 SL = 1 + 0.015·0²/√20 = 1，且彩度为 0 使 dC=dH=0，
  // 于是 ΔE000 必须精确等于 ΔL。取 45→55 而不是 50→60（后者均值 55 会让 SL≈1.056）。
  it('平均明度为 50 的纯明度差等于 ΔL', () => {
    expect(deltaE2000({ l: 45, a: 0, b: 0 }, { l: 55, a: 0, b: 0 })).toBeCloseTo(10, 12)
  })
})
