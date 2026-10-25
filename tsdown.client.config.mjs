/** DSH >=0.2.1-rc.3 loads Client plugins as classic-script lazy-CJS factories.
 * Keep React and DSH UI primitives on the shared browser module table. */
import { defineConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'

const packageId = '@ri0n72y/dsh-meeting'
const packageRoot = dirname(fileURLToPath(import.meta.url))
const virtualPrefix = '\0meeting-css-module:'
const virtualSuffix = '.mjs'
const shared = new Set([
  'react', 'react/jsx-runtime', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

export default defineConfig({
  entry: { index: 'src/ui/client/index.tsx' },
  outDir: 'lib/client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false, // Keep independent Host and Client entries.
  deps: {
    neverBundle: name => shared.has(name),
    alwaysBundle: name => !shared.has(name),
  },
  plugins: [{
    name: 'meeting-css-modules-inline',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.module.css')) return null
      const file = resolve(dirname(importer), source)
      const stablePath = relative(packageRoot, file).split(sep).join('/')
      return virtualPrefix + stablePath + virtualSuffix
    },
    async load(id) {
      if (!id.startsWith(virtualPrefix)) return null
      const stablePath = id.slice(virtualPrefix.length, -virtualSuffix.length)
      const file = resolve(packageRoot, stablePath)
      this.addWatchFile(file)
      const { code, exports: classes } = transform({
        filename: stablePath,
        code: await readFile(file),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap = Object.fromEntries(
        Object.entries(classes ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([name, exp]) => [name, exp.name]),
      )
      const tagId = packageId + '/' + basename(file)
      return [
        'const css = ' + JSON.stringify(code.toString()) + ';',
        'const tagId = ' + JSON.stringify(tagId) + ';',
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
        '  const tag = document.createElement("style");',
        '  tag.dataset.plugin = ' + JSON.stringify(packageId) + ';',
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        'export default ' + JSON.stringify(classMap) + ';',
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'index.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(packageId) + ', factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
