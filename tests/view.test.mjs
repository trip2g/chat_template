import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom')

const here = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = fs.readFileSync(path.join(here, '..', '_layouts', 'view.html'), 'utf8')
const ORIGIN = 'https://agent.example.com'

const BOARD_AND_CHAT = {
  type: 'responsive',
  branches: [
    {
      min: 'desktop',
      layout: {
        type: 'split', name: 'main', direction: 'row', sizes: ['1fr', '420px'], resizable: true,
        items: [
          { type: 'frame', name: 'board', src: '/projects/site/board' },
          { type: 'frame', name: 'chat', src: '/webchat/chat' },
        ],
      },
    },
    {
      min: 'mobile',
      layout: {
        type: 'tabs',
        items: [
          { type: 'frame', name: 'board', title: 'Доска', src: '/projects/site/board' },
          { type: 'frame', name: 'chat', title: 'Чат', src: '/webchat/chat' },
        ],
      },
    },
  ],
}

function page(view) {
  return SOURCE.replace('{{ title }}', 'view')
    .replace('{{ json(note.M().Get("view")) }}', JSON.stringify(view === undefined ? null : view).replace(/</g, '\\u003c'))
}

function chatWindow(document) {
  return document.querySelector('iframe[name="chat"]').contentWindow
}

async function mount(view, { width = 1400, storage, onError } = {}) {
  const requested = []
  const loader = new (class extends ResourceLoader {
    fetch(url) {
      requested.push(url)
      return Promise.resolve(Buffer.from('<!DOCTYPE html><html><body>frame</body></html>'))
    }
  })()
  const dom = new JSDOM(page(view), {
    url: ORIGIN + '/projects/site',
    runScripts: 'dangerously',
    resources: loader,
    virtualConsole: (() => { const c = new VirtualConsole(); if (onError) c.on('jsdomError', (e) => onError(String(e.message))); return c })(),
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
      if (storage) for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v)
    },
  })
  await new Promise((r) => setTimeout(r, 100))
  return { dom, window: dom.window, document: dom.window.document, requested }
}

function frames(document) {
  return [...document.querySelectorAll('#view-root iframe')].map((f) => ({ name: f.getAttribute('name'), src: f.getAttribute('src') }))
}

function post(window, data, { origin = ORIGIN, from } = {}) {
  const chat = window.document.querySelector('#view-root iframe[name="chat"]')
  const source = from === undefined ? (chat || window.document.querySelector('#view-root iframe')).contentWindow : from
  const event = new window.Event('message')
  Object.assign(event, { data, origin, source })
  window.dispatchEvent(event)
}

function banner(document) {
  const node = document.querySelector('.banner span')
  return node ? node.textContent : ''
}

test('the frontmatter layout draws the board and the chat side by side on a desktop', async () => {
  const { document } = await mount(BOARD_AND_CHAT)
  assert.deepEqual(frames(document), [
    { name: 'board', src: '/projects/site/board' },
    { name: 'chat', src: '/webchat/chat' },
  ])
  const split = document.querySelector('.split')
  assert.equal(split.style.gridTemplateColumns, '1fr 6px 420px')
  assert.equal(document.querySelectorAll('.handle').length, 1)
})

test('a phone gets the tabs branch, and a tab bar with the titles', async () => {
  const { document } = await mount(BOARD_AND_CHAT, { width: 390 })
  assert.equal(document.querySelector('.split'), null)
  const tabs = [...document.querySelectorAll('.tabs .bar button')].map((b) => b.textContent)
  assert.deepEqual(tabs, ['Доска', 'Чат'])
  assert.equal(frames(document).length, 2)
})

test('a numeric min and the tablet preset pick the widest branch that fits', async () => {
  const view = {
    type: 'responsive',
    branches: [
      { min: 1000, layout: { type: 'message', text: 'wide' } },
      { min: 'tablet', layout: { type: 'message', text: 'tablet' } },
      { min: 0, layout: { type: 'message', text: 'narrow' } },
    ],
  }
  assert.equal((await mount(view, { width: 900 })).document.querySelector('.message').textContent, 'tablet')
  assert.equal((await mount(view, { width: 1000 })).document.querySelector('.message').textContent, 'wide')
  assert.equal((await mount(view, { width: 500 })).document.querySelector('.message').textContent, 'narrow')
})

