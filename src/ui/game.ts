import {
  CURVE_PARAMS,
  RECIPE_PARAMS,
  REF_CURVE,
  REF_RECIPE,
  type Curve,
  type Recipe,
} from '../sim/balance'
import { fireGlaze } from '../sim/glaze'
import { draftModifiers, type Modifier } from '../sim/modifiers'
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

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls !== undefined) node.className = cls
  return node
}

function head3(text: string): HTMLElement {
  const el = h('h3')
  el.textContent = text
  return el
}

function para(text: string, cls = 'empty'): HTMLElement {
  const el = h('p', cls)
  el.textContent = text
  return el
}

function dot(targetIndex: number, size = 20): HTMLElement {
  const s = h('span', 'swatch')
  s.style.background = swatchStyle(TARGETS[targetIndex].lab)
  s.style.width = `${size}px`
  s.style.height = `${size}px`
  s.style.flex = '0 0 auto'
  return s
}

function button(label: string, onPick: () => void, cls = 'chip'): HTMLButtonElement {
  const b = h('button', cls)
  b.type = 'button'
  b.textContent = label
  b.addEventListener('click', onPick)
  return b
}

function card(
  targetIndex: number,
  title: string,
  meta: string,
  actions: Node[],
  extra?: string,
): HTMLElement {
  const box = h('div', 'card')
  const head = h('div', 'card-head')
  const strong = h('b')
  strong.textContent = title
  const metaEl = h('span', 'meta')
  metaEl.textContent = meta
  head.append(dot(targetIndex), strong, metaEl)
  const row = h('div', 'card-actions')
  row.append(...actions)
  box.append(head, row)
  if (extra !== undefined) box.append(para(extra, 'hint'))
  return box
}

/** 搜索一个目标的解要几百毫秒，同一目标只解一次 */
const solutionCache = new Map<number, { recipe: Recipe; curve: Curve }>()

function solutionFor(targetIndex: number): { recipe: Recipe; curve: Curve } {
  const hit = solutionCache.get(targetIndex)
  if (hit !== undefined) return hit
  const s = searchFiring(TARGETS[targetIndex].lab, 60, 20260919)
  const sol = { recipe: s.recipe, curve: s.curve }
  solutionCache.set(targetIndex, sol)
  return sol
}

export interface GameEntry {
  seed: number
  /** 不给就先弹开局选单 */
  modifier?: string
}

