/** One npm package, four independent Host entrypoints: preserve Cordis boundaries. */
import { defineConfig } from 'tsdown'
const capabilities = ['context', 'speaker', 'capture', 'ui']
// The Git checkout ships prebuilt Host code and must load without local node_modules.
const bundledRuntime = new Set(['@deepseek-ai/schemastery', '@deepseek-ai/cosmokit'])
export default defineConfig(capabilities.map(name => ({
  name: 'meeting/' + name,
  entry: { index: 'src/' + name + '/index.ts' },
  outDir: name === 'ui' ? 'lib' : 'lib/' + name,
  format: 'esm',
  platform: 'node',
  dts: true,
  fixedExtension: false,
  clean: false,
  deps: {
    alwaysBundle: [...bundledRuntime],
    neverBundle: (specifier) =>
      (specifier.startsWith('@deepseek-ai/') && !bundledRuntime.has(specifier)) ||
      specifier.startsWith('@ri0n72y/dsh-meeting/') ||
      specifier === 'react' || specifier.startsWith('react/') ||
      specifier === 'sherpa-onnx-node',
  },
})))