test('resizing the window across a preset re-evaluates the branch', async () => {
  const { window, document } = await mount(BOARD_AND_CHAT, { width: 1400 })
  assert.ok(document.querySelector('.split'))
  window.innerWidth = 500
  window.dispatchEvent(new window.Event('resize'))
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(document.querySelector('.split'), null)
  assert.ok(document.querySelector('.tabs'))
})

test('an iframe is named after its frame, so a link can target it', async () => {
  const { document } = await mount(BOARD_AND_CHAT)
  assert.ok(document.querySelector('iframe[name="chat"]'))
  assert.ok(document.querySelector('iframe[name="board"]'))
})

const HOSTILE_SRCS = {
  'another site': 'https://attacker.example/x',
  'a protocol-relative address': '//attacker.example/x',
  'a backslash address': '/\\attacker.example/x',
  'javascript:': 'javascript:alert(1)',
  'data:': 'data:text/html,<script>parent.owned=1</script>',
  'a relative path': 'board',
  'a path with a newline': '/a\njavascript:alert(1)',
  'a number': 42,
}

for (const [name, src] of Object.entries(HOSTILE_SRCS)) {
  test(`a frame src that is ${name} is refused with a visible message and never loaded`, async () => {
    const { window, document, requested } = await mount({ type: 'split', items: [{ type: 'frame', name: 'x', src }, { type: 'frame', name: 'chat', src: '/webchat/chat' }] })
    assert.deepEqual(frames(document), [{ name: 'chat', src: '/webchat/chat' }])
    assert.match(document.querySelector('.message').textContent, /не поддерживается/)
    assert.equal(window.owned, undefined)
    assert.equal(requested.filter((u) => !String(u).startsWith(ORIGIN)).length, 0)
  })
}

test('an unknown node type shows «не поддерживается» in its place', async () => {
  const { document } = await mount({ type: 'split', items: [{ type: 'script', code: 'alert(1)' }, { type: 'frame', name: 'chat', src: '/webchat/chat' }] })
  assert.match(document.querySelector('.message').textContent, /не поддерживается: script/)
  assert.equal(frames(document).length, 1)
})

test('a depth bomb in the frontmatter shows a refusal, not a hang', async () => {
  let node = { type: 'frame', name: 'chat', src: '/webchat/chat' }
  for (let i = 0; i < 200; i++) node = { type: 'split', items: [node] }
  const { document } = await mount(node)
  assert.match(banner(document), /слишком глубокая/)
  assert.equal(frames(document).length, 0)
})

test('the chat may replace the layout with a whole tree', async () => {
  const { window, document } = await mount(BOARD_AND_CHAT)
  post(window, { type: 'webchat-view', view: JSON.stringify({ type: 'frame', name: 'chat', src: '/webchat/chat' }) })
  assert.deepEqual(frames(document), [{ name: 'chat', src: '/webchat/chat' }])
})

test('open changes one frame and keeps the rest', async () => {
  const { window, document } = await mount(BOARD_AND_CHAT)
  post(window, { type: 'webchat-view', view: '{"type":"open","target":"board","src":"/projects/other/board"}' })
  assert.deepEqual(frames(document), [
    { name: 'board', src: '/projects/other/board' },
    { name: 'chat', src: '/webchat/chat' },
  ])
})

test('open into a tab switches to that tab, and survives a resize', async () => {
  const { window, document } = await mount(BOARD_AND_CHAT, { width: 390 })
  document.querySelectorAll('.tabs .bar button')[1].click()
  post(window, { type: 'webchat-view', view: '{"type":"open","target":"board","src":"/projects/other/board"}' })
  const selected = [...document.querySelectorAll('.tabs .bar button')].map((b) => b.getAttribute('aria-selected'))
  assert.deepEqual(selected, ['true', 'false'])
  window.innerWidth = 1400
  window.dispatchEvent(new window.Event('resize'))
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(document.querySelector('iframe[name="board"]').getAttribute('src'), '/projects/other/board')
})

