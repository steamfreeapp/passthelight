const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "site.json");
const CLAIMS_FILE = path.join(DATA_DIR, "claims.json");
const LIGHTS_FILE = path.join(DATA_DIR, "lights.json");
const LIGHT_CLAIMS_FILE = path.join(DATA_DIR, "light-claims.json");
const UPLOADS_DIR = path.join(ROOT_DIR, "uploads");
const SESSION_COOKIE = "ptl_admin_session";
const COUNTER_COOKIE = "ptl_light_claimed";
const GLOBE_LIGHT_COOKIE = "ptl_globe_light_claimed";
const COUNTER_CLAIM_WINDOW_MS = 1000 * 60 * 60 * 24;
const GLOBE_LIGHT_CLAIM_WINDOW_MS = 1000 * 60 * 60 * 24;
const MAX_STORED_LIGHTS = 4000;
const sessions = new Map();

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

function defaultSite() {
  return {
    hero: {
      title: "PASS THE LIGHT",
      quote: "To pass the light, you must BE the light.",
      image: ""
    },
    instructions: ["ACCEPT LIGHT", "PASS THE LIGHT"],
    counter: {
      value: 100000,
      label: "חסדים טובים",
      description: "Good deeds shared so far."
    },
    gallery: [],
    signature: {
      text: "Pass The Light",
      image: ""
    },
    theme: {
      background: "#FFFFFF",
      accent: "#D4AF37",
      soft: "#F5F5F5",
      counterBackground: "#050505"
    }
  };
}

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    const salt = crypto.randomBytes(16).toString("hex");
    const sessionSecret = crypto.randomBytes(32).toString("hex");
    const initialData = {
      admin: {
        username: "admin",
        salt,
        passwordHash: hashPassword("change-me", salt),
        sessionSecret
      },
      site: defaultSite()
    };

    await writeData(initialData);
  }

  if (!fs.existsSync(CLAIMS_FILE)) {
    await writeClaims({});
  }

  if (!fs.existsSync(LIGHTS_FILE)) {
    await writeLights([]);
  }

  if (!fs.existsSync(LIGHT_CLAIMS_FILE)) {
    await writeLightClaims({});
  }
}

async function readData() {
  const raw = await fsp.readFile(DATA_FILE, "utf8");
  return JSON.parse(stripBom(raw));
}

async function writeData(data) {
  await fsp.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

async function readClaims() {
  const raw = await fsp.readFile(CLAIMS_FILE, "utf8");
  return JSON.parse(stripBom(raw));
}

async function writeClaims(claims) {
  await fsp.writeFile(CLAIMS_FILE, JSON.stringify(claims, null, 2));
}

async function readLights() {
  const raw = await fsp.readFile(LIGHTS_FILE, "utf8");
  const parsed = JSON.parse(stripBom(raw));
  return Array.isArray(parsed) ? parsed.map(normalizeStoredLight).filter(Boolean) : [];
}

async function writeLights(lights) {
  await fsp.writeFile(LIGHTS_FILE, JSON.stringify(lights, null, 2));
}

async function readLightClaims() {
  const raw = await fsp.readFile(LIGHT_CLAIMS_FILE, "utf8");
  return JSON.parse(stripBom(raw));
}

async function writeLightClaims(claims) {
  await fsp.writeFile(LIGHT_CLAIMS_FILE, JSON.stringify(claims, null, 2));
}

function normalizeStoredLight(light) {
  if (!light || typeof light !== "object") {
    return null;
  }

  const lat = Number(light.lat);
  const lng = Number(light.lng);
  const createdAt = Number(light.createdAt);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(createdAt)) {
    return null;
  }

  return {
    id: sanitizeString(light.id, crypto.randomUUID()),
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    countryCode: sanitizeString(light.countryCode),
    countryName: sanitizeString(light.countryName),
    regionCode: sanitizeString(light.regionCode),
    regionName: sanitizeString(light.regionName),
    createdAt
  };
}

function stripBom(value) {
  return typeof value === "string" ? value.replace(/^\uFEFF/, "") : value;
}

async function updateData(mutator) {
  const data = await readData();
  const nextData = await mutator(data);
  await writeData(nextData);
  return nextData;
}

function parseCookies(req) {
  const source = req.headers.cookie || "";
  return source.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      return acc;
    }

    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function setCookie(res, name, value, options = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    bits.push(`Max-Age=${options.maxAge}`);
  }

  if (options.httpOnly) {
    bits.push("HttpOnly");
  }

  if (options.sameSite) {
    bits.push(`SameSite=${options.sameSite}`);
  }

  if (options.path) {
    bits.push(`Path=${options.path}`);
  }

  if (options.secure) {
    bits.push("Secure");
  }

  const existing = res.getHeader("Set-Cookie");
  const next = Array.isArray(existing) ? existing.concat(bits.join("; ")) : [bits.join("; ")];
  res.setHeader("Set-Cookie", next);
}

