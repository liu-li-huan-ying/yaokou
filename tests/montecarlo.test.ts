import { describe, expect, it } from 'vitest'
import { POLICIES } from '../src/sim/policies'
import { newRun, summarize, type RunSummary } from '../src/sim/run'

const SEEDS = 200
const GUARD = 40

function playOne(policyName: string, seed: number): RunSummary {
  const policy = POLICIES.find((p) => p.name === policyName)
  if (policy === undefined) throw new Error(`无此策略 ${policyName}`)
  let state = newRun(seed)
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
  cashMean: number
  cashMedian: number
  kilnsMean: number
  piecesMean: number
  bankruptRate: number
  zhenpinRate: number
  scrapRate: number
  runs: RunSummary[]
}

function statsOf(name: string, runs: RunSummary[]): Stats {
  const cash = runs.map((r) => r.cash).sort((a, b) => a - b)
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
  const pieces = runs.reduce((s, r) => s + r.pieces, 0)
  const zhenpin = runs.reduce((s, r) => s + (r.grades['珍品'] ?? 0), 0)
  const scrap = runs.reduce((s, r) => s + (r.grades['废品'] ?? 0), 0)
  return {
    name,
    cashMean: mean(cash),
    cashMedian: cash[Math.floor(cash.length / 2)],
    kilnsMean: mean(runs.map((r) => r.kilns)),
    piecesMean: pieces / runs.length,
    bankruptRate: runs.filter((r) => r.bankrupt).length / runs.length,
    zhenpinRate: pieces === 0 ? 0 : zhenpin / pieces,
    scrapRate: pieces === 0 ? 0 : scrap / pieces,
    runs,
  }
}

const all: Stats[] = POLICIES.map((p) =>
  statsOf(
    p.name,
    Array.from({ length: SEEDS }, (_, i) => playOne(p.name, i + 1)),
  ),
)

const byName = new Map(all.map((s) => [s.name, s]))
const pick = (name: string): Stats => byName.get(name) as Stats

describe('200 局 Monte Carlo：循环引擎真伪检查', () => {
  it('打印五策略对照表', () => {
    const head = '策略        平均现金   中位现金  平均窑数  平均件数  破产率  珍品率  废品率'
    const rows = all.map(
      (s) =>
        `${s.name.padEnd(6, ' ')}      ${s.cashMean.toFixed(1).padStart(8)}  ${s.cashMedian
          .toFixed(0)
          .padStart(8)}  ${s.kilnsMean.toFixed(1).padStart(8)}  ${s.piecesMean
          .toFixed(1)
          .padStart(8)}  ${(s.bankruptRate * 100).toFixed(0).padStart(5)}%  ${(
          s.zhenpinRate * 100
        )
          .toFixed(0)
          .padStart(5)}%  ${(s.scrapRate * 100).toFixed(0).padStart(5)}%`,
    )
    console.log(['\n' + head, ...rows].join('\n'))
    expect(true).toBe(true)
  })

  it('技能有意义：会求解的必须明显强于躺平与乱烧', () => {
    const solver = pick('按单求解')
    const adaptive = pick('看行情应变')
    const idle = pick('躺平')
    const random = pick('乱烧')
    expect(solver.cashMean).toBeGreaterThan(idle.cashMean * 1.5)
    expect(adaptive.cashMean).toBeGreaterThan(random.cashMean * 1.5)
    expect(idle.bankruptRate).toBeGreaterThan(0.8)
  })

  it('循环不假：一套固定配方压不倒按单应变', () => {
    const fixed = pick('一法到底')
    const best = Math.max(pick('按单求解').cashMean, pick('看行情应变').cashMean)
    // 设计文档的门槛：固定策略若超过最优应变策略的 1.5 倍，判"循环是假的"
    expect(fixed.cashMean).toBeLessThan(best * 1.5)
    expect(fixed.cashMean).toBeLessThanOrEqual(best)
  })

  it('赢家随种子变化（不是同一策略通吃所有局面）', () => {
    const wins = new Map<string, number>()
    for (let seed = 1; seed <= SEEDS; seed++) {
      let bestName = ''
      let bestCash = Number.NEGATIVE_INFINITY
      for (const p of POLICIES) {
        const cash = (byName.get(p.name) as Stats).runs[seed - 1].cash
        if (cash > bestCash) {
          bestCash = cash
          bestName = p.name
        }
      }
      wins.set(bestName, (wins.get(bestName) ?? 0) + 1)
    }
    const report = [...wins.entries()].map(([k, v]) => `${k}:${v}`)
    console.log(`每局赢家分布 ${report.join(' ')}`)
    const share = (n: string): number => (wins.get(n) ?? 0) / SEEDS
    const top = pick('按单求解')
    const adaptive = pick('看行情应变')
    const dominant = Math.max(share(top.name), share(adaptive.name))
    expect(dominant).toBeLessThan(0.95)
    expect(wins.size).toBeGreaterThanOrEqual(2)
  })

  it('难度落在可用区间：应变策略既不会必死也不会必活', () => {
    const adaptive = pick('看行情应变')
    expect(adaptive.bankruptRate).toBeGreaterThan(0.02)
    expect(adaptive.bankruptRate).toBeLessThan(0.85)
    expect(adaptive.cashMean).toBeGreaterThan(0)
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