const HOSTILE_COMMANDS = {
  'open with another site': ['{"type":"open","target":"board","src":"https://attacker.example/"}', /не на этом сайте/],
  'open with javascript:': ['{"type":"open","target":"board","src":"javascript:alert(1)"}', /не на этом сайте/],
  'open into a frame that is not there': ['{"type":"open","target":"nope","src":"/x"}', /нет рамки/],
  'an unknown top-level type': ['{"type":"eval","code":"alert(1)"}', /не поддерживается/],
  'text that is not JSON': ['alert(1)', /это не JSON/],
  'a huge JSON': [JSON.stringify({ type: 'message', text: 'x'.repeat(40000) }), /слишком большая/],
  'a nested depth bomb': ['['.repeat(5000) + ']'.repeat(5000), /слишком (глубокая|большая)/],
  'a deep but small tree': [JSON.stringify((() => { let n = { type: 'message', text: 'x' }; for (let i = 0; i < 20; i++) n = { type: 'split', items: [n] }; return n })()), /слишком глубокая/],
  'too many nodes': [JSON.stringify({ type: 'split', items: Array.from({ length: 8 }, () => ({ type: 'split', items: Array.from({ length: 8 }, () => ({ type: 'message', text: 'x' })) })) }), /слишком много/],
}

for (const [name, [view, reason]] of Object.entries(HOSTILE_COMMANDS)) {
  test(`${name} from the chat is refused visibly and the layout stays`, async () => {
    const { window, document } = await mount(BOARD_AND_CHAT)
    post(window, { type: 'webchat-view', view })
    assert.match(banner(document), reason)
    assert.deepEqual(frames(document), [
      { name: 'board', src: '/projects/site/board' },
      { name: 'chat', src: '/webchat/chat' },
    ])
    assert.equal(window.owned, undefined)
  })
}

test('a message from another origin is ignored', async () => {
  const { window, document } = await mount(BOARD_AND_CHAT)
  post(window, { type: 'webchat-view', view: '{"type":"message","text":"owned"}' }, { origin: 'https://attacker.example' })
  assert.equal(frames(document).length, 2)
})

test('a message from a window that is not one of the frames is ignored', async () => {
  const { window, document } = await mount(BOARD_AND_CHAT)
  post(window, { type: 'webchat-view', view: '{"type":"message","text":"owned"}' }, { from: window })
  post(window, { type: 'webchat-view', view: '{"type":"message","text":"owned"}' }, { from: null })
  assert.equal(frames(document).length, 2)
})

test('the frames answer a view-state request with their names and paths only', async () => {
  const { window, document } = await mount(BOARD_AND_CHAT)
  const chat = document.querySelector('iframe[name="chat"]').contentWindow
  const answers = []
  chat.postMessage = (data, origin) => answers.push({ data, origin })
  post(window, { type: 'webchat-view-state-request', id: 'r1' }, { from: chat })
  assert.equal(answers.length, 1)
  assert.equal(answers[0].origin, ORIGIN)
  assert.equal(answers[0].data.type, 'webchat-view-state')
  assert.equal(answers[0].data.id, 'r1')
  assert.deepEqual(JSON.parse(JSON.stringify(answers[0].data.frames.map((f) => f.name))), ['board', 'chat'])
  for (const f of answers[0].data.frames) assert.match(f.path, /^\/[A-Za-z0-9._~%/-]*$/)
})

test('a dragged size is restored for the same split name and item count', async () => {
  const key = 'view_sizes:/projects/site:main'
  const { document } = await mount(BOARD_AND_CHAT, { storage: { [key]: JSON.stringify({ count: 2, sizes: ['70fr', '30fr'] }) } })
  assert.equal(document.querySelector('.split').style.gridTemplateColumns, '70fr 6px 30fr')
})

test('a dragged size is dropped when the item count changed', async () => {
  const key = 'view_sizes:/projects/site:main'
  const { document } = await mount(BOARD_AND_CHAT, { storage: { [key]: JSON.stringify({ count: 3, sizes: ['1fr', '1fr', '1fr'] }) } })
  assert.equal(document.querySelector('.split').style.gridTemplateColumns, '1fr 6px 420px')
})

