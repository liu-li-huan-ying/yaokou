import {
  CURVE_PARAMS,
  KILN_OFFSET,
  RECIPE_PARAMS,
  REF_CURVE,
  REF_RECIPE,
  type Curve,
  type ParamSpec,
  type Recipe,
} from './sim/balance'
import { deltaE2000 } from './sim/deltae'
import { fireGlaze, gradeOf, type GlazeResult } from './sim/glaze'
import { labToRgb, type LabToRgbResult } from './sim/lab'
import { mulberry32, randomIn } from './sim/rng'
import { searchFiring } from './sim/search'
import { TARGETS } from './sim/targets'

interface State {
  recipe: Recipe
  curve: Curve
  offset: number
  targetIndex: number
}

const state: State = {
  recipe: { ...REF_RECIPE },
  curve: { ...REF_CURVE },
  offset: 0,
  targetIndex: 0,
}

interface Control {
  input: HTMLInputElement
  out: HTMLOutputElement
  read: () => number
  format: (v: number) => string
}

const controls: Control[] = []

function mountSlider<T>(
  host: HTMLElement,
  spec: ParamSpec<T>,
  read: () => number,
  write: (v: number) => void,
): void {
  const row = document.createElement('div')
  row.className = 'slider'

  const label = document.createElement('label')
  label.textContent = spec.label
  label.htmlFor = `s-${spec.key}`

  const input = document.createElement('input')
  input.type = 'range'
  input.id = `s-${spec.key}`
  input.min = String(spec.min)
  input.max = String(spec.max)
  input.step = String(spec.step)
  input.value = String(read())

  const out = document.createElement('output')
  const format = (v: number): string =>
    `${spec.step >= 1 ? v.toFixed(0) : v.toFixed(String(spec.step).split('.')[1]?.length ?? 2)}${spec.unit}`
  out.textContent = format(read())

  input.addEventListener('input', () => {
    const v = Number(input.value)
    write(v)
    out.textContent = format(v)
    render()
  })

  row.append(label, input, out)
  host.append(row)
  controls.push({ input, out, read, format })
}

function mountTargets(host: HTMLElement): void {
  TARGETS.forEach((target, index) => {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    const rgb = labToRgb(target.lab)
    swatch.style.background = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
    const name = document.createElement('span')
    name.textContent = target.name
    chip.append(swatch, name)
    chip.addEventListener('click', () => {
      state.targetIndex = index
      render()
    })
    host.append(chip)
  })
}

function drawPatch(canvas: HTMLCanvasElement, result: GlazeResult, rgb: LabToRgbResult): void {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return

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
  /** 两端在口沿、两个控制点同高的三次贝塞尔，最低点恒在 t=0.5：
   *  y = 0.25·rimY + 0.75·controlY。圈足与底影都要贴这条线，否则足会浮空。 */
  const bottomY = rimY * 0.25 + controlY * 0.75

  const css = (k: number, l: number, b: number): string =>
    `rgb(${Math.round(k * rgb.r)}, ${Math.round(l * rgb.g)}, ${Math.round(b * rgb.b)})`
  const light = css(1.18, 1.16, 1.14)
  const mid = css(1, 1, 1)
  const dark = css(0.68, 0.66, 0.7)

  // 外壁：口沿两端到底的贝塞尔轮廓
  const wall = new Path2D()
  wall.moveTo(cx - rx, rimY)
  wall.bezierCurveTo(cx - rx * 1.06, controlY, cx + rx * 1.06, controlY, cx + rx, rimY)
  wall.closePath()

  // 底影
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

  // 内壁（口沿开口）
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

  // 圈足
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

  // 开片：条数由 crackIndex 决定，seeded 折线 ⇒ 同参数必得同纹路。
  // 壁与口分别裁一次——连着两次 clip 只会留下交集，裂纹就爬不出口沿。
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

function field(host: HTMLElement, key: string, value: string): void {
  const dt = document.createElement('dt')
  dt.textContent = key
  const dd = document.createElement('dd')
  dd.textContent = value
  host.append(dt, dd)
}

function render(): void {
  const result = fireGlaze(state.recipe, state.curve, state.offset)
  const rgb = labToRgb(result.lab)
  const target = TARGETS[state.targetIndex]
  const deltaE = deltaE2000(result.lab, target.lab)

  const patch = document.getElementById('patch') as HTMLCanvasElement | null
  if (patch !== null) drawPatch(patch, result, rgb)

  const readout = document.getElementById('readout')
  if (readout !== null) {
    readout.replaceChildren()
    field(readout, '目标', `${target.name} · ${target.form} · ${target.source}`)
    field(readout, '呈色 Lab', `L* ${result.lab.l.toFixed(1)}  a* ${result.lab.a.toFixed(1)}  b* ${result.lab.b.toFixed(1)}`)
    field(readout, 'sRGB', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`)
    field(readout, 'ΔE2000', deltaE.toFixed(2))
    field(readout, '评级', gradeOf(deltaE))
    field(readout, '玻化度', result.melt.toFixed(2))
    field(readout, '乳浊度', result.opacity.toFixed(2))
    field(readout, '开片', result.crackIndex.toFixed(2))
    field(readout, '流釉风险', result.runoffRisk.toFixed(2))
    field(readout, '变形风险', result.deformRisk.toFixed(2))
    field(readout, '实际还原度', result.redox.toFixed(2))
  }

  document.querySelectorAll<HTMLElement>('#targets .chip').forEach((chip, i) => {
    chip.setAttribute('aria-pressed', String(i === state.targetIndex))
  })

  for (const c of controls) {
    const v = c.read()
    if (Number(c.input.value) !== v) c.input.value = String(v)
    c.out.textContent = c.format(v)
  }
}

const recipeHost = document.getElementById('recipe')
const curveHost = document.getElementById('curve')
const offsetHost = document.getElementById('offset')
const targetsHost = document.getElementById('targets')
const solveBtn = document.getElementById('solve')
const resetBtn = document.getElementById('reset')

if (
  recipeHost === null ||
  curveHost === null ||
  offsetHost === null ||
  targetsHost === null ||
  solveBtn === null ||
  resetBtn === null
) {
  throw new Error('页面骨架缺节点')
}

for (const spec of RECIPE_PARAMS) {
  mountSlider(recipeHost, spec, () => state.recipe[spec.key], (v) => {
    state.recipe[spec.key] = v
  })
}
for (const spec of CURVE_PARAMS) {
  mountSlider(curveHost, spec, () => state.curve[spec.key], (v) => {
    state.curve[spec.key] = v
  })
}

const offsetSpec: ParamSpec<{ offset: number }> = {
  key: 'offset',
  label: '窑位温偏',
  min: KILN_OFFSET[0],
  max: KILN_OFFSET[1],
  step: 1,
  unit: '℃',
}
mountSlider(offsetHost, offsetSpec, () => state.offset, (v) => {
  state.offset = v
})

mountTargets(targetsHost)

solveBtn.addEventListener('click', () => {
  const solution = searchFiring(TARGETS[state.targetIndex].lab)
  state.recipe = solution.recipe
  state.curve = solution.curve
  render()
})

resetBtn.addEventListener('click', () => {
  state.recipe = { ...REF_RECIPE }
  state.curve = { ...REF_CURVE }
  state.offset = 0
  render()
})

render()
