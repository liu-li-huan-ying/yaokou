import { mulberry32 } from './rng'

/**
 * 元进度层。三条硬规矩（来自设计文档）：
 * 1. 解锁只加选项，不加数值上限——解锁"铜料"是多一个可选料罐，
 *    不是把铁的上限抬高；
 * 2. 每局开局可用釉料池 = 已解锁池的随机子集，防止后期"全都解锁 → 每局一样"；
 * 3. 存档是 localStorage 里的明文 JSON，用户自己能打开改。
 */

export const META_KEY = 'yaokou.meta.v1'

export type UnlockKind = 'glaze' | 'tool' | 'plan'

export interface Unlockable {
  id: string
  name: string
  kind: UnlockKind
  cost: number
  blurb: string
}

export const UNLOCKABLES: Unlockable[] = [
  { id: 'cu', name: '铜料', kind: 'glaze', cost: 40, blurb: '开一罐铜：氧化出绿，还原则红。' },
  { id: 'co', name: '钴料', kind: 'glaze', cost: 70, blurb: '开一罐钴：一入即蓝，压得住全场。' },
  { id: 'qi', name: '匣钵', kind: 'tool', cost: 55, blurb: '每件套一只匣钵，流釉粘足的风险减半。' },
  { id: 'zhiding', name: '支钉', kind: 'tool', cost: 35, blurb: '垫足烧，高温变形风险降三成。' },
  { id: 'plan-straight', name: '直焰窑图', kind: 'plan', cost: 80, blurb: '窑位温差改成前热后冷的单调梯度。' },
  { id: 'plan-tight', name: '密檐窑图', kind: 'plan', cost: 95, blurb: '窑位间温差收窄一半，但少一个窑位。' },
]

/** 每局至少给两种料可选，否则开局毫无决策 */
export const MIN_POOL = 2

export interface MetaState {
  renown: number
  unlocked: string[]
  runs: number
  bestScore: number
  /** 配方笔记：局末分数不保留，但你自己记的东西永久留着 */
  notes: Array<{ label: string; fe: number; cu: number; co: number; flux: number; tmax: number; reduction: number }>
}

export const DEFAULT_META: MetaState = {
  renown: 0,
  unlocked: [],
  runs: 0,
  bestScore: 0,
  notes: [],
}

export function unlockById(id: string): Unlockable | undefined {
  return UNLOCKABLES.find((u) => u.id === id)
}

/**
 * 局末口碑：按交付评级累计，违约要扣。
 * 刻意与"剩余现金"无关——有钱但一件没交的人不该涨口碑。
 */
export function renownEarned(grades: Record<string, number>, breached: number): number {
  const points =
    (grades['珍品'] ?? 0) * 4 + (grades['正品'] ?? 0) * 2 + (grades['粗器'] ?? 0) * 1
  return Math.max(0, Math.round(points - breached * 2))
}

export function canBuy(meta: MetaState, id: string): boolean {
  const item = unlockById(id)
  if (item === undefined) return false
  if (meta.unlocked.includes(id)) return false
  return meta.renown >= item.cost
}

export function buy(meta: MetaState, id: string): MetaState {
  if (!canBuy(meta, id)) return meta
  const item = unlockById(id) as Unlockable
  return {
    ...meta,
    renown: meta.renown - item.cost,
    unlocked: [...meta.unlocked, id],
  }
}

/** 釉料池 = 已解锁的料 + 铁（铁是起手就会的），每局取随机子集但保底 MIN_POOL */
export function drawGlazePool(seed: number, meta: MetaState): string[] {
  const owned = ['fe', ...meta.unlocked.filter((id) => unlockById(id)?.kind === 'glaze')]
  if (owned.length <= MIN_POOL) return owned
  const rnd = mulberry32(seed * 2654435761)
  /** 铁保底在池里，其余每个独立 55% 概率入池，不够 MIN_POOL 就补 */
  const pool = ['fe', ...owned.slice(1).filter(() => rnd() < 0.55)]
  if (pool.length >= MIN_POOL) return pool
  for (const id of owned) if (!pool.includes(id)) pool.push(id)
  return pool.slice(0, Math.max(MIN_POOL, pool.length))
}

/**
 * 窑炉图纸决定"位置 → 温偏"的形状。默认拱窑是乱序散布。
 * 只改形状，不改幅度上限——幅度归开局修饰符管。
 */
export function shapeOffsets(
  planId: string | undefined,
  raw: number[],
  lo: number,
  hi: number,
): number[] {
  const span = hi - lo
  switch (planId) {
    case 'plan-straight': {
      const n = raw.length
      return raw.map((_, i) => lo + (span * (n - i)) / (n + 1))
    }
    case 'plan-tight': {
      const mid = (lo + hi) / 2
      const shrunk = raw.map((v) => mid + (v - mid) * 0.5)
      return shrunk.slice(0, Math.max(1, raw.length - 1))
    }
    default:
      return raw
  }
}

/** 存档是用户可编辑的外部输入，坏了要退回默认而不是崩 */
export function loadMeta(store: Pick<Storage, 'getItem'> | null): MetaState {
  if (store === null) return { ...DEFAULT_META }
  let raw: string | null = null
  try {
    raw = store.getItem(META_KEY)
  } catch {
    return { ...DEFAULT_META }
  }
  if (raw === null) return { ...DEFAULT_META }
  try {
    const parsed = JSON.parse(raw) as Partial<MetaState>
    const known = new Set(UNLOCKABLES.map((u) => u.id))
    return {
      renown: Number.isFinite(parsed.renown) ? Math.max(0, Number(parsed.renown)) : 0,
      unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked.filter((id) => known.has(id)) : [],
      runs: Number.isFinite(parsed.runs) ? Math.max(0, Number(parsed.runs)) : 0,
      bestScore: Number.isFinite(parsed.bestScore) ? Math.max(0, Number(parsed.bestScore)) : 0,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    }
  } catch {
    return { ...DEFAULT_META }
  }
}

export function saveMeta(store: Pick<Storage, 'setItem'> | null, meta: MetaState): void {
  if (store === null) return
  try {
    store.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* 隐私模式或配额满：元进度丢了不致命，本局照玩 */
  }
}
