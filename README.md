# trip2g webchat template

A [trip2g](https://github.com/trip2g/trip2g) layout: a chat page for a
[Hermes Agent](https://github.com/NousResearch/hermes-agent) API server, with a
file explorer over the site's own stored files.

![The chat page: chat sessions on the left, a streamed reply about an attached PDF in the middle, the file explorer with a PDF preview on the right](docs/screenshot.png)

- **Left** – chat sessions. **Middle** – the chat, with streaming replies.
  **Right** – files: search, preview (image, video, audio, PDF, text), upload,
  and "Attach to message", which puts the file's link and its vault path into
  the message.
- **Message box** – a paperclip (or a dropped or pasted file) attaches a file to the message as a chip; the message carries its name as `@name`. With the box empty, a microphone records a voice message that goes as transcribed text with the recording's `@name`.
- **While the agent answers** – Stop ends only the display (the agent may finish in the background; the page says so); messages typed meanwhile wait in a per-chat queue kept in this browser and go one by one when the turn ends. Under an answer: a copy button and a small gear that lists the tools used.
- **Files in answers** – `@name`, `@/opt/webchat-files/name`, `sandbox:/opt/webchat-files/…` and `MEDIA:/opt/webchat-files/…` become chips (pictures show inline); a path outside that folder is a muted chip.
- One HTML file, plain JavaScript and CSS, no build step and no external
  scripts. You (or an agent) can edit it in place in the vault.
- Light and dark, follows the site's theme toggle; one pane at a time on phones.

## Files

| File | What it is |
|---|---|
| `_layouts/webchat.html` | the whole page |
| `webchat.md` | the page note, served at `/webchat` (`layout: webchat`) |
| `_webchat/README.md` | notes for whoever edits the page: where each part lives, the rules that keep it working |

## Install

Copy the three files into your trip2g vault at the same paths and sync. Open
`/webchat` signed in as the site admin. Copying them again resets the page.

## What it needs

### 1. A same-origin proxy to a Hermes Agent API server

The page calls the Hermes Agent API server's session endpoints on its own
origin, under one path prefix:

```js
var WEBCHAT_API_PREFIX = '/_system/webchatproxy'
```

It is the first `<script>` in `_layouts/webchat.html`; change it there if your
proxy lives elsewhere (no trailing slash). Formats are Hermes' own, unchanged.

| Method and path (after the prefix) | Request | Response fields the page reads |
|---|---|---|
| `GET /api/sessions?limit=100` | – | `data[]`: `id`, `title`, `preview`, `source`, `last_active`, `started_at` |
| `POST /api/sessions` | JSON `{}` | `session.id` |
| `PATCH /api/sessions/{id}` | JSON `{"title": "…"}` | renames a chat (click the title, the ✎ on a row, or the menu) |
| `GET /api/sessions/{id}/messages` | – | `data[]`: `role` (`user` / `assistant`; others are skipped), `content` (a string, or a list of parts with `type: "text"` / `"image_url"`) |
| `POST /api/sessions/{id}/chat/stream` | JSON `{"message": "<text>"}` (or a list of parts: text and `image_url` for pictures up to 4 MB), `Accept: text/event-stream` | server-sent events, below |

Server-sent events the page uses; every other event is ignored:

| Event | `data` fields read | What the page does |
|---|---|---|
| `assistant.delta` | `delta` | appends the text to the reply |
| `tool.started` | `tool_name` | shows "tool: name" above the reply |
| `assistant.completed` | `content` | replaces the reply with the final text |
| `error` | `message` | shows the error under the reply |

Optional, for voice messages: `GET <prefix>/api/transcribe` answers 2xx when the
proxy can turn speech into text (on any other status the microphone stays
hidden), and `POST <prefix>/api/transcribe` takes a multipart form with an
`audio` file (webm or ogg, opus) and answers JSON `{ "text": "…" }`.

Every request is `fetch` with `credentials: 'same-origin'`; POSTs carry
`Content-Type: application/json`. The page sends no token of its own:
**authentication is whatever the proxy enforces**, usually with a cookie. How
the page reads the answers:

- `401`, a redirect, or an HTML page: "Sign in", a link to
  `<prefix>/oauth2/start?rd=<this page's path>` (the oauth2-proxy sign-in path).
- `403`, `502`, `503`: "not available right now, try again".
- any other non-2xx: the status and the start of the body.

Everyone who can open the page and pass the proxy sees every session the API
lists. Restrict that in the proxy if you need to.

### 2. Files, through the same proxy

Attached files and the files an agent shows live in one folder the proxy keeps
(on the agent's disk, `/opt/webchat-files`); the page never talks to the
site's own file store.

| Method and path (after the prefix) | Request | Response |
|---|---|---|
| `GET /api/files` | – | `{ "files": [{ "name", "path", "size", "modified" }] }`, newest first; `name` may carry a folder (`out/chart.png`) |
| `POST /api/files` | multipart form, one file in `file`, at most 10 MB | `{ "name", "path", "size", "modified" }`; a taken name gets `-2`, a name never has spaces |
| `GET /api/files/{name}` | – | the file's bytes; 404 once it was deleted to make room |

The message carries a file as `@name` (the file `/opt/webchat-files/name` on
the agent's disk); the agent shows a file by copying it into
`/opt/webchat-files/out/` and linking `sandbox:/opt/webchat-files/out/name`.

The sign-in button in the corner is trip2g's own
(`defaultTemplate.UserSpaceScripts()`).

## Extend

Everything is in `_layouts/webchat.html`; `_webchat/README.md` maps each part
(colours, columns, chat, streaming, markdown, file list, preview, upload,
attach) to the code. Two rules:

- trip2g's template engine (Jet) parses the whole file, the script included.
  Never write two opening curly braces in a row, or an opening curly brace
  followed by a star, outside the three template calls already there.
- Never put text from a message or a file name into `innerHTML`. The page runs
  with the admin's session; use the `el(...)` helper or `textContent`.
