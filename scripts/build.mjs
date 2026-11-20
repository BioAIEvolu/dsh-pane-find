import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const path = relative => fileURLToPath(new URL(relative, import.meta.url));
await build({ entryPoints: [path('../src/client.js')], outfile: path('../client.js'), bundle: true, format: 'iife', target: 'chrome110', legalComments: 'inline', charset: 'utf8' });
