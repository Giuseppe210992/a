// Compila l'interfaccia in dist/web/ (index.html + app.js + app.css).
// Tutto e' incorporato: nessuna risorsa esterna, funziona senza Internet.
import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const radice = path.dirname(fileURLToPath(import.meta.url));
const uscita = path.join(radice, 'dist', 'web');
const osserva = process.argv.includes('--watch');
const leggibile = process.argv.includes('--leggibile'); // senza minificazione: utile per leggere gli errori
const pkg = JSON.parse(await readFile(path.join(radice, 'package.json'), 'utf8'));

const opzioniComuni = {
  absWorkingDir: radice,
  bundle: true,
  logLevel: 'info',
  minify: !osserva && !leggibile,
  legalComments: 'none',
};

async function compila() {
  await rm(uscita, { recursive: true, force: true });
  await mkdir(uscita, { recursive: true });

  const js = {
    ...opzioniComuni,
    entryPoints: ['src/js/main.js'],
    outfile: 'dist/web/app.js',
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'edge110', 'firefox115', 'safari16'],
    // Il motore SQLite (WebAssembly) viene incorporato come dato binario.
    loader: { '.wasm': 'binary' },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    },
  };
  const css = {
    ...opzioniComuni,
    entryPoints: ['src/styles/main.css'],
    outfile: 'dist/web/app.css',
    loader: { '.svg': 'dataurl' },
  };

  if (osserva) {
    const [cj, cc] = await Promise.all([context(js), context(css)]);
    await Promise.all([cj.watch(), cc.watch()]);
  } else {
    await Promise.all([build(js), build(css)]);
  }

  const html = (await readFile(path.join(radice, 'src', 'index.html'), 'utf8'))
    .replaceAll('{{VERSIONE}}', pkg.version);
  await writeFile(path.join(uscita, 'index.html'), html);

  for (const f of ['index.html', 'app.js', 'app.css']) {
    const s = await stat(path.join(uscita, f));
    console.log(`  ${f.padEnd(11)} ${(s.size / 1024).toFixed(0).padStart(6)} KB`);
  }
}

await compila();
if (osserva) console.log('In osservazione dei file sorgente...');