test('a stored size that is not a size is ignored', async () => {
  const key = 'view_sizes:/projects/site:main'
  const { document } = await mount(BOARD_AND_CHAT, { storage: { [key]: JSON.stringify({ count: 2, sizes: ['1fr;background:url(x)', '1fr'] }) } })
  assert.equal(document.querySelector('.split').style.gridTemplateColumns, '1fr 6px 420px')
})

test('a page without view: says so', async () => {
  const { document } = await mount(undefined)
  assert.match(document.querySelector('.message').textContent, /нет раскладки/)
})

const DOOR_PATHS = [
  '/graphql',
  '/GraphQL/',
  '/_system/webchatproxy/api/files/x',
  '/_system/webchatproxy/oauth2/sign_out',
  '/_system/desktop/',
  '/a/%2e%2e/_system/desktop/',
  '/a/../_system/desktop/',
  '/webchat/%2e%2e/admin',
  '/admin',
  '/admin/notes',
  '/api/graphql',
  '/oauth2/start',
  '/_layouts/view.html',
  '/_webchat/README',
  '/a%2fb',
]

for (const src of DOOR_PATHS) {
  test(`a frame src of ${src} is refused`, async () => {
    const { document, requested } = await mount({ type: 'split', items: [{ type: 'frame', name: 'x', src }, { type: 'frame', name: 'chat', src: '/webchat/chat' }] })
    assert.deepEqual(frames(document), [{ name: 'chat', src: '/webchat/chat' }])
    assert.equal(requested.filter((u) => String(u).includes('_system') || String(u).includes('admin')).length, 0)
  })
  test(`open into a frame with ${src} is refused`, async () => {
    const { window, document } = await mount(BOARD_AND_CHAT)
    post(window, { type: 'webchat-view', view: JSON.stringify({ type: 'open', target: 'board', src }) }, { from: chatWindow(document) })
    assert.match(banner(document), /не на этом сайте/)
    assert.equal(document.querySelector('iframe[name="board"]').getAttribute('src'), '/projects/site/board')
  })
}

test('the chat parts and a hash stay allowed, a query is dropped', async () => {
  const { document } = await mount({ type: 'split', items: [
    { type: 'frame', name: 'sessions', src: '/webchat/sessions' },
    { type: 'frame', name: 'chat', src: '/webchat/chat#session=abc' },
    { type: 'frame', name: 'files', src: '/webchat/files?x=1' },
  ] })
  assert.deepEqual(frames(document).map((f) => f.src), ['/webchat/sessions', '/webchat/chat#session=abc', '/webchat/files'])
})

test('every frame is sandboxed without downloads or free top navigation', async () => {
  const { document } = await mount(BOARD_AND_CHAT)
  for (const iframe of document.querySelectorAll('iframe')) {
    const tokens = iframe.getAttribute('sandbox').split(/\s+/).sort()
    assert.deepEqual(tokens, ['allow-forms', 'allow-popups', 'allow-same-origin', 'allow-scripts', 'allow-top-navigation-by-user-activation'])
  }
})

for (const [sizes, want] of [[['0px', '420px'], '1fr 6px 420px'], [['10px', '420px'], '1fr 6px 420px'], [['1%', '99%'], '1fr 6px 99%'], [['0fr', '1fr'], '1fr 6px 1fr'], [['48px', '5%'], '48px 6px 5%']]) {
  test(`sizes ${sizes.join(' ')} draw as ${want}`, async () => {
    const view = { type: 'split', resizable: true, sizes, items: [{ type: 'frame', name: 'board', src: '/b' }, { type: 'frame', name: 'chat', src: '/webchat/chat' }] }
    const { document } = await mount(view)
    assert.equal(document.querySelector('.split').style.gridTemplateColumns, want)
  })
}

test('a command from a frame other than the chat is ignored', async () => {
  const { window, document } = await mount(BOARD_AND_CHAT)
  const board = document.querySelector('iframe[name="board"]').contentWindow
  post(window, { type: 'webchat-view', view: '{"type":"message","text":"owned"}' }, { from: board })
  assert.equal(frames(document).length, 2)
  const answers = []
  board.postMessage = (data) => answers.push(data)
  post(window, { type: 'webchat-view-state-request', id: 'r' }, { from: board })
  assert.equal(answers.length, 0)
})

