# Pass The Light

Deployable Node.js site and admin backend.

Repository:

- `https://github.com/steamfreeapp/passthelight`

## Requirements

- Node.js 18 or newer

## Step By Step Deployment

### 1. Clone the repository

```bash
git clone https://github.com/steamfreeapp/passthelight.git
cd passthelight
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the site

```bash
npm start
```

The site starts on port `3000` by default.

### 4. Start on a different port if needed

```bash
PORT=8080 npm start
```

## What Is Included

- `server.js`
- `package.json`
- `public/`
- `data/site.json`
- `uploads/` images referenced by `data/site.json`
- `.gitignore`
- `README.md`

## What Is Not Included

- `node_modules/`
- runtime claim files
- runtime light history files
- log files

These runtime files are created automatically when the server starts.

## Notes

- Uploaded site images are stored in `uploads/`.
- If you run behind Nginx or Apache, proxy traffic to the Node.js port.
- If you want the process to stay alive after logout, run it with a process manager such as `pm2` or `systemd`.

## Quick Start

```bash
git clone https://github.com/steamfreeapp/passthelight.git
cd passthelight
npm install
npm start
```