function clearCookie(res, name) {
  setCookie(res, name, "", {
    maxAge: 0,
    httpOnly: true,
    path: "/",
    sameSite: "Lax"
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readJsonBody(req, limitBytes = 15 * 1024 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function jsonError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function createSession(data) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12;
  sessions.set(token, { username: data.admin.username, expiresAt });
  return token;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    jsonError(res, 401, "Authentication required");
    return null;
  }

  return session;
}

function sanitizeString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

function sanitizeColor(value, fallback) {
  const next = sanitizeString(value, fallback);
  return /^#[0-9a-fA-F]{6}$/.test(next) ? next : fallback;
}

function clampCounter(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function normalizeSitePayload(input, currentSite) {
  const hero = input.hero || {};
  const counter = input.counter || {};
  const signature = input.signature || {};
  const theme = input.theme || {};
  const incomingInstructions = Array.isArray(input.instructions)
    ? input.instructions
    : typeof input.instructions === "string"
      ? input.instructions.split(/\r?\n/)
      : currentSite.instructions;

  return {
    ...currentSite,
    hero: {
      title: sanitizeString(hero.title, currentSite.hero.title),
      quote: sanitizeString(hero.quote, currentSite.hero.quote),
      image: sanitizeString(hero.image, currentSite.hero.image || "")
    },
    instructions: incomingInstructions
      .map((item) => sanitizeString(item))
      .filter(Boolean)
      .slice(0, 8),
    counter: {
      value: clampCounter(counter.value ?? currentSite.counter.value),
      label: sanitizeString(counter.label, currentSite.counter.label),
      description: sanitizeString(counter.description, currentSite.counter.description)
    },
    signature: {
      text: sanitizeString(signature.text, currentSite.signature.text),
      image: sanitizeString(signature.image, currentSite.signature.image)
    },
    theme: {
      background: sanitizeColor(theme.background, currentSite.theme.background),
      accent: sanitizeColor(theme.accent, currentSite.theme.accent),
      soft: sanitizeColor(theme.soft, currentSite.theme.soft),
      counterBackground: sanitizeColor(theme.counterBackground, currentSite.theme.counterBackground)
    }
  };
}

function publicSitePayload(site) {
  return {
    hero: site.hero,
    instructions: site.instructions,
    counter: site.counter,
    gallery: site.gallery,
    signature: site.signature,
    theme: site.theme
  };
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

async function hasRecentClaim(ip) {
  const claims = await readClaims();
  const lastClaimAt = Number(claims[ip] || 0);
  if (!lastClaimAt) {
    return false;
  }

  return Date.now() - lastClaimAt < COUNTER_CLAIM_WINDOW_MS;
}

async function registerClaim(ip) {
  const claims = await readClaims();
  const now = Date.now();
  const nextClaims = {};

  Object.entries(claims).forEach(([key, value]) => {
    if (now - Number(value) < COUNTER_CLAIM_WINDOW_MS) {
      nextClaims[key] = value;
    }
  });

  nextClaims[ip] = now;
  await writeClaims(nextClaims);
}

function clampLatitude(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Latitude must be a valid number");
  }

  if (parsed < -90 || parsed > 90) {
    throw new Error("Latitude must be between -90 and 90");
  }

  return Math.round(parsed * 10000) / 10000;
}

function clampLongitude(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Longitude must be a valid number");
  }

  if (parsed < -180 || parsed > 180) {
    throw new Error("Longitude must be between -180 and 180");
  }

  return Math.round(parsed * 10000) / 10000;
}

async function hasRecentLightClaim(ip) {
  const claims = await readLightClaims();
  const lastClaimAt = Number(claims[ip] || 0);
  if (!lastClaimAt) {
    return false;
  }

  return Date.now() - lastClaimAt < GLOBE_LIGHT_CLAIM_WINDOW_MS;
}

async function registerLightClaim(ip) {
  const claims = await readLightClaims();
  const now = Date.now();
  const nextClaims = {};

  Object.entries(claims).forEach(([key, value]) => {
    if (now - Number(value) < GLOBE_LIGHT_CLAIM_WINDOW_MS) {
      nextClaims[key] = value;
    }
  });

  nextClaims[ip] = now;
  await writeLightClaims(nextClaims);
}

function fileMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function safeJoin(baseDir, targetPath) {
  const normalized = path.normalize(path.join(baseDir, targetPath));
  const relative = path.relative(baseDir, normalized);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return normalized;
}

async function serveFile(res, filePath) {
  try {
    const content = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": fileMimeType(filePath),
      "Content-Length": content.length
    });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(dataUrl || "");
  if (!match) {
    throw new Error("Invalid image data");
  }

  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  const extension = mimeToExtension(mimeType);
  if (!extension) {
    throw new Error("Unsupported image format");
  }

  return { buffer, extension };
}

function mimeToExtension(mimeType) {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    default:
      return "";
  }
}

