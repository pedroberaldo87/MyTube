import { build, type InlineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { resolve } from 'path'
import { cpSync, mkdirSync, existsSync } from 'fs'

const root = import.meta.dirname

async function buildExtension() {
  const outDir = resolve(root, 'dist')

  // 1. Content scripts — single IIFE bundle (no imports, self-contained)
  console.log('\n📦 Building content scripts...')
  await build({
    configFile: false,
    root,
    plugins: [preact()],
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: resolve(root, 'src/content/main.ts'),
        name: 'MyTubeContent',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  } satisfies InlineConfig)

  // 2. Page bridge — MAIN world script (accesses YouTube's JS globals)
  console.log('\n📦 Building page bridge...')
  await build({
    configFile: false,
    root,
    plugins: [],
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: resolve(root, 'src/content/page-bridge.ts'),
        name: 'MyTubePageBridge',
        formats: ['iife'],
        fileName: () => 'page-bridge.js',
      },
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  } satisfies InlineConfig)

  // 3. Background service worker — ES module
  console.log('\n📦 Building service worker...')
  await build({
    configFile: false,
    root,
    plugins: [],
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: resolve(root, 'src/background/index.ts'),
        formats: ['es'],
        fileName: () => 'background.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  } satisfies InlineConfig)

  // 4. Dashboard SPA — extension options page
  console.log('\n📦 Building dashboard...')
  const dashboardRoot = resolve(root, 'src/dashboard')
  await build({
    configFile: false,
    root: dashboardRoot,
    base: './',
    plugins: [preact()],
    build: {
      outDir: resolve(outDir, 'dashboard'),
      emptyOutDir: true,
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  } satisfies InlineConfig)

  // 5. Host permission dialog — página de propósito único da janelinha popup
  console.log('\n📦 Building permission dialog...')
  await build({
    configFile: false,
    root: resolve(root, 'src/permission'),
    base: './',
    plugins: [],
    build: {
      outDir: resolve(outDir, 'permission'),
      emptyOutDir: true,
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  } satisfies InlineConfig)

  // 6. Copy static assets
  console.log('\n📋 Copying static assets...')
  const iconsOut = resolve(outDir, 'icons')
  if (!existsSync(iconsOut)) mkdirSync(iconsOut, { recursive: true })
  for (const size of [16, 48, 128]) {
    cpSync(
      resolve(root, `public/icons/icon-${size}.png`),
      resolve(iconsOut, `icon-${size}.png`)
    )
  }

  // 7. Write manifest.json
  const manifest = {
    manifest_version: 3,
    name: 'MyTube',
    description: 'Organize YouTube channels and playlists with folders and tags',
    version: '0.9.0',
    icons: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
    action: {
      default_icon: {
        '16': 'icons/icon-16.png',
        '48': 'icons/icon-48.png',
      },
    },
    options_page: 'dashboard/index.html',
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    content_scripts: [
      {
        js: ['page-bridge.js'],
        matches: ['https://www.youtube.com/*'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        js: ['content.js'],
        matches: ['https://www.youtube.com/*'],
        run_at: 'document_idle',
      },
    ],
    // Cada linha aqui é um item a mais no diálogo de instalação do Chrome, então
    // nenhuma entra "por precaução": `activeTab` estava declarada e sem uso nenhum
    // — o acesso ao YouTube já vem de `host_permissions`.
    permissions: [
      'storage',
      'unlimitedStorage',
      'tabs',
      'alarms',
    ],
    host_permissions: [
      'https://www.youtube.com/*',
      'https://youtube.com/*',
      'https://auth.openai.com/*',
      'https://chatgpt.com/backend-api/*',
    ],
    // Amplo de propósito: declarar amplo é o que permite PEDIR estreito. Nada é
    // concedido na instalação — cada host é pedido no clique, um a um. Sem o
    // 'http://*/*', qualquer endpoint http fora de localhost faz o Chrome lançar
    // "Only permissions specified in the manifest may be requested".
    optional_host_permissions: [
      'https://*/*',
      'http://*/*',
    ],
  }

  const { writeFileSync } = await import('fs')
  writeFileSync(
    resolve(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  )

  console.log('\n✅ Build complete! Load dist/ as unpacked extension.')
}

buildExtension().catch(err => {
  console.error('Build failed:', err)
  process.exit(1)
})