export function mountGame(host: HTMLElement, entry: GameEntry): void {
  let seed = entry.seed
  let modifierId: string | undefined = entry.modifier
  let run: RunState | null = modifierId === undefined ? null : newRun(seed, modifierId)
  const draft: { recipe: Recipe; curve: Curve; orderIds: number[] } = {
    recipe: { ...REF_RECIPE },
    curve: { ...REF_CURVE },
    orderIds: [],
  }
  let lastFired: PieceResult[] = []

  const status = h('div', 'status')
  const picker = h('div', 'picker')
  const banner = h('div', 'banner')
  const offersBox = h('div', 'cards')
  const acceptedBox = h('div', 'cards')
  const trayBox = h('div', 'tray')
  const posBox = h('div', 'positions')
  const resultBox = h('div', 'results')
  const recipeBox = h('div')
  const curveBox = h('div')
  const preview = h('canvas', 'preview')
  preview.width = 170
  preview.height = 170

  const shareInput = h('input', 'share')
  shareInput.readOnly = true
  const shareRow = h('div', 'share-row')
  shareRow.append(h('span', 'k'), shareInput)
  shareRow.children[0].textContent = '本局链接'
  shareInput.addEventListener('click', () => shareInput.select())

  const sliders: Slider[] = [
    ...mountSliders(
      recipeBox,
      RECIPE_PARAMS,
      (k) => draft.recipe[k as keyof Recipe],
      (k, v) => {
        draft.recipe[k as keyof Recipe] = v
      },
      'gm',
      render,
    ),
    ...mountSliders(
      curveBox,
      CURVE_PARAMS,
      (k) => draft.curve[k as keyof Curve],
      (k, v) => {
        draft.curve[k as keyof Curve] = v
      },
      'gm',
      render,
    ),
  ]

  function shareUrl(): string {
    const m = modifierId === undefined ? '' : `&m=${modifierId}`
    return `${location.origin}${location.pathname}?seed=${seed}${m}`
  }

  function startWith(id: string): void {
    modifierId = id
    run = newRun(seed, id)
    lastFired = []
    draft.orderIds = []
    render()
  }

  const fireBtn = button(
    '点火烧窑',
    () => {
      if (run === null) return
      const next = fireKiln(run, {
        recipe: { ...draft.recipe },
        curve: { ...draft.curve },
        orderIds: [...draft.orderIds],
      })
      lastFired = next.history[next.history.length - 1] ?? []
      run = next
      draft.orderIds = []
      render()
    },
    'primary',
  )

  const clearBtn = button('清空本窑', () => {
    draft.orderIds = []
    render()
  })

  const resetBtn = button('回到参考配方', () => {
    draft.recipe = { ...REF_RECIPE }
    draft.curve = { ...REF_CURVE }
    render()
  })

  const againBtn = button('换一局', () => {
    seed += 1
    run = null
    modifierId = undefined
    lastFired = []
    draft.orderIds = []
    render()
  })

  function renderPicker(): void {
    picker.replaceChildren()
    if (run !== null) {
      picker.hidden = true
      return
    }
    picker.hidden = false
    picker.append(head3('开局：挑一张窑神巡游'))
    const cards = h('div', 'cards')
    for (const m of draftModifiers(seed)) {
      cards.append(
        cardMod(
          m,
          button('就这个', () => startWith(m.id), 'primary'),
        ),
      )
    }
    picker.append(para(`seed ${seed}`, 'hint'), cards)
  }

  function cardMod(m: Modifier, action: HTMLButtonElement): HTMLElement {
    const box = h('div', 'card')
    const head = h('div', 'card-head')
    const strong = h('b')
    strong.textContent = m.name
    const meta = h('span', 'meta')
    meta.textContent = `温偏 ${m.offsetSpan[0]}…${m.offsetSpan[1]}℃ · 出价 ×${m.priceMult}`
    head.append(strong, meta)
    const row = h('div', 'card-actions')
    row.append(action)
    box.append(head, para(m.blurb, 'hint'), row)
    return box
  }

  function renderStatus(): void {
    status.replaceChildren()
    if (run === null) return
    const sum = summarize(run)
    const cost = fireCost(draft.recipe, draft.curve, draft.orderIds.length)
    const cells: Array<[string, string]> = [
      ['窑', `${Math.min(run.kiln, ECONOMY.maxKilns)} / ${ECONOMY.maxKilns}`],
      ['天气', `${run.weather.name}（降温 ×${run.weather.coolingMult}）`],
      ['开局', run.modifier.name],
      ['现金', `${run.cash} 贯`],
      ['累计分', `${sum.score}`],
      ['本窑成本', `${cost} 贯`],
      ['装窑', `${draft.orderIds.length} / ${ECONOMY.capacity}`],
      ['seed', `${run.seed}`],
    ]
    for (const [k, v] of cells) {
      const cell = h('div', 'stat')
      const key = h('span', 'k')
      key.textContent = k
      const val = h('b')
      val.textContent = v
      cell.append(key, val)
      status.append(cell)
    }
    if (run.cash < cost) status.append(para('现金不够这一窑，烧完就断火', 'warn'))
  }

  function renderOffers(): void {
    offersBox.replaceChildren()
    if (run === null) return
    if (run.offers.length === 0) {
      offersBox.append(para('暂无挂单'))
      return
    }
    for (const o of run.offers) {
      offersBox.append(
        card(
          o.targetIndex,
          `${TARGETS[o.targetIndex].name} × ${o.qty}`,
          `${o.pricePerPiece} 贯/件 · 还剩 ${o.deadlineKiln - run.kiln} 窑`,
          [
            button('接单', () => {
              run = accept(run as RunState, o.id)
              render()
            }),
            button('拒掉', () => {
              run = decline(run as RunState, o.id)
              render()
            }),
          ],
        ),
      )
    }
  }

  function renderAccepted(): void {
    acceptedBox.replaceChildren()
    if (run === null) return
    const open = run.accepted.filter((o) => outstanding(run as RunState, o.id) > 0)
    if (open.length === 0) {
      acceptedBox.append(para('手上没有欠着的单'))
      return
    }
    for (const o of open) {
      /** 窑里已占的件数要一起算，否则"装一件"能点到超过订单数量，
       *  多出来的会被 sim 丢掉而玩家看不到提示 */
      const inTray = draft.orderIds.filter((id) => id === o.id).length
      const room = outstanding(run, o.id) - inTray
      acceptedBox.append(
        card(
          o.targetIndex,
          `${TARGETS[o.targetIndex].name} 欠 ${outstanding(run, o.id)} / ${o.qty} 件` +
            (inTray > 0 ? `（本窑已装 ${inTray}）` : ''),
          `${o.pricePerPiece} 贯/件 · 到期还剩 ${o.deadlineKiln - run.kiln} 窑`,
          [
            button(
              room > 0 ? `装一件（余 ${room}）` : '本窑已装满',
              () => {
                if (room <= 0 || draft.orderIds.length >= ECONOMY.capacity) return
                draft.orderIds.push(o.id)
                render()
              },
            ),
            button('照这单调方', () => {
              const sol = solutionFor(o.targetIndex)
              draft.recipe = { ...sol.recipe }
              draft.curve = { ...sol.curve }
              render()
            }),
          ],
        ),
      )
    }
  }

  function renderTray(): void {
    trayBox.replaceChildren()
    if (draft.orderIds.length === 0) {
      trayBox.append(
        para('本窑还没装坯。位置顺序＝点击顺序，同一窑里每个位置的温偏不一样。'),
      )
      return
    }
    draft.orderIds.forEach((orderId, position) => {
      if (run === null) return
      const order = run.accepted.find((o) => o.id === orderId)
      if (order === undefined) return
      const row = h('div', 'tray-row')
      const label = h('span', 'tray-label')
      label.textContent = `位 ${position + 1} · ${TARGETS[order.targetIndex].name}`
      row.append(
        dot(order.targetIndex, 16),
        label,
        button('撤掉', () => {
          draft.orderIds.splice(position, 1)
          render()
        }),
      )
      trayBox.append(row)
    })
  }

  /** 只给"这个位历史上烧出过什么评级"，不给温度数值——那是玩家要自己记的东西 */
  function renderPositions(): void {
    posBox.replaceChildren()
    if (run === null) return
    for (let position = 0; position < ECONOMY.capacity; position++) {
      const seen = run.history.flat().filter((p) => p.position === position)
      const tally = new Map<string, number>()
      for (const p of seen) tally.set(p.grade, (tally.get(p.grade) ?? 0) + 1)
      const cell = h('div', 'pos')
      const title = h('b')
      title.textContent = `位 ${position + 1}`
      const body = h('span')
      body.textContent =
        seen.length === 0
          ? '未试过'
          : [...tally.entries()].map(([grade, n]) => `${grade}×${n}`).join(' ')
      cell.append(title, body)
      posBox.append(cell)
    }
  }

  function renderResults(): void {
    resultBox.replaceChildren()
    if (lastFired.length === 0 || run === null) return
    resultBox.append(head3(`第 ${Math.max(1, run.kiln - 1)} 窑出窑 · ${run.weather.name}`))
    for (const p of lastFired) {
      const row = h('div', 'result-row')
      const cell = h('div', 'result-cell')
      const canvas = h('canvas')
      canvas.width = 96
      canvas.height = 96
      // 画的是这一件当时真正烧出来的 Lab，不是拿当前配方重算的
      drawGlazedVessel(canvas, { lab: p.lab, crackIndex: p.crackIndex })
      cell.append(canvas)

      const info = h('div', 'result-info')
      const title = h('b')
      title.textContent = `位 ${p.position + 1} · ${p.grade}`
      const detail = h('span')
      detail.textContent =
        `ΔE2000 ${p.deltaE.toFixed(2)} · 温偏 ${p.offset.toFixed(1)}℃ · 开片 ${p.crackIndex.toFixed(2)}` +
        `${p.crackBonus > 0 ? `（+${p.crackBonus} 分）` : ''} · ${p.revenue >= 0 ? '+' : ''}${
          p.revenue
        } 贯 · 目标 ${TARGETS[p.targetIndex].name}`
      info.append(title, detail)
      row.append(cell, info)
      resultBox.append(row)
    }
  }

  function renderBanner(): void {
    banner.replaceChildren()
    if (run === null || !run.over) return
    const sum = summarize(run)
    banner.append(
      para(
        `${run.reason}：第 ${sum.kilns} 窑收摊，累计分 ${sum.score}，交付 ${sum.delivered} 件` +
          `（珍品 ${sum.grades['珍品']}），违约 ${sum.breached} 件，余 ${run.cash} 贯。`,
        'over',
      ),
      againBtn,
    )
  }

  function render(): void {
    drawGlazedVessel(preview, fireGlaze(draft.recipe, draft.curve, 0))
    renderPicker()
    renderStatus()
    renderOffers()
    renderAccepted()
    renderTray()
    renderPositions()
    renderResults()
    renderBanner()
    syncAll(sliders)

    const playing = run !== null
    fireBtn.disabled = !playing || run?.over === true
    clearBtn.disabled = !playing || draft.orderIds.length === 0
    shareInput.value = playing ? shareUrl() : `?seed=${seed}`
    if (playing) history.replaceState(null, '', shareUrl().replace(location.origin, ''))
  }

  const left = h('div', 'game-col')
  left.append(
    head3('挂单'),
    offersBox,
    head3('在手订单'),
    acceptedBox,
    head3('本窑装单'),
    trayBox,
    head3('窑位履历'),
    posBox,
  )

  const controls = h('div', 'row')
  controls.append(fireBtn, clearBtn, resetBtn)

  const stage = h('div', 'game-col')
  stage.append(preview, controls, banner, resultBox, shareRow)

  const slidersBox = h('div', 'game-col')
  slidersBox.append(head3('釉料'), recipeBox, head3('烧成曲线'), curveBox)

  const grid = h('div', 'game-grid')
  grid.append(stage, left, slidersBox)

  host.replaceChildren(status, picker, grid)
  render()
}
