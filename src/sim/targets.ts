import type { Lab } from './deltae'

export interface GlazeTarget {
  name: string
  /** 器型代号，M1 起订单用它约束窑位 */
  form: string
  lab: Lab
  /** 本阶段是设计值（我们定的目标色），M3 换成 Met 藏品原片采样后的真值 */
  source: string
}

export const TARGETS: GlazeTarget[] = [
  { name: '天青', form: '洗', lab: { l: 72, a: -8, b: 6 }, source: '设计值' },
  { name: '粉青', form: '瓶', lab: { l: 76, a: -11, b: 11 }, source: '设计值' },
  { name: '梅子青', form: '罐', lab: { l: 60, a: -15, b: 16 }, source: '设计值' },
  { name: '月白', form: '盘', lab: { l: 88, a: -4, b: 3 }, source: '设计值' },
  { name: '窑变朱', form: '梅瓶', lab: { l: 50, a: 28, b: 4 }, source: '设计值' },
  { name: '茶叶末', form: '壶', lab: { l: 42, a: -2, b: 18 }, source: '设计值' },
  { name: '霁蓝', form: '碗', lab: { l: 40, a: 5, b: -28 }, source: '设计值' },
]
