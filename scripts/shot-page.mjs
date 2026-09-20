/**
 * 一次性截图脚手架：vite build 会清空 dist/，所以每次都要在 build 之后重新生成。
 * 它把 dist/index.html 的骨架照抄，只在 module 之前塞进存档、在 load 之后点开门。
 * 用法：node scripts/shot-page.mjs '<save json>'  →  dist/shot.html
 *      Edge headless 截 http://localhost:4319/shot.html#yard
 */
import { readFileSync, writeFileSync } from 'node:fs'

const save = process.argv[2] ?? '{}'
const idx = readFileSync('dist/index.html', 'utf8')
const boot = `<script>
      localStorage.setItem('yaokou.meta.v1', ${JSON.stringify(save)})
      history.replaceState(null, '', './?seed=777' + location.hash)
    </script>
    `
const clicker = `<script>
      addEventListener('load', () => {
        if (location.hash !== '#yard') return
        const b = document.querySelector('.g-yardbtn')
        if (b !== null) b.click()
      })
    </script>
  </body>`
const out = idx
  .replace('<script type="module"', boot + '<script type="module"')
  .replace('</body>', clicker)
writeFileSync('dist/shot.html', out)
console.log('dist/shot.html written')
