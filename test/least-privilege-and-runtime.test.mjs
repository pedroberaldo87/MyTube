import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// INVARIANT: the manifest asks for nothing the code does not use, and the
// declared Node floor is a supported release line.
//
// `tabs` exposes url/title/favicon of every open tab. The only chrome.tabs call
// is `sendMessage(tab.id, ...)` on the tab handed to action.onClicked, which
// needs no permission. If someone adds a call that does need it (query with a
// url/title filter, reading tab.url / tab.title), this test fails and tells
// them to add the permission back on purpose.

const root = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

// ── manifest permissions ─────────────────────────────────────────────────────
const build = read('build.ts')
const block = build.match(/permissions:\s*\[([\s\S]*?)\]/)
assert.ok(block, 'could not find the permissions array in build.ts')
const permissions = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
assert.deepEqual(
  permissions.slice().sort(),
  ['alarms', 'storage', 'unlimitedStorage'],
  `unexpected manifest permissions: ${permissions.join(', ')}`,
)

// ── every chrome.tabs use must be one that needs no permission ───────────────
const sources = walk(join(root, 'src'))
const tabsCalls = []
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/chrome\.tabs\.(\w+)/g)) tabsCalls.push(m[1])
  assert.ok(
    !/\b(?:tab|sender\.tab|activeTab)\??\.(?:url|title|favIconUrl|pendingUrl)\b/.test(text),
    `${file} reads a tab's url/title/favicon, which needs the "tabs" permission`,
  )
}
assert.ok(tabsCalls.length > 0, 'expected the toolbar-click handler to call chrome.tabs.sendMessage')
assert.ok(
  tabsCalls.every((c) => c === 'sendMessage'),
  `chrome.tabs.${tabsCalls.find((c) => c !== 'sendMessage')} may need the "tabs" permission`,
)

// ── Node floor ───────────────────────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'))
assert.equal(pkg.engines.node, '>=22', 'Node 20 is end of life; engines must require >=22')
const ci = read('.github/workflows/ci.yml')
assert.match(ci, /node-version:\s*'22'/, 'CI must run on Node 22')

console.log(`✓ least-privilege-and-runtime: permissions [${permissions.join(', ')}], chrome.tabs calls [${[...new Set(tabsCalls)].join(', ')}], engines ${pkg.engines.node}`)
