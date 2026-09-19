import {
  CURVE_PARAMS,
  RECIPE_PARAMS,
  REF_CURVE,
  REF_RECIPE,
  type Curve,
  type Recipe,
} from '../sim/balance'
import type { Lab } from '../sim/deltae'
import { fireGlaze } from '../sim/glaze'
import { draftModifiers } from '../sim/modifiers'
import {
  ECONOMY,
  accept,
  decline,
  fireCost,
  fireKiln,
  newRun,
  outstanding,
  summarize,
  type PieceResult,
  type RunState,
} from '../sim/run'
import { searchFiring } from '../sim/search'
import { TARGETS } from '../sim/targets'
import { drawGlazedVessel, swatchStyle } from './bowl'
import { mountSliders, syncAll, type Slider } from './sliders'
import { chime, crack, knock, setFire, thud } from './sound'

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls !== undefined) node.className = cls
  return node
}

function txt<T extends HTMLElement>(node: T, s: string): T {
  node.textContent = s
  return node
}

/** (a) 层手感：不起弹簧，只用一条"起得快、落得稳"的三次曲线 */
function easeSettle(t: number): number {
  return 1 - (1 - t) ** 3
}

/** 未熔的生釉：发白、没饱和度。窑里"慢慢变色"就是从它走向烧成的 Lab */
function rawGlaze(lab: Lab): Lab {
  return { l: Math.min(98, lab.l + 10), a: lab.a * 0.2, b: lab.b * 0.2 }
}

function mixLab(from: Lab, to: Lab, t: number): Lab {
  return {
    l: from.l + (to.l - from.l) * t,
    a: from.a + (to.a - from.a) * t,
    b: from.b + (to.b - from.b) * t,
  }
}

/** 窑位温偏只给粗判不给数值——位置知识要玩家自己记 */
function heatHint(offset: number): string {
  if (offset > 12) return '偏热'
  if (offset > 3) return '微热'
  if (offset < -20) return '很冷'
  if (offset < -6) return '偏冷'
  return '中位'
}

const solutionCache = new Map<number, { recipe: Recipe; curve: Curve }>()

function solutionFor(targetIndex: number): { recipe: Recipe; curve: Curve } {
  const hit = solutionCache.get(targetIndex)
  if (hit !== undefined) return hit
  const s = searchFiring(TARGETS[targetIndex].lab, 60, 20260919)
  const sol = { recipe: s.recipe, curve: s.curve }
  solutionCache.set(targetIndex, sol)
  return sol
}

const JARS: Array<{ key: keyof Recipe; name: string; note: string; step: number; swatch: string }> = [
  {
    key: 'fe',
    name: '铁',
    note: '还原则青，氧化则黄褐',
    step: 0.5,
    swatch: 'radial-gradient(120% 110% at 35% 25%, #b79a72, #7d5f3c 62%, #4c3823)',
  },
  {
    key: 'cu',
    name: '铜',
    note: '还原则红，氧化则绿',
    step: 0.25,
    swatch: 'radial-gradient(120% 110% at 35% 25%, #86b3a2, #3f7d68 62%, #24493c)',
  },
  {
    key: 'co',
    name: '钴',
    note: '一入即蓝，压得住全场',
    step: 0.1,
    swatch: 'radial-gradient(120% 110% at 35% 25%, #6b7fb5, #33457f 62%, #1c2748)',
  },
]

export interface GameEntry {
  seed: number
  modifier?: string
}

