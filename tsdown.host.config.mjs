/** One npm package, four independent Host entrypoints: preserve Cordis boundaries. */
import { defineConfig } from 'tsdown'
const capabilities = ['context', 'speaker', 'capture', 'ui']
export default defineConfig(capabilities.map(name => ({
  name: 'meeting/' + name,
  entry: { index: 'src/' + name + '/index.ts' },
  outDir: 'dist/' + name,
  format: 'esm',
  platform: 'node',
  dts: true,
  fixedExtension: false,
  clean: false,
  deps: {
    neverBundle: (specifier) =>
      specifier.startsWith('@deepseek-ai/') ||
      specifier.startsWith('@ri0n72y/dsh-meeting/') ||
      specifier === 'react' || specifier.startsWith('react/') ||
      specifier === 'sherpa-onnx-node',
  },
})))
