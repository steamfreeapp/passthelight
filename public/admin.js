const loginCard = document.getElementById("login-card");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("login-form");
const loginPassword = document.getElementById("login-password");
const loginMessage = document.getElementById("login-message");
const logoutButton = document.getElementById("logout-button");
const saveSiteButton = document.getElementById("save-site-button");
const siteMessage = document.getElementById("site-message");
const galleryMessage = document.getElementById("gallery-message");
const passwordMessage = document.getElementById("password-message");
const heroPreview = document.getElementById("hero-preview");
const signaturePreview = document.getElementById("signature-preview");
const galleryAdminGrid = document.getElementById("gallery-admin-grid");
const globalAlert = document.getElementById("global-alert");

const fields = {
  heroTitle: document.getElementById("hero-title-input"),
  heroQuote: document.getElementById("hero-quote-input"),
  heroImage: document.getElementById("hero-image-input"),
  heroFile: document.getElementById("hero-file-input"),
  instructions: document.getElementById("instructions-input"),
  counterValue: document.getElementById("counter-value-input"),
  counterLabel: document.getElementById("counter-label-input"),
  counterDescription: document.getElementById("counter-description-input"),
  signatureText: document.getElementById("signature-text-input"),
  signatureImage: document.getElementById("signature-image-input"),
  signatureFile: document.getElementById("signature-file-input"),
  themeBackground: document.getElementById("theme-background-input"),
  themeAccent: document.getElementById("theme-accent-input"),
  themeSoft: document.getElementById("theme-soft-input"),
  themeCounter: document.getElementById("theme-counter-input")
};

const galleryFields = {
  title: document.getElementById("gallery-title-input"),
  alt: document.getElementById("gallery-alt-input"),
  url: document.getElementById("gallery-url-input"),
  file: document.getElementById("gallery-file-input")
};

let adminState = {
  site: null
};
let alertTimer = null;

function showGlobalAlert(message, type = "success") {
  globalAlert.textContent = message;
  globalAlert.className = `global-alert ${type}`;

  if (alertTimer) {
    window.clearTimeout(alertTimer);
  }

  alertTimer = window.setTimeout(() => {
    globalAlert.className = "global-alert hidden";
  }, 2600);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function boot() {
  try {
    const payload = await api("/api/admin/site", { method: "GET" });
    adminState.site = payload.site;
    showDashboard();
    fillForm();
  } catch {
    showLogin();
  }
}

function showLogin() {
  loginCard.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

function showDashboard() {
  loginCard.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

function fillForm() {
  const site = adminState.site;
  fields.heroTitle.value = site.hero.title;
  fields.heroQuote.value = site.hero.quote;
  fields.heroImage.value = site.hero.image || "";
  fields.instructions.value = site.instructions.join("\n");
  fields.counterValue.value = site.counter.value;
  fields.counterLabel.value = site.counter.label;
  fields.counterDescription.value = site.counter.description;
  fields.signatureText.value = site.signature.text;
  fields.signatureImage.value = site.signature.image;
  fields.themeBackground.value = site.theme.background;
  fields.themeAccent.value = site.theme.accent;
  fields.themeSoft.value = site.theme.soft;
  fields.themeCounter.value = site.theme.counterBackground;
  renderImagePreview(fields.heroImage.value, heroPreview);
  renderImagePreview(fields.signatureImage.value, signaturePreview);
  renderGalleryManager();
}

function renderImagePreview(src, preview) {
  if (src) {
    preview.src = src;
    preview.classList.remove("hidden");
  } else {
    preview.removeAttribute("src");
    preview.classList.add("hidden");
  }
}

function renderGalleryManager() {
  galleryAdminGrid.innerHTML = "";

  const gallery = adminState.site.gallery || [];
  if (!gallery.length) {
    const empty = document.createElement("p");
    empty.className = "helper-text";
    empty.textContent = "No gallery images yet.";
    galleryAdminGrid.appendChild(empty);
    return;
  }

  gallery.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "gallery-admin-card";

    const img = document.createElement("img");
    img.src = item.src;
    img.alt = item.alt || item.title || "Gallery image";

    const meta = document.createElement("div");
    meta.className = "gallery-admin-meta";

    const title = document.createElement("strong");
    title.textContent = item.title || "Untitled image";

    const source = document.createElement("span");
    source.textContent = item.alt || item.src;

    meta.append(title, source);

    const actions = document.createElement("div");
    actions.className = "gallery-admin-actions";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "ghost-button";
    up.textContent = "Up";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveGalleryItem(index, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "ghost-button";
    down.textContent = "Down";
    down.disabled = index === gallery.length - 1;
    down.addEventListener("click", () => moveGalleryItem(index, 1));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteGalleryItem(item.id));

    actions.append(up, down, remove);
    card.append(img, meta, actions);
    galleryAdminGrid.appendChild(card);
  });
}

async function uploadFile(file) {
  const dataUrl = await fileToDataUrl(file);
  const payload = await api("/api/admin/upload", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      imageDataUrl: dataUrl
    })
  });

  return payload.src;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: loginPassword.value
      })
    });
    loginPassword.value = "";
    await boot();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/admin/logout", {
    method: "POST",
    body: JSON.stringify({})
  });
  showLogin();
});

