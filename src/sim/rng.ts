/** 全项目唯一的随机源：seeded、确定性，同一 seed 必得同一序列。 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomIn(rnd: () => number, lo: number, hi: number): number {
  return lo + rnd() * (hi - lo)
}

export function pickInt(rnd: () => number, lo: number, hi: number): number {
  return Math.floor(randomIn(rnd, lo, hi + 1))
}
