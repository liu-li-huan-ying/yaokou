import type { Lab } from './deltae'

export interface Rgb255 {
  r: number
  g: number
  b: number
}

export interface LabToRgbResult extends Rgb255 {
  /** false 表示该 Lab 落在 sRGB 色域外，给出的 RGB 是被裁到边界的结果 */
  inGamut: boolean
}

const WHITE_X = 0.95047
const WHITE_Z = 1.08883
const EPSILON = 216 / 24389
const KAPPA = 24389 / 27
const GAMUT_EPS = 1e-6

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

function forward(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116
}

function inverse(t: number): number {
  const t3 = t * t * t
  return t3 > EPSILON ? t3 : (116 * t - 16) / KAPPA
}

const clamp255 = (v: number): number => Math.min(255, Math.max(0, Math.round(v * 255)))

export function rgbToLab({ r, g, b }: Rgb255): Lab {
  const lr = srgbToLinear(r / 255)
  const lg = srgbToLinear(g / 255)
  const lb = srgbToLinear(b / 255)

  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / WHITE_X
  const y = 0.2126729 * lr + 0.7151521 * lg + 0.072175 * lb
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / WHITE_Z

  const fx = forward(x)
  const fy = forward(y)
  const fz = forward(z)

  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

export function labToRgb(lab: Lab): LabToRgbResult {
  const fy = (lab.l + 16) / 116
  const fx = fy + lab.a / 500
  const fz = fy - lab.b / 200

  const x = WHITE_X * inverse(fx)
  const y = inverse(fy)
  const z = WHITE_Z * inverse(fz)

  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z

  const inGamut =
    lr >= -GAMUT_EPS && lr <= 1 + GAMUT_EPS &&
    lg >= -GAMUT_EPS && lg <= 1 + GAMUT_EPS &&
    lb >= -GAMUT_EPS && lb <= 1 + GAMUT_EPS

  return {
    r: clamp255(linearToSrgb(lr)),
    g: clamp255(linearToSrgb(lg)),
    b: clamp255(linearToSrgb(lb)),
    inGamut,
  }
}

export function rgbToCss({ r, g, b }: Rgb255): string {
  return `rgb(${r}, ${g}, ${b})`
}
