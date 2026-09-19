import { mulberry32 } from './rng'
import { TARGETS } from './targets'

/**
 * 单件基准价（贯）。离素色越远、越吃还原气氛的越贵，是难度的代理指标。
 * 放在这里而不是 targets.ts，是因为它是经济侧参数，不是藏品属性。
 *
 * 量级按"一窑毛利"倒推：一窑 4 件、燃料加料钱约 35-55 贯，
 * 全部正品时毛利要落在几十贯这一档，才既有机会有空间、又经不起连窑失手。
 */
export const BASE_PRICE: Record<string, number> = {
  天青: 34,
  粉青: 30,
  梅子青: 42,
  月白: 22,
  窑变朱: 62,
  茶叶末: 46,
  霁蓝: 70,
}

export interface Offer {
  /** kiln*10 + slot，同一窑内唯一 */
  id: number
  targetIndex: number
  qty: number
  /** 到第几窑为止必须交齐，过期按违约罚 */
  deadlineKiln: number
  pricePerPiece: number
}

/**
 * 生成一张新订单。rnd 由调用方注入，保证整局可重放。
 *
 * bias 传"当前已在手的色"：一窑只能一套配方，若订单完全均匀随机，
 * 4 个窑位几乎凑不出同色，窑常年装不满、收入撑不住成本。
 * 所以过半概率从已接的色里出单，让"凑满一窑"成为可规划的事。
 */
export function makeOffer(
  rnd: () => number,
  kiln: number,
  slot: number,
  bias: number[] = [],
): Offer {
  const useBias = bias.length > 0 && rnd() < 0.55
  const targetIndex = useBias
    ? bias[Math.floor(rnd() * bias.length) % bias.length]
    : Math.floor(rnd() * TARGETS.length) % TARGETS.length
  const qty = 1 + Math.floor(rnd() * 3)
  const deadlineKiln = kiln + 3 + Math.floor(rnd() * 4)
  const base = BASE_PRICE[TARGETS[targetIndex].name]
  const pricePerPiece = Math.round(base * (0.85 + rnd() * 0.35))
  return { id: kiln * 10 + slot, targetIndex, qty, deadlineKiln, pricePerPiece }
}

export function openingOffers(seed: number): Offer[] {
  const rnd = mulberry32(seed)
  return [makeOffer(rnd, 1, 0), makeOffer(rnd, 1, 1)]
}