saveSiteButton.addEventListener("click", async () => {
  siteMessage.textContent = "";

  try {
    const payload = await api("/api/admin/site", {
      method: "PUT",
      body: JSON.stringify({
        hero: {
          title: fields.heroTitle.value,
          quote: fields.heroQuote.value,
          image: fields.heroImage.value
        },
        instructions: fields.instructions.value,
        counter: {
          value: Number(fields.counterValue.value),
          label: fields.counterLabel.value,
          description: fields.counterDescription.value
        },
        signature: {
          text: fields.signatureText.value,
          image: fields.signatureImage.value
        },
        theme: {
          background: fields.themeBackground.value,
          accent: fields.themeAccent.value,
          soft: fields.themeSoft.value,
          counterBackground: fields.themeCounter.value
        }
      })
    });

    adminState.site = payload.site;
    fillForm();
    siteMessage.textContent = "Settings saved.";
    showGlobalAlert("Settings saved.");
  } catch (error) {
    siteMessage.textContent = error.message;
    showGlobalAlert(error.message, "error");
  }
});

fields.heroFile.addEventListener("change", async () => {
  const file = fields.heroFile.files[0];
  if (!file) {
    return;
  }

  siteMessage.textContent = "Uploading hero image...";

  try {
    const src = await uploadFile(file);
    fields.heroImage.value = src;
    renderImagePreview(fields.heroImage.value, heroPreview);
    siteMessage.textContent = "Hero image uploaded. Save settings to publish it.";
    showGlobalAlert("Hero image uploaded.");
  } catch (error) {
    siteMessage.textContent = error.message;
    showGlobalAlert(error.message, "error");
  } finally {
    fields.heroFile.value = "";
  }
});

fields.signatureFile.addEventListener("change", async () => {
  const file = fields.signatureFile.files[0];
  if (!file) {
    return;
  }

  siteMessage.textContent = "Uploading signature...";

  try {
    const src = await uploadFile(file);
    fields.signatureImage.value = src;
    renderImagePreview(fields.signatureImage.value, signaturePreview);
    siteMessage.textContent = "Signature uploaded. Save settings to publish it.";
    showGlobalAlert("Signature uploaded.");
  } catch (error) {
    siteMessage.textContent = error.message;
    showGlobalAlert(error.message, "error");
  } finally {
    fields.signatureFile.value = "";
  }
});

document.getElementById("gallery-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  galleryMessage.textContent = "";

  try {
    let src = galleryFields.url.value.trim();
    const file = galleryFields.file.files[0];
    if (!src && file) {
      src = await uploadFile(file);
    }

    if (!src) {
      throw new Error("Add an image URL or upload a file");
    }

    const payload = await api("/api/admin/gallery", {
      method: "POST",
      body: JSON.stringify({
        src,
        title: galleryFields.title.value,
        alt: galleryFields.alt.value
      })
    });

    adminState.site.gallery = payload.gallery;
    renderGalleryManager();
    galleryMessage.textContent = "Image added.";
    showGlobalAlert("Image added.");
    galleryFields.title.value = "";
    galleryFields.alt.value = "";
    galleryFields.url.value = "";
    galleryFields.file.value = "";
  } catch (error) {
    galleryMessage.textContent = error.message;
    showGlobalAlert(error.message, "error");
  }
});

async function moveGalleryItem(index, direction) {
  const gallery = [...adminState.site.gallery];
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= gallery.length) {
    return;
  }

  [gallery[index], gallery[targetIndex]] = [gallery[targetIndex], gallery[index]];

  try {
    const payload = await api("/api/admin/gallery/reorder", {
      method: "POST",
      body: JSON.stringify({
        ids: gallery.map((item) => item.id)
      })
    });

    adminState.site.gallery = payload.gallery;
    renderGalleryManager();
    showGlobalAlert("Gallery order updated.");
  } catch (error) {
    galleryMessage.textContent = error.message;
    showGlobalAlert(error.message, "error");
  }
}

async function deleteGalleryItem(id) {
  try {
    const payload = await api(`/api/admin/gallery/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    adminState.site.gallery = payload.gallery;
    renderGalleryManager();
    galleryMessage.textContent = "Image removed.";
    showGlobalAlert("Image removed.");
  } catch (error) {
    galleryMessage.textContent = error.message;
    showGlobalAlert(error.message, "error");
  }
}

document.getElementById("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordMessage.textContent = "";

  try {
    await api("/api/admin/password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: document.getElementById("current-password-input").value,
        newPassword: document.getElementById("new-password-input").value
      })
    });

    document.getElementById("current-password-input").value = "";
    document.getElementById("new-password-input").value = "";
    passwordMessage.textContent = "Password updated.";
    showGlobalAlert("Password updated.");
  } catch (error) {
    passwordMessage.textContent = error.message;
    showGlobalAlert(error.message, "error");
  }
});

fields.heroImage.addEventListener("input", () => {
  renderImagePreview(fields.heroImage.value, heroPreview);
});

fields.signatureImage.addEventListener("input", () => {
  renderImagePreview(fields.signatureImage.value, signaturePreview);
});

boot();
