declare module 'color-diff' {
  export interface LabColor {
    L: number
    a: number
    b: number
  }
  export function ciede2000(color1: LabColor, color2: LabColor): number
  export function diff(color1: LabColor, color2: LabColor): number
}
