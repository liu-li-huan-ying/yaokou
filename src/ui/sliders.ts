import { type ParamSpec } from '../sim/balance'

export interface Slider {
  input: HTMLInputElement
  out: HTMLOutputElement
  read: () => number
  format: (v: number) => string
  /** 把 read() 的最新值拉回控件：策略或"反推配方"改了状态后要用 */
  sync: () => void
}

function decimals(step: number): number {
  const text = String(step)
  return text.includes('.') ? text.split('.')[1].length : 0
}

export function formatValue(step: number, unit: string, v: number): string {
  return `${step >= 1 ? v.toFixed(0) : v.toFixed(decimals(step))}${unit}`
}

/**
 * 挂一根滑杆。idPrefix 必给：配釉台与游戏两屏都用同一批参数，
 * 不加前缀会出现重复的 DOM id。
 */
export function mountSlider<T>(
  host: HTMLElement,
  spec: ParamSpec<T>,
  read: () => number,
  write: (v: number) => void,
  idPrefix: string,
  onChange?: () => void,
): Slider {
  const row = document.createElement('div')
  row.className = 'slider'
  const id = `${idPrefix}-${spec.key}`

  const label = document.createElement('label')
  label.textContent = spec.label
  label.htmlFor = id

  const input = document.createElement('input')
  input.type = 'range'
  input.id = id
  input.min = String(spec.min)
  input.max = String(spec.max)
  input.step = String(spec.step)
  input.value = String(read())

  const out = document.createElement('output')
  const format = (v: number): string => formatValue(spec.step, spec.unit, v)
  out.textContent = format(read())

  input.addEventListener('input', () => {
    const v = Number(input.value)
    write(v)
    out.textContent = format(v)
    if (onChange !== undefined) onChange()
  })

  row.append(label, input, out)
  host.append(row)

  return {
    input,
    out,
    read,
    format,
    sync: () => {
      const v = read()
      if (Number(input.value) !== v) input.value = String(v)
      out.textContent = format(v)
    },
  }
}

export function mountSliders<T>(
  host: HTMLElement,
  specs: Array<ParamSpec<T>>,
  read: (key: keyof T & string) => number,
  write: (key: keyof T & string, v: number) => void,
  idPrefix: string,
  onChange?: () => void,
): Slider[] {
  return specs.map((spec) =>
    mountSlider(host, spec, () => read(spec.key), (v) => write(spec.key, v), idPrefix, onChange),
  )
}

export function syncAll(sliders: Slider[]): void {
  for (const s of sliders) s.sync()
}
