import { describe, expect, it } from 'vitest'
import { draftModifiers } from '../src/sim/modifiers'
import { POLICIES } from '../src/sim/policies'
import { newRun, summarize, type RunSummary } from '../src/sim/run'

const SEEDS = 200
const GUARD = 40

/** 两档池子：白手只有铁，满罐三味齐全。差出来的分就是"解锁到底值不值" */
const TIERS: Record<string, string[]> = {
  白手: ['fe'],
  满罐: ['fe', 'cu', 'co'],
}

function playOne(policyName: string, seed: number, pool: string[]): RunSummary {
  const policy = POLICIES.find((p) => p.name === policyName)
  if (policy === undefined) throw new Error(`无此策略 ${policyName}`)
  // 按 seed 抽开局修饰符，与玩家实际开局一致：不抽就等于 MC 只测了默认那张"稳火"
  const state0 = newRun(seed, draftModifiers(seed)[0].id, { pool })
  let state = state0
  let steps = 0
  while (!state.over && steps < GUARD) {
    state = policy.play(state)
    steps += 1
  }
  expect(steps).toBeLessThan(GUARD)
  return summarize(state)
}

interface Stats {
  name: string
  scoreMean: number
  scoreMedian: number
  cashMean: number
  kilnsMean: number
  deliveredMean: number
  bankruptRate: number
  zhenpinRate: number
  scrapRate: number
  runs: RunSummary[]
}

function statsOf(name: string, runs: RunSummary[]): Stats {
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
  const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b)
  const score = sorted(runs.map((r) => r.score))
  const fired = runs.reduce((s, r) => s + r.fired, 0)
  const zhenpin = runs.reduce((s, r) => s + (r.grades['珍品'] ?? 0), 0)
  const scrap = runs.reduce((s, r) => s + (r.grades['废品'] ?? 0), 0)
  return {
    name,
    scoreMean: mean(score),
    scoreMedian: score[Math.floor(score.length / 2)],
    cashMean: mean(runs.map((r) => r.cash)),
    kilnsMean: mean(runs.map((r) => r.kilns)),
    deliveredMean: runs.reduce((s, r) => s + r.delivered, 0) / runs.length,
    bankruptRate: runs.filter((r) => r.bankrupt).length / runs.length,
    zhenpinRate: fired === 0 ? 0 : zhenpin / fired,
    scrapRate: fired === 0 ? 0 : scrap / fired,
    runs,
  }
}

function tableOf(pool: string[]): Map<string, Stats> {
  return new Map(
    POLICIES.map((p) =>
      statsOf(
        p.name,
        Array.from({ length: SEEDS }, (_, i) => playOne(p.name, i + 1, pool)),
      ),
    ).map((s) => [s.name, s]),
  )
}

const byTier = new Map<string, Map<string, Stats>>(
  Object.entries(TIERS).map(([tier, pool]) => [tier, tableOf(pool)]),
)
const all: Stats[] = [...byTier.get('白手')!.values()]

const pick = (name: string): Stats => byTier.get('白手')!.get(name) as Stats
const pickTier = (tier: string, name: string): Stats => byTier.get(tier)!.get(name) as Stats

/**
 * 每个种子的赢家按"分"定，且平分不算赢。
 * 上一版按剩余现金排名，躺平（不接单、每窑烧空、+10）会在部分种子上
 * 赢过玩砸了的破产者（负数）——那是计分口径的错，不是策略的功劳。
 */
function winnersOf(tier: string): Map<string, number> {
  const table = byTier.get(tier) as Map<string, Stats>
  const out = new Map<string, number>()
  for (let seed = 1; seed <= SEEDS; seed++) {
    let bestName = ''
    let bestScore = -1
    let tie = false
    for (const p of POLICIES) {
      const score = (table.get(p.name) as Stats).runs[seed - 1].score
      if (score > bestScore) {
        bestScore = score
        bestName = p.name
        tie = false
      } else if (score === bestScore) {
        tie = true
      }
    }
    if (!tie) out.set(bestName, (out.get(bestName) ?? 0) + 1)
  }
  return out
}

const winners = winnersOf('白手')

