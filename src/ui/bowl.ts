import type { Lab } from '../sim/deltae'
import { labToRgb } from '../sim/lab'
import { mulberry32, randomIn } from '../sim/rng'

/** 画器只需要两样信息：烧出来的 Lab 与开片程度。不要求整份 GlazeResult，好让出窑记录也能直接画 */
export interface VesselAppearance {
  lab: Lab
  crackIndex: number
}

/**
 * 画一件施釉器：外壁贝塞尔 + 口沿椭圆 + 圈足 + 底影 + 开片。
 * 开片走 seeded 折线，同一外观必得同一纹路，所以它能当"这窑烧出来长这样"的凭据用。
 */
export function drawGlazedVessel(canvas: HTMLCanvasElement, result: VesselAppearance): void {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return

  const rgb = labToRgb(result.lab)
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#fffdf8'
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const rx = w * 0.31
  const rimY = h * 0.34
  const controlY = h * 0.78
  const rimRy = rx * 0.3
  /** 两端在口沿、两控制点同高的三次贝塞尔，最低点恒在 t=0.5：y = 0.25·rimY + 0.75·controlY。
   *  圈足与底影必须贴这条线，否则足会浮空。 */
  const bottomY = rimY * 0.25 + controlY * 0.75

  const css = (k: number, l: number, b: number): string =>
    `rgb(${Math.round(k * rgb.r)}, ${Math.round(l * rgb.g)}, ${Math.round(b * rgb.b)})`
  const light = css(1.18, 1.16, 1.14)
  const mid = css(1, 1, 1)
  const dark = css(0.68, 0.66, 0.7)

  const wall = new Path2D()
  wall.moveTo(cx - rx, rimY)
  wall.bezierCurveTo(cx - rx * 1.06, controlY, cx + rx * 1.06, controlY, cx + rx, rimY)
  wall.closePath()

  ctx.beginPath()
  ctx.ellipse(cx, bottomY + 6, rx * 0.5, rx * 0.11, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(41, 37, 31, 0.14)'
  ctx.fill()

  const wallGrad = ctx.createLinearGradient(cx, rimY, cx, bottomY)
  wallGrad.addColorStop(0, mid)
  wallGrad.addColorStop(0.62, mid)
  wallGrad.addColorStop(1, dark)
  ctx.fillStyle = wallGrad
  ctx.fill(wall)

  const well = new Path2D()
  well.ellipse(cx, rimY, rx, rimRy, 0, 0, Math.PI * 2)
  const wellGrad = ctx.createRadialGradient(
    cx - rx * 0.34,
    rimY - rimRy * 0.5,
    rx * 0.06,
    cx,
    rimY,
    rx * 1.1,
  )
  wellGrad.addColorStop(0, light)
  wellGrad.addColorStop(0.5, mid)
  wellGrad.addColorStop(1, dark)
  ctx.fillStyle = wellGrad
  ctx.fill(well)
  ctx.lineWidth = 1.4
  ctx.strokeStyle = 'rgba(41, 37, 31, 0.4)'
  ctx.stroke(well)

  ctx.beginPath()
  ctx.moveTo(cx - rx * 0.3, bottomY - 6)
  ctx.lineTo(cx - rx * 0.26, bottomY + 8)
  ctx.lineTo(cx + rx * 0.26, bottomY + 8)
  ctx.lineTo(cx + rx * 0.3, bottomY - 6)
  ctx.closePath()
  ctx.fillStyle = dark
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(41, 37, 31, 0.35)'
  ctx.stroke()

  // 壁与口要各裁一次：连着两次 clip 只留交集，裂纹就爬不出口沿
  if (result.crackIndex > 0.22) {
    const lines = Math.round(result.crackIndex * 40)
    const drawCracks = (clip: Path2D, seed: number, spanY: [number, number]): void => {
      const rnd = mulberry32(seed)
      ctx.save()
      ctx.clip(clip)
      ctx.strokeStyle = 'rgba(58, 48, 40, 0.4)'
      ctx.lineWidth = 0.8
      for (let i = 0; i < lines; i++) {
        let x = cx + randomIn(rnd, -rx, rx) * 0.92
        let y = randomIn(rnd, spanY[0], spanY[1])
        let angle = randomIn(rnd, 0, Math.PI * 2)
        ctx.beginPath()
        ctx.moveTo(x, y)
        for (let s = 0; s < 5; s++) {
          angle += randomIn(rnd, -0.7, 0.7)
          const len = randomIn(rnd, 9, 24)
          x += Math.cos(angle) * len
          y += Math.sin(angle) * len * 0.8
          ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      ctx.restore()
    }
    drawCracks(wall, 0x51a7e, [rimY, bottomY])
    drawCracks(well, 0x2f9c1, [rimY - rimRy, rimY + rimRy])
  }

  if (!rgb.inGamut) {
    ctx.fillStyle = 'rgba(140, 90, 60, 0.9)'
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillText('超出 sRGB 色域，显示为裁到边界的结果', 10, h - 10)
  }
}

export function swatchStyle(lab: { l: number; a: number; b: number }): string {
  const rgb = labToRgb(lab)
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
}
