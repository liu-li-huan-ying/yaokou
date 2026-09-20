import type { Curve, Recipe } from './balance'
import type { Lab } from './deltae'

/**
 * 一色一方的"传世方子"。
 *
 * 为什么写死成数据而不是运行时搜索：釉料池要回答"这单本局烧不烧得出来"，
 * 而搜索器每回可能顺手多用一味料——那味料一旦不在罐里，归零后就不是那个色了，
 * 判据会随 seed 漂。方子定成数据，池子判定才是查表。
 *
 * 每方都是在"只给那几味料"的约束下搜出来的最优解，所以七色全部落在珍品档；
 * 招牌料也读得出来：素釉（月白）、铁青（天青淡、梅子青浓）、铜绿（粉青，氧化）、
 * 铜红（窑变朱，还原）、铁铜并用（茶叶末）、一入即蓝的钴（霁蓝）。
 * Lab 是按模型真能烧到的样子校准过的设计值。
 */
export interface GlazeTarget {
  name: string
  /** 器型代号，订单用它约束窑位 */
  form: string
  lab: Lab
  source: string
  glaze: { recipe: Recipe; curve: Curve }
}

export const TARGETS: GlazeTarget[] = [
  {
    name: '天青',
    form: '洗',
    lab: { l: 73, a: -8, b: 13 },
    source: '设计值',
    glaze: {
      recipe: { fe: 0.73, cu: 0, co: 0, flux: 0.44 },
      curve: { tmax: 1296, soak: 12, reduction: 0.71, reductionStart: 1138, cooling: 3.0 },
    },
  },
  {
    name: '粉青',
    form: '瓶',
    lab: { l: 77, a: -10, b: 16 },
    source: '设计值',
    glaze: {
      recipe: { fe: 0, cu: 0.36, co: 0, flux: 0.34 },
      curve: { tmax: 1253, soak: 28, reduction: 0.0, reductionStart: 1134, cooling: 5.5 },
    },
  },
  {
    name: '梅子青',
    form: '罐',
    lab: { l: 60, a: -16, b: 18 },
    source: '设计值',
    glaze: {
      recipe: { fe: 7.25, cu: 0, co: 0, flux: 0.21 },
      curve: { tmax: 1192, soak: 16, reduction: 0.8, reductionStart: 960, cooling: 5.1 },
    },
  },
  {
    name: '月白',
    form: '盘',
    lab: { l: 88, a: -2, b: 8 },
    source: '设计值',
    glaze: {
      recipe: { fe: 0, cu: 0, co: 0, flux: 0.45 },
      curve: { tmax: 1220, soak: 8, reduction: 0.86, reductionStart: 910, cooling: 4.8 },
    },
  },
  {
    name: '窑变朱',
    form: '梅瓶',
    lab: { l: 51, a: 33, b: 6 },
    source: '设计值',
    glaze: {
      recipe: { fe: 0, cu: 3.69, co: 0, flux: 0.15 },
      curve: { tmax: 1248, soak: 34, reduction: 0.75, reductionStart: 1116, cooling: 2.7 },
    },
  },
  {
    name: '茶叶末',
    form: '壶',
    lab: { l: 42, a: -2, b: 20 },
    source: '设计值',
    glaze: {
      recipe: { fe: 7.97, cu: 0.89, co: 0, flux: 0.2 },
      curve: { tmax: 1177, soak: 49, reduction: 0.46, reductionStart: 915, cooling: 6.7 },
    },
  },
  {
    name: '霁蓝',
    form: '碗',
    lab: { l: 41, a: 8, b: -37 },
    source: '设计值',
    glaze: {
      recipe: { fe: 0, cu: 0, co: 2, flux: 0.32 },
      curve: { tmax: 1211, soak: 46, reduction: 0.12, reductionStart: 1250, cooling: 1.5 },
    },
  },
]