describe('200 局 Monte Carlo：循环引擎真伪检查', () => {
  it('打印五策略对照表', () => {
    const pct = (v: number): string => `${(v * 100).toFixed(0)}%`.padStart(5)
    const head = '策略      平均分  中位分  平均现金  平均窑数  交付件数  破产率  珍品率  废品率'
    const rows = all.map(
      (s) =>
        `${s.name.padEnd(6, ' ')}  ${s.scoreMean.toFixed(1).padStart(7)}  ${s.scoreMedian
          .toFixed(0)
          .padStart(6)}  ${s.cashMean.toFixed(0).padStart(8)}  ${s.kilnsMean
          .toFixed(1)
          .padStart(8)}  ${s.deliveredMean.toFixed(1).padStart(8)}  ${pct(s.bankruptRate)}  ${pct(
          s.zhenpinRate,
        )}  ${pct(s.scrapRate)}`,
    )
    console.log(['\n' + head, ...rows].join('\n'))
    expect(true).toBe(true)
  })

  it('技能有意义：会求解的分数远高于躺平与乱烧', () => {
    expect(pick('躺平').scoreMean).toBe(0)
    expect(pick('按单求解').scoreMean).toBeGreaterThan(60)
    expect(pick('看行情应变').scoreMean).toBeGreaterThan(60)
    expect(pick('乱烧').scoreMean).toBeLessThan(20)
  })

  it('循环不假：一套固定配方压不倒按单应变', () => {
    const fixed = pick('一法到底')
    const best = Math.max(pick('按单求解').scoreMean, pick('看行情应变').scoreMean)
    // 设计文档的门槛：固定策略若超过最优应变策略的 1.5 倍，判"循环是假的"
    expect(fixed.scoreMean).toBeLessThan(best * 1.5)
    expect(fixed.scoreMean).toBeLessThanOrEqual(best)
  })

  it('赢家随种子变化；躺平结构性地绝不赢，乱烧只在方差里侥幸', () => {
    const report = [...winners.entries()].map(([k, v]) => `${k}:${v}`)
    console.log(`每局赢家分布 ${report.join(' ')}`)
    // 躺平一条都没交付，分数恒为 0：任何交付过一件的人都能压住它，这是结构保证
    expect(winners.get('躺平') ?? 0).toBe(0)
    // 随机策略偶尔在个别种子上赢（实测 1/200）属正常方差，只要不成气候
    expect((winners.get('乱烧') ?? 0) / SEEDS).toBeLessThan(0.05)
    const share = (n: string): number => (winners.get(n) ?? 0) / SEEDS
    expect(Math.max(share('按单求解'), share('看行情应变'))).toBeLessThan(0.95)
    expect(winners.size).toBeGreaterThanOrEqual(2)
  })

  it('难度落在可用区间：应变策略既不会必死也不会必活', () => {
    const adaptive = pick('看行情应变')
    expect(adaptive.bankruptRate).toBeGreaterThan(0.02)
    expect(adaptive.bankruptRate).toBeLessThan(0.85)
    expect(adaptive.scoreMean).toBeGreaterThan(60)
  })

  it('会玩的人单局长度落在 15 分钟预算内（12-18 窑）', () => {
    // 只约束胜任策略：躺平与乱烧本来就该早死，那是失败条件在起作用，不是长度失控
    for (const name of ['按单求解', '看行情应变']) {
      const s = pick(name)
      expect(s.kilnsMean).toBeGreaterThanOrEqual(12)
      expect(s.kilnsMean).toBeLessThanOrEqual(17)
    }
  })
})

describe('两档池子对照：解锁到底改变了什么', () => {
  it('打印满罐档对照表', () => {
    const rows = [...byTier.get('满罐')!.values()].map(
      (s) =>
        `${s.name.padEnd(6, ' ')}  ${s.scoreMean.toFixed(1).padStart(7)}  ${s.kilnsMean
          .toFixed(1)
          .padStart(6)}  ${s.deliveredMean.toFixed(1).padStart(6)}  ${(s.bankruptRate * 100)
          .toFixed(0)
          .padStart(4)}%`,
    )
    console.log(['\n策略      平均分  平均窑数  交付件数  破产率', ...rows].join('\n'))
    expect(true).toBe(true)
  })

  it('会求解的策略在满罐下确实更强：订单册变宽了', () => {
    for (const name of ['按单求解', '看行情应变']) {
      expect(pickTier('满罐', name).scoreMean).toBeGreaterThan(pickTier('白手', name).scoreMean)
    }
  })

  it('但解锁不会把循环买成假的：满罐下固定一套配方照样压不倒应变', () => {
    const fixed = pickTier('满罐', '一法到底')
    const best = Math.max(
      pickTier('满罐', '按单求解').scoreMean,
      pickTier('满罐', '看行情应变').scoreMean,
    )
    expect(fixed.scoreMean).toBeLessThan(best)
  })

  it('两档里躺平都赢不了；满罐的赢家也不再只有一人', () => {
    const full = winnersOf('满罐')
    console.log(`满罐赢家分布 ${[...full.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}`)
    for (const tier of ['白手', '满罐']) {
      expect(winnersOf(tier).get('躺平') ?? 0).toBe(0)
    }
    expect(full.size).toBeGreaterThanOrEqual(2)
  })
})