function sanitizeFilename(name) {
  const trimmed = sanitizeString(name, "image");
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "image";
}

async function saveImageFromDataUrl(dataUrl, preferredName) {
  const { buffer, extension } = parseDataUrl(dataUrl);
  const fileName = `${Date.now()}-${sanitizeFilename(preferredName)}${extension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  await fsp.writeFile(filePath, buffer);
  return `/uploads/${fileName}`;
}

function isLocalUpload(src) {
  return typeof src === "string" && src.startsWith("/uploads/");
}

async function deleteLocalUpload(src) {
  if (!isLocalUpload(src)) {
    return;
  }

  const filePath = safeJoin(UPLOADS_DIR, src.replace("/uploads/", ""));
  if (!filePath) {
    return;
  }

  try {
    await fsp.unlink(filePath);
  } catch {
    // Ignore missing files.
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;

    if (req.method === "GET" && pathname === "/api/site") {
      const data = await readData();
      sendJson(res, 200, publicSitePayload(data.site));
      return;
    }

    if (req.method === "POST" && pathname === "/api/counter/increment") {
      const cookies = parseCookies(req);
      if (cookies[COUNTER_COOKIE] === "1") {
        jsonError(res, 429, "Light already claimed recently");
        return;
      }

      const clientIp = getClientIp(req);
      if (await hasRecentClaim(clientIp)) {
        jsonError(res, 429, "This IP address already claimed light in the last 24 hours");
        return;
      }

      const nextData = await updateData((data) => {
        data.site.counter.value += 1;
        return data;
      });

      await registerClaim(clientIp);

      setCookie(res, COUNTER_COOKIE, "1", {
        maxAge: COUNTER_CLAIM_WINDOW_MS / 1000,
        httpOnly: true,
        path: "/",
        sameSite: "Lax"
      });

      sendJson(res, 200, {
        value: nextData.site.counter.value
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/lights") {
      const lights = await readLights();
      sendJson(res, 200, {
        lights
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/lights") {
      const cookies = parseCookies(req);
      if (cookies[GLOBE_LIGHT_COOKIE] === "1") {
        jsonError(res, 429, "A light was already placed recently from this browser");
        return;
      }

      const clientIp = getClientIp(req);
      if (await hasRecentLightClaim(clientIp)) {
        jsonError(res, 429, "This IP address already placed a light in the last 24 hours");
        return;
      }

      const body = await readJsonBody(req);
      const lat = clampLatitude(body.lat);
      const lng = clampLongitude(body.lng);
      const now = Date.now();
      const nextLight = {
        id: crypto.randomUUID(),
        lat,
        lng,
        countryCode: sanitizeString(body.countryCode),
        countryName: sanitizeString(body.countryName),
        regionCode: sanitizeString(body.regionCode),
        regionName: sanitizeString(body.regionName),
        createdAt: now
      };

      const lights = await readLights();
      lights.push(nextLight);
      const nextLights = lights.slice(-MAX_STORED_LIGHTS);
      await writeLights(nextLights);
      await registerLightClaim(clientIp);

      setCookie(res, GLOBE_LIGHT_COOKIE, "1", {
        maxAge: GLOBE_LIGHT_CLAIM_WINDOW_MS / 1000,
        httpOnly: true,
        path: "/",
        sameSite: "Lax"
      });

      sendJson(res, 201, {
        light: nextLight,
        lights: nextLights
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      const body = await readJsonBody(req);
      const password = sanitizeString(body.password);
      const data = await readData();
      const attemptedHash = hashPassword(password, data.admin.salt);

      if (attemptedHash !== data.admin.passwordHash) {
        jsonError(res, 401, "Invalid password");
        return;
      }

      const token = createSession(data);
      setCookie(res, SESSION_COOKIE, token, {
        maxAge: 60 * 60 * 12,
        httpOnly: true,
        path: "/",
        sameSite: "Lax"
      });

      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      const session = getSession(req);
      if (session) {
        sessions.delete(session.token);
      }
      clearCookie(res, SESSION_COOKIE);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/site") {
      const session = requireAdmin(req, res);
      if (!session) {
        return;
      }

      const data = await readData();
      sendJson(res, 200, {
        username: data.admin.username,
        site: publicSitePayload(data.site)
      });
      return;
    }

    if (req.method === "PUT" && pathname === "/api/admin/site") {
      const session = requireAdmin(req, res);
      if (!session) {
        return;
      }

      const body = await readJsonBody(req);
      const nextData = await updateData((data) => {
        data.site = normalizeSitePayload(body, data.site);
        return data;
      });

      sendJson(res, 200, { site: publicSitePayload(nextData.site) });
      return;
    }

    if (req.method === "PUT" && pathname === "/api/admin/password") {
      const session = requireAdmin(req, res);
      if (!session) {
        return;
      }

      const body = await readJsonBody(req);
      const currentPassword = sanitizeString(body.currentPassword);
      const newPassword = sanitizeString(body.newPassword);

      if (newPassword.length < 8) {
        jsonError(res, 400, "New password must be at least 8 characters");
        return;
      }

      await updateData((data) => {
        const attemptedHash = hashPassword(currentPassword, data.admin.salt);
        if (attemptedHash !== data.admin.passwordHash) {
          throw new Error("Current password is incorrect");
        }

        const nextSalt = crypto.randomBytes(16).toString("hex");
        data.admin.salt = nextSalt;
        data.admin.passwordHash = hashPassword(newPassword, nextSalt);
        return data;
      });

      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/upload") {
      const session = requireAdmin(req, res);
      if (!session) {
        return;
      }

      const body = await readJsonBody(req);
      const imageDataUrl = sanitizeString(body.imageDataUrl);
      const filename = sanitizeString(body.filename, "image");

      if (!imageDataUrl) {
        jsonError(res, 400, "Image data is required");
        return;
      }

      const src = await saveImageFromDataUrl(imageDataUrl, filename);
      sendJson(res, 200, { src });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/gallery") {
      const session = requireAdmin(req, res);
      if (!session) {
        return;
      }

      const body = await readJsonBody(req);
      const src = sanitizeString(body.src);
      const alt = sanitizeString(body.alt);
      const title = sanitizeString(body.title);

      if (!src) {
        jsonError(res, 400, "Image source is required");
        return;
      }

      const nextData = await updateData((data) => {
        data.site.gallery.push({
          id: crypto.randomUUID(),
          src,
          alt,
          title
        });
        return data;
      });

      sendJson(res, 200, { gallery: nextData.site.gallery });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/gallery/reorder") {
      const session = requireAdmin(req, res);
      if (!session) {
        return;
      }

      const body = await readJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map((item) => sanitizeString(item)) : [];

      const nextData = await updateData((data) => {
        const map = new Map(data.site.gallery.map((item) => [item.id, item]));
        const reordered = ids.map((id) => map.get(id)).filter(Boolean);
        const leftovers = data.site.gallery.filter((item) => !ids.includes(item.id));
        data.site.gallery = reordered.concat(leftovers);
        return data;
      });

      sendJson(res, 200, { gallery: nextData.site.gallery });
      return;
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/admin/gallery/")) {
      const session = requireAdmin(req, res);
      if (!session) {
        return;
      }

      const id = decodeURIComponent(pathname.replace("/api/admin/gallery/", ""));
      let removedSrc = "";
      const nextData = await updateData((data) => {
        const nextGallery = [];
        for (const item of data.site.gallery) {
          if (item.id === id) {
            removedSrc = item.src;
          } else {
            nextGallery.push(item);
          }
        }
        data.site.gallery = nextGallery;
        return data;
      });

      await deleteLocalUpload(removedSrc);
      sendJson(res, 200, { gallery: nextData.site.gallery });
      return;
    }

    if (req.method === "GET" && pathname === "/") {
      await serveFile(res, path.join(PUBLIC_DIR, "index.html"));
      return;
    }

    if (req.method === "GET" && pathname === "/admin") {
      await serveFile(res, path.join(PUBLIC_DIR, "admin.html"));
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/uploads/")) {
      const filePath = safeJoin(UPLOADS_DIR, pathname.replace("/uploads/", ""));
      if (!filePath) {
        sendText(res, 404, "Not found");
        return;
      }

      await serveFile(res, filePath);
      return;
    }

    if (req.method === "GET") {
      const publicPath = pathname === "/" ? "index.html" : pathname.slice(1);
      const fromPublic = safeJoin(PUBLIC_DIR, publicPath);
      if (fromPublic && fs.existsSync(fromPublic) && fs.statSync(fromPublic).isFile()) {
        await serveFile(res, fromPublic);
        return;
      }

      const fromRoot = safeJoin(ROOT_DIR, pathname.slice(1));
      if (
        fromRoot &&
        fs.existsSync(fromRoot) &&
        fs.statSync(fromRoot).isFile() &&
        [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(path.extname(fromRoot).toLowerCase())
      ) {
        await serveFile(res, fromRoot);
        return;
      }
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    const message = error && error.message ? error.message : "Unexpected server error";
    const statusCode = /incorrect|invalid|required|large|unsupported/i.test(message) ? 400 : 500;
    jsonError(res, statusCode, message);
  }
});

ensureStorage()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Pass The Light running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
