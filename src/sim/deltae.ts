export interface Lab {
  l: number
  a: number
  b: number
}

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const TWENTY_FIVE_7 = 25 ** 7

function hueOf(aPrime: number, bPrime: number): number {
  if (aPrime === 0 && bPrime === 0) return 0
  const h = Math.atan2(bPrime, aPrime) * DEG
  return h >= 0 ? h : h + 360
}

function deltaHue(h1: number, h2: number): number {
  const d = h2 - h1
  if (d > 180) return d - 360
  if (d < -180) return d + 360
  return d
}

function meanHue(h1: number, h2: number): number {
  const sum = h1 + h2
  if (Math.abs(h1 - h2) <= 180) return sum / 2
  return sum < 360 ? (sum + 360) / 2 : (sum - 360) / 2
}

export function deltaE2000(x: Lab, y: Lab): number {
  const c1 = Math.hypot(x.a, x.b)
  const c2 = Math.hypot(y.a, y.b)
  const meanC = (c1 + c2) / 2
  const meanC7 = meanC ** 7
  const g = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + TWENTY_FIVE_7)))

  const a1p = (1 + g) * x.a
  const a2p = (1 + g) * y.a
  const c1p = Math.hypot(a1p, x.b)
  const c2p = Math.hypot(a2p, y.b)
  const h1p = hueOf(a1p, x.b)
  const h2p = hueOf(a2p, y.b)

  const dLp = y.l - x.l
  const dCp = c2p - c1p
  const dhp = c1p * c2p === 0 ? 0 : deltaHue(h1p, h2p)
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * RAD) / 2)

  const meanL = (x.l + y.l) / 2
  const meanCp = (c1p + c2p) / 2
  const meanHp = meanHue(h1p, h2p)
  const t =
    1 -
    0.17 * Math.cos((meanHp - 30) * RAD) +
    0.24 * Math.cos(2 * meanHp * RAD) +
    0.32 * Math.cos((3 * meanHp + 6) * RAD) -
    0.2 * Math.cos((4 * meanHp - 63) * RAD)

  const dTheta = 30 * Math.exp(-(((meanHp - 275) / 25) ** 2))
  const meanCp7 = meanCp ** 7
  const rc = 2 * Math.sqrt(meanCp7 / (meanCp7 + TWENTY_FIVE_7))
  const sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2)
  const sc = 1 + 0.045 * meanCp
  const sh = 1 + 0.015 * meanCp * t
  const rt = -Math.sin(2 * dTheta * RAD) * rc

  const termL = dLp / sl
  const termC = dCp / sc
  const termH = dHp / sh

  return Math.sqrt(
    Math.max(0, termL * termL + termC * termC + termH * termH + rt * termC * termH),
  )
}
