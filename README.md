# Pass The Light

Node.js site and admin backend for `passthelight.live`.

## Requirements

- Node.js 18 or newer

## What should be in Git

This repository is intended to be cloned onto another server and started directly.
Keep these in Git:

- `server.js`
- `package.json`
- `public/`
- `data/site.json`
- `uploads/` files referenced by `data/site.json`

Do not keep runtime churn in Git:

- `node_modules/`
- `data/claims.json`
- `data/light-claims.json`
- `data/lights.json`
- `*.log`

The server creates missing runtime storage automatically on first start.

## Deploy on another server

```bash
git clone <your-github-url>
cd passthelight.live
npm install
npm start
```

By default the app listens on port `3000`.

To use a different port:

```bash
PORT=8080 npm start
```

## Notes

- The app stores uploaded images in `uploads/`.
- The app stores editable site content and admin credentials in `data/site.json`.
- Counter claims and globe light cooldown data are recreated automatically if missing.
- If you run behind Nginx or Apache, proxy requests to the Node.js port.
