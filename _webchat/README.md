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
| Columns, the files drawer, phone panes | `.app` grid, `data-drawer`, and the `@media (max-width: 860px)` block |
| Icons | the `<svg class="sprite">` at the top of `<body>`; `icon(name)` in the script |
| The sign-in corner (and the theme toggle) | `.signin` at the foot of the chat list |
| The chat API prefix | `WEBCHAT_API_PREFIX` in the first `<script>` |
| Whether the visitor is the admin | `<script type="application/json" id="webchat-data">` |
| Chat list, its groups, messages, sending | the section "Chat API" in the script – `loadSessions`, `sessionGroup`, `send` |
| Streaming reply | `readEvents` and the `handlers` table in `send` |
| How a message is drawn | `messageNode`, `renderMarkdown` / `renderInline` / `listNode` |
| An attached file as a card in a message | `ATTACHMENT` and `attachmentCard` |
| File list, search, paging | the section "Files" – `LIST_FILES`, `loadFiles` |
| Preview by file type | `showPreview` |
| Files waiting to be sent (chips) | `attach`, `renderChips` |
| The text a file adds to a message | `attachmentText` |
| Upload | the section "Upload" – `uploadFile` |
| Which pane or drawer is shown | the section "Wiring" – `setTab`, `setDrawer` |

## How it talks to the server

- **Chat**: the Hermes Agent API server, reached on this same site under
  `WEBCHAT_API_PREFIX` (default `/_system/webchatproxy`) through an
  authenticating proxy. A 401 shows a "Sign in" button that opens
  `<prefix>/oauth2/start?rd=<this page>`; 403, 502 and 503 show "try again".
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

## A file attached to a message

"Attach to message" puts the file as a chip above the message box. On
send, each chip adds two lines after the typed text:

```
[file: photo.png](https://<site>/_system/assets/<sha256>/photo.png)
(trip2g vault file /uploads/photo.png, image/png, 120 KB, referenced by uploads/_files.md)
```

The link needs the site admin's session or an API key. The vault path is the
same file in your own vault after sync. In the chat, these two lines are drawn
as a file card (`attachmentCard`); the agent receives them as text.

## Rules that keep the page working

- **Jet parses the whole layout**, the script too. Never write two opening
  curly braces in a row, or an opening curly brace followed by a star,
  anywhere in the file except the three Jet calls already there (`title`,
  `defaultTemplate.UserSpaceScripts()`, the `webchat-data` block). The page
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
