import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import { terser } from 'rollup-plugin-terser';

const version = process.env.VERSION || '0.0.0-dev';

export default {
  // Build a minified variant from the distributed file, do not overwrite main dist file
  input: 'dist/avinor-flight-card.js',
  output: {
    file: 'dist/avinor-flight-card.min.js',
    format: 'es',
    sourcemap: false,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        __VERSION__: JSON.stringify(version),
      },
    }),
    resolve(),
    commonjs(),
    terser(),
  ],
};