test('a tree with more than eight frames on screen is refused', async () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ type: 'frame', name: 'f' + i, src: '/p' + i }))
  const { document } = await mount({ type: 'split', items: [{ type: 'split', items: items.slice(0, 5) }, { type: 'split', items: items.slice(5) }] })
  assert.match(banner(document), /слишком много/)
  assert.equal(frames(document).length, 0)
})

test('a frame that wandered to a path with capitals or % is left out of the view state', async () => {
  const { window, document } = await mount({ type: 'split', items: [
    { type: 'frame', name: 'board', src: '/Projects/Site' },
    { type: 'frame', name: 'chat', src: '/webchat/chat' },
  ] })
  const chat = chatWindow(document)
  const answers = []
  chat.postMessage = (data) => answers.push(data)
  post(window, { type: 'webchat-view-state-request', id: 'r' }, { from: chat })
  assert.deepEqual(JSON.parse(JSON.stringify(answers[0].frames)), [{ name: 'chat', path: '/webchat/chat' }])
})

test('a frame asking to sign in sends the whole page to the door', async () => {
  const errors = []
  const { window, document } = await mount(BOARD_AND_CHAT, { onError: (e) => errors.push(e) })
  post(window, { type: 'webchat-sign-in' }, { from: document.querySelector('iframe[name="board"]').contentWindow })
  assert.ok(errors.some((e) => /navigation/i.test(e)), errors.join('|'))
})

test('the sessions frame may open a chat in the chat frame, and nothing else', async () => {
  const view = { type: 'split', items: [
    { type: 'frame', name: 'sessions', src: '/webchat/sessions' },
    { type: 'frame', name: 'chat', src: '/webchat/chat' },
  ] }
  const { window, document } = await mount(view)
  const sessions = document.querySelector('iframe[name="sessions"]').contentWindow
  post(window, { type: 'webchat-open-session', id: 'abc_1' }, { from: sessions })
  assert.equal(document.querySelector('iframe[name="chat"]').getAttribute('src'), '/webchat/chat#session=abc_1')
  for (const id of ['../x', 'a b', 'x#y', '', 'a'.repeat(129), 42]) {
    post(window, { type: 'webchat-open-session', id }, { from: sessions })
    assert.equal(document.querySelector('iframe[name="chat"]').getAttribute('src'), '/webchat/chat#session=abc_1')
  }
  post(window, { type: 'webchat-open-session', id: 'evil' }, { origin: 'https://attacker.example', from: sessions })
  assert.equal(document.querySelector('iframe[name="chat"]').getAttribute('src'), '/webchat/chat#session=abc_1')
})

for (const src of ['/?tg_auth_token=attacker', '/notes/x?hat=attacker#top', '/notes/x?tg_auth_token=a&hat=b']) {
  test(`a sign-in token in ${src} never reaches the frame`, async () => {
    const { window, document } = await mount({ type: 'split', items: [{ type: 'frame', name: 'board', src }, { type: 'frame', name: 'chat', src: '/webchat/chat' }] })
    const got = document.querySelector('iframe[name="board"]').getAttribute('src')
    assert.doesNotMatch(got, /tg_auth_token|hat=|\?/)
    post(window, { type: 'webchat-view', view: JSON.stringify({ type: 'open', target: 'board', src }) }, { from: chatWindow(document) })
    assert.doesNotMatch(document.querySelector('iframe[name="board"]').getAttribute('src'), /tg_auth_token|hat=|\?/)
  })
}

for (const [sizes, want] of [[['0.05fr', '1fr'], '1fr 6px 1fr'], [['101fr', '1fr'], '1fr 6px 1fr'], [['0.1fr', '100fr'], '0.1fr 6px 100fr'], [['4001px', '420px'], '1fr 6px 420px'], [['4000px', '420px'], '4000px 6px 420px']]) {
  test(`bounded sizes ${sizes.join(' ')} draw as ${want}`, async () => {
    const view = { type: 'split', resizable: true, sizes, items: [{ type: 'frame', name: 'board', src: '/b' }, { type: 'frame', name: 'chat', src: '/webchat/chat' }] }
    const { document } = await mount(view)
    assert.equal(document.querySelector('.split').style.gridTemplateColumns, want)
  })
}
