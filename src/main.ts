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
import { fireGlaze, gradeOf } from './sim/glaze'
import { labToRgb } from './sim/lab'
import { searchFiring } from './sim/search'
import { TARGETS } from './sim/targets'
import { drawGlazedVessel } from './ui/bowl'
import { mountGame } from './ui/game'
import { mountSliders, syncAll, type Slider } from './ui/sliders'

const state = {
  recipe: { ...REF_RECIPE } as Recipe,
  curve: { ...REF_CURVE } as Curve,
  offset: 0,
  targetIndex: 0,
}

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`页面骨架缺 #${id}`)
  return node as T
}

const recipeHost = need('recipe')
const curveHost = need('curve')
const offsetHost = need('offset')
const targetsHost = need('targets')
const solveBtn = need('solve')
const resetBtn = need('reset')
const readout = need('readout')
const patch = need('patch') as HTMLCanvasElement
const viewColorizer = need('view-colorizer')
const viewGame = need('view-game')
const tabColorizer = need('tab-colorizer')
const tabGame = need('tab-game')

function field(host: HTMLElement, key: string, value: string): void {
  const dt = document.createElement('dt')
  dt.textContent = key
  const dd = document.createElement('dd')
  dd.textContent = value
  host.append(dt, dd)
}

const offsetSpec: ParamSpec<{ offset: number }> = {
  key: 'offset',
  label: '窑位温偏',
  min: KILN_OFFSET[0],
  max: KILN_OFFSET[1],
  step: 1,
  unit: '℃',
}

const sliders: Slider[] = [
  ...mountSliders(
    recipeHost,
    RECIPE_PARAMS,
    (k) => state.recipe[k as keyof Recipe],
    (k, v) => {
      state.recipe[k as keyof Recipe] = v
    },
    'cz',
    renderColorizer,
  ),
  ...mountSliders(
    curveHost,
    CURVE_PARAMS,
    (k) => state.curve[k as keyof Curve],
    (k, v) => {
      state.curve[k as keyof Curve] = v
    },
    'cz',
    renderColorizer,
  ),
  ...mountSliders(
    offsetHost,
    [offsetSpec],
    () => state.offset,
    (_k, v) => {
      state.offset = v
    },
    'cz',
    renderColorizer,
  ),
]

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
    renderColorizer()
  })
  targetsHost.append(chip)
})

function renderColorizer(): void {
  const result = fireGlaze(state.recipe, state.curve, state.offset)
  const rgb = labToRgb(result.lab)
  const target = TARGETS[state.targetIndex]
  const deltaE = deltaE2000(result.lab, target.lab)

  drawGlazedVessel(patch, result)

  readout.replaceChildren()
  field(readout, '目标', `${target.name} · ${target.form} · ${target.source}`)
  field(
    readout,
    '呈色 Lab',
    `L* ${result.lab.l.toFixed(1)}  a* ${result.lab.a.toFixed(1)}  b* ${result.lab.b.toFixed(1)}`,
  )
  field(readout, 'sRGB', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`)
  field(readout, 'ΔE2000', deltaE.toFixed(2))
  field(readout, '评级', gradeOf(deltaE))
  field(readout, '玻化度', result.melt.toFixed(2))
  field(readout, '乳浊度', result.opacity.toFixed(2))
  field(readout, '开片', result.crackIndex.toFixed(2))
  field(readout, '流釉风险', result.runoffRisk.toFixed(2))
  field(readout, '变形风险', result.deformRisk.toFixed(2))
  field(readout, '实际还原度', result.redox.toFixed(2))

  document.querySelectorAll<HTMLElement>('#targets .chip').forEach((el, i) => {
    el.setAttribute('aria-pressed', String(i === state.targetIndex))
  })
  syncAll(sliders)
}

solveBtn.addEventListener('click', () => {
  const solution = searchFiring(TARGETS[state.targetIndex].lab)
  state.recipe = solution.recipe
  state.curve = solution.curve
  renderColorizer()
})

resetBtn.addEventListener('click', () => {
  state.recipe = { ...REF_RECIPE }
  state.curve = { ...REF_CURVE }
  state.offset = 0
  renderColorizer()
})

let gameMounted = false

/** 从地址栏取开局参数：?seed=…&m=…  同一串链接必然开出同一局 */
const params = new URLSearchParams(location.search)
const rawSeed = Number(params.get('seed'))
const entry = {
  seed: Number.isFinite(rawSeed) && rawSeed > 0 ? Math.floor(rawSeed) : 20260919,
  modifier: params.get('m') ?? undefined,
}

function showView(which: 'game' | 'colorizer'): void {
  if (which === 'game' && !gameMounted) {
    mountGame(viewGame, entry)
    gameMounted = true
  }
  viewGame.hidden = which !== 'game'
  viewColorizer.hidden = which !== 'colorizer'
  tabGame.setAttribute('aria-selected', String(which === 'game'))
  tabColorizer.setAttribute('aria-selected', String(which === 'colorizer'))
}

tabGame.addEventListener('click', () => showView('game'))
tabColorizer.addEventListener('click', () => showView('colorizer'))

renderColorizer()
showView(params.get('view') === 'colorizer' ? 'colorizer' : 'game')
