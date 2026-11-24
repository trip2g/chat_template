---
title: webchat template
---

# webchat – notes for the agent that maintains this page

The chat page is the note `webchat.md` (address `/webchat`) drawn by the layout
`_layouts/webchat.html`. Everything the page does is in that one HTML file:
markup, styles and a plain script, no build step. Edit it in place and sync.

## Where each part lives in `_layouts/webchat.html`

| Part | Look for |
|---|---|
| Colours, light and dark | the `:root` blocks at the top of `<style>` |
| Three columns; on a phone the chat list and the files slide over the chat | `.app` grid and the `@media (max-width: 860px)` block |
| Russian and English texts | `TEXT` in the script; static labels carry `data-i18n` |
| The agent's language | the `lang` attribute of `<html>`; the RU/EN switch overrides it and is kept in this browser (`webchat_lang`) |
| Chats hidden from the list | `HIDDEN_SESSION_ID`, `HIDDEN_SESSION_SOURCES` |
| The chat API prefix | `WEBCHAT_API_PREFIX` in the first `<script>` |
| Chat list, messages, sending | the section "Chat API" in the script |
| Streaming reply | `readEvents` and the `handlers` table in `send` |
| How a message is drawn (code, tables, links) | `renderMarkdown` / `renderInline` |
| Recent files, search, preview | the section "Files" – `loadFiles`, `renderFiles`, `showPreview` |
| Preview by file type | `showPreview` |
| The text a file adds to a message | `attachmentText` |
| Upload to the proxy's cache | `storeFile` |
| Chips for `@name`, `sandbox:` and `MEDIA:` in messages | `fileReference`, `cacheTarget`, `fileNode` |
| Paperclip, drop and paste into the message box | the section "The message box" – `attachToComposer` |
| Voice message | the same section – `startRecording`, `sendVoice`, `transcribe` |

## How it talks to the server

- **Chat**: the Hermes Agent API server, reached on this same site under
  `WEBCHAT_API_PREFIX` (default `/_system/webchatproxy`) through an
  authenticating proxy. A 401 shows a "Sign in" button that opens
  `<prefix>/oauth2/start?rd=<this page>`; 403, 502 and 503 show "try again". Tool calls of a running reply collapse into one chip.
  Formats are Hermes' own: `GET /api/sessions`, `POST /api/sessions`,
  `GET /api/sessions/{id}/messages`, `POST /api/sessions/{id}/chat/stream`
  (server-sent events `assistant.delta`, `tool.started`,
  `assistant.completed`, `run.completed`, `error`, `done`). Every chat is
  visible to everyone who can open the page.
- **Files**: the proxy's own file cache, through `<prefix>/api/files` (list,
  upload, download). It is one folder on the agent's disk,
  `/opt/webchat-files`, 10 MB per file, the oldest deleted to make room. Nothing
  goes into the knowledge base from this page.

## Attaching a file and voice messages in the message box

- The paperclip, a file dropped on the message box and an image pasted into it
  upload the file to the cache (`storeFile`) and show it as a chip; the message
  then carries `@name`. Any signed-in person can attach.
- The microphone replaces Send while the box is empty. It records with
  `MediaRecorder` (opus in webm or ogg, at most five minutes), then sends the
  recording to `POST <prefix>/api/transcribe` (multipart, field `audio`; the
  answer is `{ "text": "…" }`). The text goes as the message, starting with
  `🎤 voice:`, and the recording is stored in the cache and added as `@name`.
  `GET <prefix>/api/transcribe` answers 2xx when the proxy can transcribe;
  on 501 or an error the microphone stays hidden.

## A file attached to a message, and a file the agent shows

A message carries `@report.pdf` for the file `/opt/webchat-files/report.pdf` on
the agent's disk. The agent shows a file by copying it into
`/opt/webchat-files/out/` and linking it as
`[chart](sandbox:/opt/webchat-files/out/chart.png)`. The page turns `@name`,
`@/opt/webchat-files/…`, `sandbox:/opt/webchat-files/…` and
`MEDIA:/opt/webchat-files/…` into the download route
`<prefix>/api/files/<name>`: a picture shows inline, anything else is a chip. A
path outside `/opt/webchat-files` is a muted "file is on the agent's disk" chip.
An evicted file is "no longer available".

## Rules that keep the page working

- **Jet parses the whole layout**, the script too. Never write two opening
  curly braces in a row, or an opening curly brace followed by a star,
  anywhere in the file except the three Jet calls already there. The page
  stops rendering otherwise. Use `{ a: 1 }` with spaces if you build objects.
- **Never put text from a message, a file or a file name into `innerHTML`.**
  Use `el(...)` or `textContent`. The page runs with the visitor's session:
  markup injected from a chat reply could act as the visitor.
- Links and images in replies are allowed only for `http(s)`, a path on this
  site, and `data:image/png|jpeg|gif|webp`. Keep it so.
- Keep everything in this one file. The vault sync carries `.html` and `.md`
  files; a separate `.js` or `.css` beside the layout may not arrive.

## Reset

Something broken? Put the original three files back – `_layouts/webchat.html`,
`webchat.md` and this README – from wherever this template was installed from,
and sync. Nothing else is touched; a changed `WEBCHAT_API_PREFIX` goes back to
the default. Keep your own variants as `_layouts/webchat-<name>.html`.
