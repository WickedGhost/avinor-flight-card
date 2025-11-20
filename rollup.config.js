import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

export default {
  input: 'src/avinor-flight-card.js',
  output: {
    file: 'dist/avinor-flight-card.js',
    format: 'es',
    sourcemap: false,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        __VERSION__: JSON.stringify(pkg.version),
      },
    }),
    resolve(),
    commonjs(),
    terser({
      format: {
        comments: false,
      },
    }),
  ],
};