export function mountGame(host: HTMLElement, entry: GameEntry): void {
  let seed = entry.seed
  let modifierId = entry.modifier ?? draftModifiers(seed)[0].id
  let run: RunState = newRun(seed, modifierId)
  let phase: 'ready' | 'firing' | 'result' = 'ready'
  let lastFired: PieceResult[] = []

  const recipe: Recipe = { ...REF_RECIPE }
  const curve: Curve = { ...REF_CURVE }
  /** 固定长度的窑位托盘：null 表示该位空着。用稀疏数组会被 findIndex/filter 跳过洞 */
  const tray: Array<number | null> = Array.from({ length: ECONOMY.capacity }, () => null)

  const loaded = (): number[] => tray.filter((x): x is number => x !== null)
  const freeSlot = (): number => {
    for (let i = 0; i < tray.length; i++) if (tray[i] === null) return i
    return -1
  }
  const clearTray = (): void => {
    for (let i = 0; i < tray.length; i++) tray[i] = null
  }

  /* ── 骨架 ─────────────────────────────── */
  const top = h('div', 'g-top')
  const bench = h('aside', 'g-bench')
  const kiln = h('section', 'g-kiln')
  const arch = h('div', 'g-arch')
  const chamber = h('div', 'g-chamber')
  const slotsBox = h('div', 'g-slots')
  const fireBar = h('footer', 'g-fire')
  const mouth = h('div', 'g-mouth')
  const costLine = h('div', 'g-cost')
  const ordersBox = h('aside', 'g-orders')

  const ignite = h('button', 'g-ignite')
  ignite.type = 'button'
  ignite.addEventListener('click', () => {
    if (phase === 'result') {
      phase = 'ready'
      lastFired = []
      render()
      return
    }
    if (phase === 'ready') void fireSequence()
  })

  const link = h('input', 'g-link')
  link.readOnly = true
  link.title = '点一下全选，复制这串就能重开同一局'
  link.addEventListener('click', () => link.select())

  const modBtn = h('button')
  modBtn.type = 'button'
  modBtn.addEventListener('click', () => {
    const pool = draftModifiers(seed)
    const at = pool.findIndex((m) => m.id === modifierId)
    modifierId = pool[(at + 1) % pool.length].id
    restart(newRun(seed, modifierId))
  })

  const swapBtn = h('button')
  swapBtn.type = 'button'
  swapBtn.textContent = '换一局'
  swapBtn.addEventListener('click', () => {
    seed += 1
    modifierId = draftModifiers(seed)[0].id
    restart(newRun(seed, modifierId))
  })

  function restart(next: RunState): void {
    run = next
    clearTray()
    lastFired = []
    phase = 'ready'
    setFire(0)
    render()
  }

  const door = h('div', 'g-door')
  arch.append(chamber, slotsBox, door)
  kiln.append(arch)
  fireBar.append(mouth, ignite, costLine)

  const shell = h('div', 'g-shell')
  shell.append(top, bench, kiln, fireBar, ordersBox)
  host.replaceChildren(shell)

  /* ── 左：釉料案 ───────────────────────── */
  bench.append(txt(h('h2', 'g-h'), '釉料案'))
  const jarVals: Record<string, HTMLElement> = {}
  for (const jar of JARS) {
    const spec = RECIPE_PARAMS.find((p) => p.key === jar.key)
    const row = h('div', 'g-jar')
    const ico = h('div', 'vessel-ico')
    ico.style.background = jar.swatch
    ico.title = '上下拖动倒料，或用 ± 微调'

    /** 拖动倒料：不是跟手物理，只是把竖直位移线性映射到量程，
     *  让"倒多少"这件事有连续的手感，而不是每次 0.5 地按 */
    let dragFrom: { y: number; v: number } | null = null
    const lo = spec?.min ?? 0
    const hi = spec?.max ?? 8
    ico.addEventListener('pointerdown', (ev) => {
      dragFrom = { y: ev.clientY, v: recipe[jar.key] }
      ico.setPointerCapture(ev.pointerId)
      ev.preventDefault()
    })
    ico.addEventListener('pointermove', (ev) => {
      if (dragFrom === null) return
      const next = dragFrom.v + ((dragFrom.y - ev.clientY) / 150) * (hi - lo)
      recipe[jar.key] = Math.min(hi, Math.max(lo, Math.round(next * 100) / 100))
      render()
    })
    const endDrag = (): void => {
      dragFrom = null
    }
    ico.addEventListener('pointerup', endDrag)
    ico.addEventListener('pointercancel', endDrag)
    const meta = h('div', 'txt')
    meta.append(txt(h('span'), `${jar.name} ${jar.note}`))
    const val = txt(h('b'), '0')
    meta.append(val)
    jarVals[jar.key] = val

    const step = h('div', 'g-step')
    const bump = (dir: number) => {
      const lo = spec?.min ?? 0
      const hi = spec?.max ?? 8
      const next = recipe[jar.key] + dir * jar.step
      recipe[jar.key] = Math.min(hi, Math.max(lo, Math.round(next * 100) / 100))
      render()
    }
    const up = h('button')
    up.type = 'button'
    up.textContent = '+'
    up.addEventListener('click', () => bump(1))
    const down = h('button')
    down.type = 'button'
    down.textContent = '−'
    down.addEventListener('click', () => bump(-1))
    step.append(up, down)

    row.append(ico, meta, step)
    bench.append(row)
  }

  const tmaxSpec = CURVE_PARAMS.find((p) => p.key === 'tmax')
  const T_LO = tmaxSpec?.min ?? 1150
  const T_HI = tmaxSpec?.max ?? 1330

  const ruler = h('div', 'g-ruler')
  const bar = h('div', 'bar')
  const marker = h('i')
  bar.append(marker)
  bar.addEventListener('click', (ev) => {
    const rect = bar.getBoundingClientRect()
    const ratio = 1 - (ev.clientY - rect.top) / rect.height
    curve.tmax = Math.round(T_LO + Math.min(1, Math.max(0, ratio)) * (T_HI - T_LO))
    render()
  })
  const rulerCap = h('div', 'cap')
  const rulerTemp = txt(h('b'), `${curve.tmax}℃`)
  const rulerNote = txt(h('span'), '')
  rulerCap.append(txt(h('span'), '最高温'), rulerTemp, rulerNote)
  ruler.append(bar, rulerCap)
  bench.append(ruler)

  const fine = h('details', 'g-fine')
  fine.append(txt(h('summary'), '看细账：保温、还原、冷却'))
  const fineSliders: Slider[] = mountSliders(
    fine,
    CURVE_PARAMS.filter((p) => p.key !== 'tmax'),
    (k) => curve[k as keyof Curve],
    (k, v) => {
      curve[k as keyof Curve] = v
    },
    'gm',
    render,
  )
  bench.append(fine)

  /* ── 中：窑位 ─────────────────────────── */
  interface SlotNode {
    btn: HTMLButtonElement
    canvas: HTMLCanvasElement
    hint: HTMLElement
    grade: HTMLElement
  }
  const slotNodes: SlotNode[] = []
  for (let i = 0; i < ECONOMY.capacity; i++) {
    const btn = h('button', 'g-slot')
    btn.type = 'button'
    const canvas = h('canvas')
    canvas.width = 168
    canvas.height = 156
    const node: SlotNode = {
      btn,
      canvas,
      hint: txt(h('span', 'hint'), ''),
      grade: txt(h('span', 'grade'), ''),
    }
    btn.append(txt(h('span', 'pos'), `位 ${i + 1}`), node.canvas, node.hint, node.grade)
    btn.addEventListener('click', () => toggleSlot(i))
    slotsBox.append(btn)
    slotNodes.push(node)
  }

  /** 还有余量的在手订单 */
  function orderWithRoom(): number | null {
    for (const o of run.accepted) {
      const inTray = tray.filter((id) => id === o.id).length
      if (outstanding(run, o.id) - inTray > 0) return o.id
    }
    return null
  }

  function toggleSlot(index: number): void {
    if (phase !== 'ready') return
    if (tray[index] !== null) {
      tray[index] = null
      render()
      return
    }
    const pick = orderWithRoom()
    if (pick === null) return
    tray[index] = pick
    thud()
    render()
  }

  /* ── 右：订单册页 ─────────────────────── */
  function smallAct(label: string, onPick: () => void): HTMLButtonElement {
    const b = h('button')
    b.type = 'button'
    b.textContent = label
    b.addEventListener('click', onPick)
    return b
  }

  function leaf(
    targetIndex: number,
    title: string,
    lines: Array<[string, boolean]>,
    acts: HTMLElement[],
    next: boolean,
  ): HTMLElement {
    const leafEl = h('div', next ? 'g-leaf next' : 'g-leaf')
    const glaze = h('div', 'glaze')
    glaze.style.background = swatchStyle(TARGETS[targetIndex].lab)
    const box = h('div', 'txt')
    box.append(txt(h('b'), title))
    for (const [s, due] of lines) box.append(txt(h('span', due ? 'due' : ''), s))
    if (acts.length > 0) {
      const row = h('div', 'acts')
      row.append(...acts)
      box.append(row)
    }
    leafEl.append(glaze, box)
    return leafEl
  }

  function renderOrders(): void {
    ordersBox.replaceChildren(txt(h('h2', 'g-h'), '订单册'))
    for (const o of run.offers) {
      ordersBox.append(
        leaf(
          o.targetIndex,
          `${TARGETS[o.targetIndex].name} × ${o.qty}`,
          [[`${o.pricePerPiece} 贯 / 件`, false], ['新帖 · 接不接？', false]],
          [
            smallAct('接单', () => {
              run = accept(run, o.id)
              render()
            }),
            smallAct('不接', () => {
              run = decline(run, o.id)
              render()
            }),
          ],
          false,
        ),
      )
    }
    const open = run.accepted.filter((o) => outstanding(run, o.id) > 0)
    open.forEach((o, i) => {
      ordersBox.append(
        leaf(
          o.targetIndex,
          `${TARGETS[o.targetIndex].name} 欠 ${outstanding(run, o.id)} / ${o.qty}`,
          [[`${o.pricePerPiece} 贯 / 件`, false], [`还剩 ${o.deadlineKiln - run.kiln} 窑`, true]],
          [
            smallAct('装进窑', () => {
              const at = freeSlot()
              const inTray = tray.filter((id) => id === o.id).length
              if (phase !== 'ready' || at < 0 || outstanding(run, o.id) - inTray <= 0) return
              tray[at] = o.id
              thud()
              render()
            }),
            smallAct('照这单调方', () => {
              const sol = solutionFor(o.targetIndex)
              for (const k of Object.keys(sol.recipe) as Array<keyof Recipe>) recipe[k] = sol.recipe[k]
              for (const k of Object.keys(sol.curve) as Array<keyof Curve>) curve[k] = sol.curve[k]
              render()
            }),
          ],
          i === 0,
        ),
      )
    })
    if (run.offers.length === 0 && open.length === 0) {
      ordersBox.append(txt(h('p', 'g-empty'), '这一窑没有帖可看'))
    }
  }

  /* ── 烧成序列 ─────────────────────────── */
  function fireSequence(): void {
    phase = 'firing'
    ignite.disabled = true
    arch.classList.add('sealed')
    const next = fireKiln(run, {
      recipe: { ...recipe },
      curve: { ...curve },
      orderIds: loaded(),
    })
    lastFired = next.history[next.history.length - 1] ?? []

    const DUR = 1500
    const started = performance.now()
    setFire(0.05)

    /**
     * 整段烧成用定时器驱动，不用 requestAnimationFrame：
     * 浏览器会暂停后台标签页的 rAF，玩家中途切走这窑就永远烧不完、也画不完。
     * 60ms 一跳对 1.5 秒的升温足够。
     */
    /** 每个窑位这一窑真正烧出的 Lab，用来画"生釉熔开"的过程 */
    const plan = new Map<number, Lab>()
    for (const p of lastFired) plan.set(p.position, p.lab)

    const paintAt = (t: number): void => {
      const heat = easeSettle(t).toFixed(3)
      chamber.style.setProperty('--heat', heat)
      mouth.style.setProperty('--heat', heat)
      setFire(Number(heat))
      slotNodes.forEach((node, i) => {
        const final = plan.get(i)
        if (final === undefined) return
        /** 各窑位起焰有先后，偏热的位先熔 */
        const local = Math.min(1, Math.max(0, (t - 0.18 - i * 0.05) / 0.55))
        drawGlazedVessel(node.canvas, {
          lab: mixLab(rawGlaze(final), final, easeSettle(local)),
          crackIndex: 0,
        })
      })
    }
    paintAt(0)

    const timer = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / DUR)
      paintAt(t)
      if (t < 1) return
      window.clearInterval(timer)
      run = next
      clearTray()
      phase = 'result'
      revealSequentially()
    }, 60)
  }

  function revealSequentially(): void {
    setFire(0)
    arch.classList.remove('sealed')
    const ordered = [...lastFired].sort((a, b) => a.position - b.position)
    ordered.forEach((p, i) => {
      window.setTimeout(() => {
        const node = slotNodes[p.position]
        if (node === undefined) return
        node.btn.classList.add('taken')
        /** 先抬出窑床，站住了才亮评级 */
        window.setTimeout(() => {
          node.btn.classList.add('shown')
          node.btn.dataset.grade = p.grade
          node.grade.textContent = p.grade
          if (p.grade === '珍品') chime()
          else if (p.grade === '废品') crack()
          else knock()
        }, 240)
        if (i === ordered.length - 1) window.setTimeout(finishReveal, 620)
      }, i * 320)
    })
    if (ordered.length === 0) finishReveal()
  }

  function finishReveal(): void {
    ignite.disabled = false
    render()
  }

  /* ── 渲染 ─────────────────────────────── */
  function renderTop(): void {
    const sum = summarize(run)
    top.replaceChildren(
      txt(h('span'), '窑'),
      txt(h('b'), `${Math.min(run.kiln, ECONOMY.maxKilns)} / ${ECONOMY.maxKilns}`),
      txt(h('span'), '现金'),
      txt(h('b'), `${run.cash} 贯`),
      txt(h('span'), '累计'),
      txt(h('b'), `${sum.score} 分`),
      txt(h('span'), '交付'),
      txt(h('b'), `${sum.delivered} 件`),
      txt(
        h('span', 'grow'),
        `今日 ${run.weather.name} · 降温 ${run.weather.coolingMult}× · 开局 ${run.modifier.name}`,
      ),
      modBtn,
      swapBtn,
      link,
    )
    modBtn.textContent = `开局：${run.modifier.name} ▾`
    link.value = `?seed=${seed}&m=${modifierId}`
  }

  function renderBench(): void {
    for (const jar of JARS) txt(jarVals[jar.key] as HTMLElement, `${recipe[jar.key].toFixed(2)}%`)
    marker.style.bottom = `${(((curve.tmax - T_LO) / (T_HI - T_LO)) * 100).toFixed(1)}%`
    rulerTemp.textContent = `${curve.tmax}℃`
    rulerNote.textContent = `${curve.reduction > 0.5 ? '还原焰' : '氧化焰'} · 保温 ${curve.soak} 分`
    syncAll(fineSliders)
  }

  function renderSlots(): void {
    if (phase === 'ready') arch.classList.remove('sealed')
    const firstEmpty = freeSlot()
    const canPick = phase === 'ready' && orderWithRoom() !== null
    slotNodes.forEach((node, i) => {
      node.hint.textContent = heatHint(run.kilnOffsets[i] ?? 0)
      const fired = phase === 'result' ? lastFired.find((p) => p.position === i) : undefined
      node.btn.classList.toggle('filled', tray[i] !== null || fired !== undefined)
      node.btn.classList.toggle('pick', canPick && i === firstEmpty)

      if (fired !== undefined) {
        drawGlazedVessel(node.canvas, { lab: fired.lab, crackIndex: fired.crackIndex })
        node.btn.dataset.grade = fired.grade
        node.grade.textContent = fired.grade
        return
      }
      node.btn.classList.remove('taken', 'shown')
      delete node.btn.dataset.grade
      node.grade.textContent = ''
      if (tray[i] !== null) {
        drawGlazedVessel(node.canvas, fireGlaze(recipe, curve, 0))
      } else {
        const ctx = node.canvas.getContext('2d')
        if (ctx !== null) ctx.clearRect(0, 0, node.canvas.width, node.canvas.height)
      }
    })
  }

  function renderFire(): void {
    const pieces = loaded().length
    const cost = fireCost(recipe, curve, pieces)
    const canAfford = run.cash >= cost
    costLine.replaceChildren(
      txt(h('span'), '本窑耗 '),
      txt(h('b', canAfford ? '' : 'bad'), `${cost} 贯`),
      txt(h('span'), ` · 已装 ${pieces} / ${ECONOMY.capacity} 件`),
      canAfford ? txt(h('span'), '') : txt(h('span', 'bad'), ' · 烧完就断火'),
    )
    ignite.textContent =
      phase === 'result' ? '开下一窑' : phase === 'firing' ? '窑火正中' : '点 火'
    ignite.disabled = phase === 'firing'
    if (phase !== 'firing') {
      chamber.style.setProperty('--heat', '0')
      mouth.style.setProperty('--heat', '0')
    }
  }

  function render(): void {
    renderTop()
    renderBench()
    renderSlots()
    renderOrders()
    renderFire()
  }

  render()
}
