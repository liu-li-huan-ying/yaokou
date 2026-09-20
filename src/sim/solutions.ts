import type { Curve, Recipe } from './balance'
import { TARGETS } from './targets'

/**
 * 方子表与釉料池判据。全游戏（界面"照这单调方"、订单生成、机器人策略）
 * 都从这里问"这色要哪几味料"，判据只有一处。
 */
export const OXIDES = ['fe', 'cu', 'co'] as const

export function solutionFor(targetIndex: number): { recipe: Recipe; curve: Curve } {
  return TARGETS[targetIndex].glaze
}

/** 这方子点名要哪几味料（加了多少就算要） */
export function needsOf(targetIndex: number): string[] {
  const { recipe } = TARGETS[targetIndex].glaze
  return OXIDES.filter((k) => recipe[k] > 0)
}

/** 池外的料一归零就不是那个色了，所以这单本局根本交不了 */
export function fillable(targetIndex: number, pool: string[]): boolean {
  return needsOf(targetIndex).every((k) => pool.includes(k))
}

/** 本局接得了的目标序号 */
export function fillableTargets(pool: string[]): number[] {
  return TARGETS.map((_, i) => i).filter((i) => fillable(i, pool))
}
