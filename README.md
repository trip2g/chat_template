# trip2g webchat template

A drop-in [trip2g](https://github.com/trip2g/trip2g) layout: a chat page for a
[Hermes Agent](https://github.com/NousResearch/hermes-agent) API server, with a
file explorer over the site's own stored files.

- Left: chat sessions. Middle: the chat, with streaming replies. Right: files –
  search, preview (image, video, audio, PDF, text), upload, and "Attach to
  message", which puts the file's link and its vault path into the message.
- One HTML file, plain JavaScript, no build step. An agent (or you) can edit it
  in place in the vault.

## Install

In the root of your trip2g vault:

```bash
curl -L -o /tmp/webchat.zip \
  https://github.com/trip2g/chat_template/releases/latest/download/webchat.zip
unzip -o /tmp/webchat.zip -d .
```

This writes three files and nothing else:

| File | What it is |
|---|---|
| `_layouts/webchat.html` | the whole page |
| `chat.md` | the page itself, at `/chat` (`layout: webchat`) |
| `_webchat/README.md` | notes for whoever edits the page: where each part lives, the rules that keep it working |

Sync the vault. Running the same two commands again resets the page.

## What it needs

- **The chat** calls a Hermes Agent API server on the same site, at the path in
  `chat.md` → `chat_api` (default `/_system/chatapi`). Put a reverse proxy
  there that authenticates the visitor and forwards `/api/sessions…` to the
  Hermes API server. The page sends no credentials of its own.
- **The files** use trip2g's admin GraphQL with the signed-in admin's session:
  `admin.allLatestNoteAssets(filter: …)` with `contentType` and `notes` on each
  asset, `pushNotes` and `uploadNoteAsset` for uploads. Visitors who are not the
  site admin get no file list.
- Uploaded files go to `/uploads/` and are embedded in the hidden note
  `uploads/_files.md`; trip2g keeps a file only while a note refers to it.

## Release

```bash
./scripts/release.sh   # dist/webchat.zip and dist/webchat.html
gh release create vN dist/webchat.zip dist/webchat.html
```
