// 一次性取候选藏品清单。只走 Met 公开 API（CC0 开放数据），结果落盘供人工挑选。
// 用法：node scripts/fetch-candidates.mjs
//
// 按检索词各自取样，而不是把所有命中合成一个大集合再截断：
// 后者会按 objectID 顺序偏向某一批部门（实测 5060 个命中只截前 600 时，
// 东亚容器只剩 1 件），前者能保证每个瓷种都有代表。
const API = 'https://collectionapi.metmuseum.org/public/collection/v1'
const PER_QUERY = 150

const QUERIES = [
  'crackle', 'glazed ceramic', 'celadon', 'stoneware', 'porcelain', 'dishes',
]

const EXTRA = ''

/** 只认容器类器名，避免把书画卷册捞进来 */
const VESSEL = /\b(bowl|dish|plate|platter|vase|bottle|ewer|jar|cup|teabowl|meiping|brushwasher|censer|tray|dishware|basin)\b/i

async function json(url) {
  const r = await fetch(url)
  return r.ok ? r.json() : null
}

const seen = new Set()
const kept = []
const lines = []

for (const q of QUERIES) {
  const found = await json(`${API}/search?q=${encodeURIComponent(q)}&hasImages=true${EXTRA}`)
  const ids = (found?.objectIDs ?? []).slice(0, PER_QUERY)
  const objs = await Promise.all(ids.map((id) => json(`${API}/objects/${id}`)))
  let gained = 0
  for (const o of objs) {
    if (o === null || o.objectID === undefined || seen.has(o.objectID)) continue
    const img = o.primaryImageSmall || o.primaryImage
    if (!img || o.isPublicDomain !== true) continue
    const where = `${o.culture ?? ''} ${o.department ?? ''}`
    if (!/china|chinese|korea|japan/i.test(where)) continue
    if (!VESSEL.test(`${o.objectName ?? ''} ${o.title ?? ''}`)) continue
    seen.add(o.objectID)
    gained += 1
    kept.push({
      objectID: o.objectID,
      title: o.title,
      objectName: o.objectName,
      dynasty: o.objectDate ?? '',
      culture: o.culture ?? '',
      creditLine: o.creditLine ?? '',
      image: img,
    })
  }
  lines.push(`${q}: 取样 ${ids.length} → 收 ${gained}`)
}

const { writeFileSync } = await import('node:fs')
writeFileSync('scripts/candidates.json', JSON.stringify(kept, null, 1))
console.log(lines.join('\n'))
console.log(`合计可用容器 ${kept.length} 件`)
