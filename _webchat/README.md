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
| Whether the visitor is the admin | `<script type="application/json" id="webchat-data">` |
| Chat list, messages, sending | the section "Chat API" in the script |
| Streaming reply | `readEvents` and the `handlers` table in `send` |
| How a message is drawn (code, tables, links) | `renderMarkdown` / `renderInline` |
| File list, search, paging | the section "Files" – `LIST_FILES`, `loadFiles` |
| Preview by file type | `showPreview` |
| The text a file adds to a message | `attachmentText` |
| Upload | the section "Upload" – `uploadFile` |
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
- **Files**: trip2g's admin GraphQL at `/_system/graphql`, with the signed-in
  admin's session. Nobody else gets the file list.
  - list: `admin.allLatestNoteAssets(filter: {search, pathPrefix, limit, offset})`
  - upload: the file is embedded into the hidden note `uploads/_files.md`
    (`pushNotes`), then its bytes are sent for that note version
    (`uploadNoteAsset`). trip2g keeps a file only while a note refers to it,
    so do not delete lines from `uploads/_files.md`.
  - only these extensions are stored: images, video, audio, pdf, office
    documents, txt, csv, zip/rar/7z (`UPLOAD_EXTENSIONS`); at most 10 MB
    (`MAX_UPLOAD_BYTES`, the server's request limit).

## Attaching a file and voice messages in the message box

- The paperclip, a file dropped on the message box and an image pasted into it
  store the file like the Files panel does (`storeFile`) and add the same text
  as "Attach to message" to the message being typed. Admin only.
- The microphone replaces Send while the box is empty. It records with
  `MediaRecorder` (opus in webm or ogg, at most five minutes), then sends the
  recording to `POST <prefix>/api/transcribe` (multipart, field `audio`; the
  answer is `{ "text": "…" }`). The text goes as the message, starting with
  `🎤 voice:`, and the recording is stored and attached so the agent can open
  it. `GET <prefix>/api/transcribe` answers 2xx when the proxy can transcribe;
  on 501 or an error the microphone stays hidden.

## A file attached to a message

"Attach to message" adds two lines to the message:

```
[file: photo.png](https://<site>/_system/assets/<sha256>/photo.png)
(trip2g vault file /uploads/photo.png, image/png, 120 KB, referenced by uploads/_files.md)
```

The link needs the site admin's session or an API key. The vault path is the
same file in your own vault after sync.

## Rules that keep the page working

- **Jet parses the whole layout**, the script too. Never write two opening
  curly braces in a row, or an opening curly brace followed by a star,
  anywhere in the file except the three Jet calls already there. The page
  stops rendering otherwise. Use `{ a: 1 }` with spaces if you build objects.
- **Never put text from a message, a file or a file name into `innerHTML`.**
  Use `el(...)` or `textContent`. The page runs with the admin's session:
  markup injected from a chat reply could do anything the admin can.
- Links and images in replies are allowed only for `http(s)`, a path on this
  site, and `data:image/png|jpeg|gif|webp`. Keep it so.
- Keep everything in this one file. The vault sync carries `.html` and `.md`
  files; a separate `.js` or `.css` beside the layout may not arrive.

## Reset

Something broken? Put the original three files back – `_layouts/webchat.html`,
`webchat.md` and this README – from wherever this template was installed from,
and sync. Nothing else is touched; a changed `WEBCHAT_API_PREFIX` goes back to
the default. Keep your own variants as `_layouts/webchat-<name>.html`.
