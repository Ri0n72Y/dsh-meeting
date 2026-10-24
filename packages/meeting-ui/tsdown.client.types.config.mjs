/** Declaration build shares CSS resolution with the production lazy-CJS bundle.
 * It emits the public ./client d.ts, then the browser build replaces only index.js. */
import { defineConfig } from 'tsdown'
import clientConfig from './tsdown.client.config.mjs'

export default defineConfig({
  ...clientConfig,
  format: 'esm',
  dts: true,
  fixedExtension: false,
  outputOptions: { entryFileNames: 'index.js' },
})
