const COUNTRY_BORDERS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
const COUNTRY_METADATA_URL = "https://cdn.jsdelivr.net/npm/world-countries@5.1.0/dist/countries.json";
const US_STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const STATE_DETAIL_ZOOM = 1.16;

const state = {
  site: null,
  lights: [],
  geo: {
    countries: [],
    usStates: [],
    ready: false
  }
};

const heroCard = document.getElementById("hero-card");
const heroImage = document.getElementById("hero-image");
const heroTitle = document.getElementById("hero-title");
const heroQuote = document.getElementById("hero-quote");
const instructionsList = document.getElementById("instructions-list");
const counterValue = document.getElementById("counter-value");
const counterLabel = document.getElementById("counter-label");
const counterDescription = document.getElementById("counter-description");
const counterButton = document.getElementById("counter-button");
const counterStatus = document.getElementById("counter-status");
const gallerySection = document.getElementById("gallery-section");
const galleryGrid = document.getElementById("gallery-grid");
const signatureText = document.getElementById("signature-text");
const signatureImage = document.getElementById("signature-image");
const globeCanvas = document.getElementById("globe-canvas");
const globeSelected = document.getElementById("globe-selected");
const globeStatus = document.getElementById("globe-status");
const globeSubmitButton = document.getElementById("globe-submit-button");

const globeState = {
  yaw: -0.52,
  pitch: 0.18,
  zoom: 1,
  dragging: false,
  dragMoved: false,
  lastX: 0,
  lastY: 0,
  selected: null,
  animationFrame: 0,
  pulseTime: 0
};

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function radToDeg(value) {
  return (value * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLongitude(value) {
  let result = value;
  while (result < -180) {
    result += 360;
  }
  while (result > 180) {
    result -= 360;
  }
  return result;
}

function padCountryNumber(value) {
  return String(value || "").padStart(3, "0");
}

function isDetailedZoom() {
  return globeState.zoom >= STATE_DETAIL_ZOOM;
}

function formatSelection(selection) {
  if (!selection) {
    return "No location selected yet.";
  }

  if (selection.regionName && selection.countryName) {
    return `Selected: ${selection.regionName}, ${selection.countryName}`;
  }

  if (selection.countryName) {
    return `Selected: ${selection.countryName}`;
  }

  const ns = selection.lat >= 0 ? "N" : "S";
  const ew = selection.lng >= 0 ? "E" : "W";
  return `Selected: ${Math.abs(selection.lat).toFixed(2)} deg ${ns}, ${Math.abs(selection.lng).toFixed(2)} deg ${ew}`;
}

function projectPoint(lat, lng, radius) {
  const latRad = degToRad(lat);
  const lngRad = degToRad(lng);

  const cosLat = Math.cos(latRad);
  const baseX = cosLat * Math.sin(lngRad);
  const baseY = Math.sin(latRad);
  const baseZ = cosLat * Math.cos(lngRad);

  const cosYaw = Math.cos(globeState.yaw);
  const sinYaw = Math.sin(globeState.yaw);
  const x1 = baseX * cosYaw + baseZ * sinYaw;
  const z1 = -baseX * sinYaw + baseZ * cosYaw;

  const cosPitch = Math.cos(globeState.pitch);
  const sinPitch = Math.sin(globeState.pitch);
  const y2 = baseY * cosPitch - z1 * sinPitch;
  const z2 = baseY * sinPitch + z1 * cosPitch;

  return {
    x: x1 * radius,
    y: -y2 * radius,
    z: z2
  };
}

function inverseProject(canvasX, canvasY, radius) {
  const nx = canvasX / radius;
  const ny = canvasY / radius;
  const distance = (nx * nx) + (ny * ny);
  if (distance > 1) {
    return null;
  }

  const z = Math.sqrt(1 - distance);
  const yRot = -ny;
  const xRot = nx;

  const cosPitch = Math.cos(-globeState.pitch);
  const sinPitch = Math.sin(-globeState.pitch);
  const y1 = yRot * cosPitch - z * sinPitch;
  const z1 = yRot * sinPitch + z * cosPitch;

  const cosYaw = Math.cos(-globeState.yaw);
  const sinYaw = Math.sin(-globeState.yaw);
  const x0 = xRot * cosYaw + z1 * sinYaw;
  const z0 = -xRot * sinYaw + z1 * cosYaw;

  return {
    lat: Math.round(radToDeg(Math.asin(clamp(y1, -1, 1))) * 100) / 100,
    lng: Math.round(normalizeLongitude(radToDeg(Math.atan2(x0, z0))) * 100) / 100
  };
}

function getCanvasMetrics() {
  const size = Math.min(globeCanvas.clientWidth || globeCanvas.width, 540);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  globeCanvas.width = Math.round(size * pixelRatio);
  globeCanvas.height = Math.round(size * pixelRatio);

  const context = globeCanvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  return {
    context,
    width: size,
    height: size,
    centerX: size / 2,
    centerY: size / 2,
    radius: size * 0.34 * globeState.zoom
  };
}

function ensureFeaturePaths(feature) {
  if (feature._paths) {
    return feature._paths;
  }

  const geometry = feature.geometry;
  const paths = [];

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => {
      paths.push(ring);
    });
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => {
        paths.push(ring);
      });
    });
  }

  feature._paths = paths;
  return paths;
}

function drawFeatureLines(context, feature, centerX, centerY, radius, color, width) {
  const paths = ensureFeaturePaths(feature);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;

  paths.forEach((ring) => {
    let started = false;
    context.beginPath();

    ring.forEach(([lng, lat]) => {
      const point = projectPoint(lat, lng, radius);
      if (point.z <= 0.02) {
        started = false;
        return;
      }

      const x = centerX + point.x;
      const y = centerY + point.y;

      if (!started) {
        context.moveTo(x, y);
        started = true;
      } else {
        context.lineTo(x, y);
      }
    });

    context.stroke();
  });

  context.restore();
}

function drawFeatureFill(context, feature, centerX, centerY, radius, fillStyle) {
  const paths = ensureFeaturePaths(feature);
  context.save();
  context.fillStyle = fillStyle;

  paths.forEach((ring) => {
    const visible = ring
      .map(([lng, lat]) => projectPoint(lat, lng, radius))
      .filter((point) => point.z > 0.02);

    if (visible.length < 3) {
      return;
    }

    context.beginPath();
    visible.forEach((point, index) => {
      const x = centerX + point.x;
      const y = centerY + point.y;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.closePath();
    context.fill();
  });

  context.restore();
}

function drawGrid(context, centerX, centerY, radius) {
  context.save();
  context.strokeStyle = "rgba(222, 188, 92, 0.3)";
  context.lineWidth = 1;

  for (let lat = -60; lat <= 60; lat += 30) {
    let started = false;
    context.beginPath();
    for (let lng = -180; lng <= 180; lng += 6) {
      const point = projectPoint(lat, lng, radius);
      if (point.z <= 0) {
        started = false;
        continue;
      }

      const x = centerX + point.x;
      const y = centerY + point.y;
      if (!started) {
        context.moveTo(x, y);
        started = true;
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
  }

  for (let lng = -150; lng <= 180; lng += 30) {
    let started = false;
    context.beginPath();
    for (let lat = -90; lat <= 90; lat += 4) {
      const point = projectPoint(lat, lng, radius);
      if (point.z <= 0) {
        started = false;
        continue;
      }

      const x = centerX + point.x;
      const y = centerY + point.y;
      if (!started) {
        context.moveTo(x, y);
        started = true;
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
  }

  context.restore();
}

function drawAtmosphereSparkles(context, centerX, centerY, radius) {
  const sparkleSeed = [
    [-1.34, -0.26, 2.2],
    [-1.24, 0.02, 1.4],
    [-1.18, 0.11, 1.1],
    [-1.08, -0.08, 1.5],
    [-0.98, 0.14, 0.95],
    [0.98, -0.02, 1.4],
    [1.08, 0.09, 1.05],
    [1.18, -0.12, 1.3],
    [1.28, 0.02, 2],
    [1.38, -0.2, 1.15],
    [1.22, 0.18, 0.9],
    [-1.26, 0.22, 0.88]
  ];

  context.save();

  sparkleSeed.forEach(([xFactor, yFactor, size]) => {
    const x = centerX + (radius * xFactor);
    const y = centerY + (radius * yFactor);
    const glow = context.createRadialGradient(x, y, 0, x, y, size * 8);
    glow.addColorStop(0, "rgba(255, 245, 200, 0.95)");
    glow.addColorStop(0.35, "rgba(226, 191, 92, 0.55)");
    glow.addColorStop(1, "rgba(226, 191, 92, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, size * 8, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(198, 151, 42, 0.78)";
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
  });

  context.restore();
}

function drawCountryBorders(context, centerX, centerY, radius) {
  if (!state.geo.ready) {
    return;
  }

  const selectedCode = globeState.selected && globeState.selected.countryCode;
  const baseBorderWidth = Math.min(1.4, 0.78 + (globeState.zoom * 0.08));
  const selectedBorderWidth = Math.min(2.1, 1.4 + (globeState.zoom * 0.12));
  const goldFill = context.createLinearGradient(
    centerX - radius,
    centerY - radius,
    centerX + (radius * 0.75),
    centerY + radius
  );
  goldFill.addColorStop(0, "rgba(255, 252, 232, 0.99)");
  goldFill.addColorStop(0.14, "rgba(252, 235, 175, 0.99)");
  goldFill.addColorStop(0.33, "rgba(231, 196, 101, 0.98)");
  goldFill.addColorStop(0.58, "rgba(185, 132, 34, 0.96)");
  goldFill.addColorStop(0.8, "rgba(128, 84, 12, 0.94)");
  goldFill.addColorStop(1, "rgba(247, 223, 142, 0.98)");

  const selectedFill = context.createLinearGradient(
    centerX - radius,
    centerY - radius,
    centerX + radius,
    centerY + radius
  );
  selectedFill.addColorStop(0, "rgba(255, 255, 244, 1)");
  selectedFill.addColorStop(0.26, "rgba(255, 240, 191, 1)");
  selectedFill.addColorStop(0.52, "rgba(240, 201, 100, 0.99)");
  selectedFill.addColorStop(0.82, "rgba(189, 134, 29, 0.98)");
  selectedFill.addColorStop(1, "rgba(255, 246, 211, 0.99)");

  state.geo.countries.forEach((feature) => {
    const isSelected = selectedCode && selectedCode === feature.properties.countryCode;
    const fill = isSelected ? selectedFill : goldFill;
    drawFeatureFill(context, feature, centerX, centerY, radius, fill);
  });

  state.geo.countries.forEach((feature) => {
    const isSelected = selectedCode && selectedCode === feature.properties.countryCode;
    drawFeatureLines(
      context,
      feature,
      centerX,
      centerY,
      radius,
      isSelected ? "rgba(119, 68, 4, 0.98)" : "rgba(122, 77, 10, 0.92)",
      isSelected ? selectedBorderWidth : baseBorderWidth
    );
  });
}

function drawStateBorders(context, centerX, centerY, radius) {
  if (!state.geo.ready || !isDetailedZoom()) {
    return;
  }

  const stateBorderWidth = Math.min(1.4, 0.75 + ((globeState.zoom - 1) * 0.12));
  const selectedStateWidth = Math.min(1.9, 1.1 + ((globeState.zoom - 1) * 0.18));

  state.geo.usStates.forEach((feature) => {
    const isSelected = globeState.selected && globeState.selected.regionCode && globeState.selected.regionCode === feature.id;
    drawFeatureLines(
      context,
      feature,
      centerX,
      centerY,
      radius,
      isSelected ? "rgba(255, 255, 255, 0.62)" : "rgba(255, 246, 214, 0.26)",
      isSelected ? selectedStateWidth : stateBorderWidth
    );
  });
}

function drawLights(context, centerX, centerY, radius) {
  const pulse = 0.88 + (Math.sin(globeState.pulseTime / 520) * 0.12);

  state.lights.forEach((light) => {
    const point = projectPoint(light.lat, light.lng, radius);
    if (point.z <= 0) {
      return;
    }

    const x = centerX + point.x;
    const y = centerY + point.y;
    const halo = 4 + (point.z * 4 * pulse);

    const glow = context.createRadialGradient(x, y, 0, x, y, halo * 3.2);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    glow.addColorStop(0.35, "rgba(255, 246, 204, 0.72)");
    glow.addColorStop(1, "rgba(255, 246, 204, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, halo * 3.2, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(x, y, 1.6 + (point.z * 1.8), 0, Math.PI * 2);
    context.fill();
  });

  if (globeState.selected) {
    const point = projectPoint(globeState.selected.lat, globeState.selected.lng, radius);
    if (point.z > 0) {
      const x = centerX + point.x;
      const y = centerY + point.y;
      context.strokeStyle = "rgba(255, 255, 255, 0.95)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x, y, 9, 0, Math.PI * 2);
      context.stroke();
    }
  }
}

function renderGlobe() {
  if (!globeCanvas) {
    return;
  }

  const { context, width, centerX, centerY, radius } = getCanvasMetrics();
  context.clearRect(0, 0, width, width);

  drawAtmosphereSparkles(context, centerX, centerY, radius);

  const outerGlow = context.createRadialGradient(centerX, centerY, radius * 0.25, centerX, centerY, radius * 1.55);
  outerGlow.addColorStop(0, "rgba(241, 213, 116, 0.16)");
  outerGlow.addColorStop(0.42, "rgba(183, 137, 26, 0.1)");
  outerGlow.addColorStop(0.72, "rgba(86, 63, 12, 0.08)");
  outerGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = outerGlow;
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.55, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.clip();

  const sphere = context.createRadialGradient(
    centerX - (radius * 0.35),
    centerY - (radius * 0.42),
    radius * 0.18,
    centerX,
    centerY,
    radius
  );
  sphere.addColorStop(0, "rgba(91, 91, 88, 0.92)");
  sphere.addColorStop(0.12, "rgba(37, 40, 46, 0.98)");
  sphere.addColorStop(0.42, "rgba(14, 16, 21, 0.995)");
  sphere.addColorStop(0.8, "rgba(2, 3, 6, 1)");
  sphere.addColorStop(1, "#010103");
  context.fillStyle = sphere;
  context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

  drawGrid(context, centerX, centerY, radius);
  drawCountryBorders(context, centerX, centerY, radius);
  drawStateBorders(context, centerX, centerY, radius);
  drawLights(context, centerX, centerY, radius);

  const landShine = context.createRadialGradient(
    centerX - (radius * 0.24),
    centerY - (radius * 0.34),
    radius * 0.05,
    centerX,
    centerY,
    radius * 1.2
  );
  landShine.addColorStop(0, "rgba(255, 253, 238, 0.38)");
  landShine.addColorStop(0.2, "rgba(255, 244, 203, 0.2)");
  landShine.addColorStop(0.42, "rgba(247, 224, 147, 0.08)");
  landShine.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = landShine;
  context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

  const highlight = context.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
  highlight.addColorStop(0, "rgba(255, 255, 255, 0.42)");
  highlight.addColorStop(0.18, "rgba(255, 247, 223, 0.22)");
  highlight.addColorStop(0.34, "rgba(255, 232, 161, 0.11)");
  highlight.addColorStop(0.6, "rgba(255, 255, 255, 0)");
  highlight.addColorStop(1, "rgba(255, 214, 117, 0.16)");
  context.fillStyle = highlight;
  context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);

  context.restore();

  context.strokeStyle = "rgba(246, 224, 141, 0.42)";
  context.lineWidth = 1.2;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();
}

function queueGlobeRender() {
  if (globeState.animationFrame) {
    return;
  }

  globeState.animationFrame = window.requestAnimationFrame(() => {
    globeState.animationFrame = 0;
    globeState.pulseTime = Date.now();
    renderGlobe();
  });
}

function updateSelectedText() {
  globeSelected.textContent = formatSelection(globeState.selected);
  globeSubmitButton.disabled = !globeState.selected;
}

function resolveSelectionMetadata(lat, lng) {
  const selection = {
    lat,
    lng,
    countryCode: "",
    countryName: "",
    regionCode: "",
    regionName: ""
  };

  if (!state.geo.ready || typeof d3 === "undefined" || typeof d3.geoContains !== "function") {
    return selection;
  }

  const point = [lng, lat];
  const country = state.geo.countries.find((feature) => d3.geoContains(feature, point));
  if (!country) {
    return selection;
  }

  selection.countryCode = country.properties.countryCode || "";
  selection.countryName = country.properties.countryName || country.properties.name || "";

  if (selection.countryCode === "US" && isDetailedZoom()) {
    const region = state.geo.usStates.find((feature) => d3.geoContains(feature, point));
    if (region) {
      selection.regionCode = String(region.id || "");
      selection.regionName = region.properties.name || "";
    }
  }

  return selection;
}

async function loadGeoData() {
  if (typeof topojson === "undefined") {
    throw new Error("Detailed map library failed to load");
  }

  const [countryTopology, countryMetadata, usTopology] = await Promise.all([
    fetch(COUNTRY_BORDERS_URL).then((response) => {
      if (!response.ok) {
        throw new Error("Unable to load country border data");
      }
      return response.json();
    }),
    fetch(COUNTRY_METADATA_URL).then((response) => {
      if (!response.ok) {
        throw new Error("Unable to load country metadata");
      }
      return response.json();
    }),
    fetch(US_STATES_URL).then((response) => {
      if (!response.ok) {
        throw new Error("Unable to load U.S. state data");
      }
      return response.json();
    })
  ]);

  const countryLookup = new Map(
    countryMetadata.map((entry) => [
      padCountryNumber(entry.ccn3),
      {
        countryCode: entry.cca2 || "",
        countryName: (entry.name && entry.name.common) || ""
      }
    ])
  );

  state.geo.countries = topojson
    .feature(countryTopology, countryTopology.objects.countries)
    .features
    .map((feature) => {
      const meta = countryLookup.get(padCountryNumber(feature.id)) || {};
      feature.properties = {
        ...feature.properties,
        countryCode: meta.countryCode || "",
        countryName: meta.countryName || ""
      };
      return feature;
    });

  state.geo.usStates = topojson.feature(usTopology, usTopology.objects.states).features;
  state.geo.ready = true;
  queueGlobeRender();
}

async function loadSite() {
  const response = await fetch("/api/site");
  if (!response.ok) {
    throw new Error("Failed to load site");
  }

  state.site = await response.json();
  renderSite();
}

async function loadLights() {
  const response = await fetch("/api/lights");
  if (!response.ok) {
    throw new Error("Failed to load globe lights");
  }

  const payload = await response.json();
  state.lights = Array.isArray(payload.lights) ? payload.lights : [];
  queueGlobeRender();
}

function renderSite() {
  const site = state.site;
  if (!site) {
    return;
  }

  document.documentElement.style.setProperty("--background", site.theme.background);
  document.documentElement.style.setProperty("--accent", site.theme.accent);
  document.documentElement.style.setProperty("--soft", site.theme.soft);
  document.documentElement.style.setProperty("--counter-background", site.theme.counterBackground);

  renderHero(site.hero);

  instructionsList.innerHTML = "";
  site.instructions.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    instructionsList.appendChild(li);
  });

  counterValue.textContent = Number(site.counter.value).toLocaleString("en-US");
  counterLabel.textContent = site.counter.label;
  counterDescription.textContent = site.counter.description;

  renderGallery(site.gallery || []);
  renderSignature(site.signature);
}

function renderHero(hero) {
  const image = hero.image || "";
  heroTitle.textContent = hero.title;
  heroQuote.textContent = hero.quote;

  if (image) {
    heroImage.src = image;
    heroImage.classList.remove("hidden");
    heroCard.classList.add("hero-card-has-image");
  } else {
    heroImage.removeAttribute("src");
    heroImage.classList.add("hidden");
    heroCard.classList.remove("hero-card-has-image");
  }
}

function renderGallery(gallery) {
  galleryGrid.innerHTML = "";

  if (!gallery.length) {
    gallerySection.classList.add("gallery-empty");
    for (let index = 0; index < 10; index += 1) {
      const placeholder = document.createElement("div");
      placeholder.className = "gallery-item placeholder";
      galleryGrid.appendChild(placeholder);
    }
    return;
  }

  gallerySection.classList.remove("gallery-empty");
  gallery.slice(0, 10).forEach((item) => {
    const frame = document.createElement("figure");
    frame.className = "gallery-item";

    const img = document.createElement("img");
    img.src = item.src;
    img.alt = item.alt || item.title || "Gallery image";

    frame.appendChild(img);
    galleryGrid.appendChild(frame);
  });
}

function renderSignature(signature) {
  if (signature.image) {
    signatureImage.src = signature.image;
    signatureImage.classList.remove("hidden");
    signatureText.classList.add("hidden");
  } else {
    signatureImage.classList.add("hidden");
    signatureText.classList.remove("hidden");
    signatureText.textContent = signature.text || "Pass The Light";
  }
}

async function incrementCounter() {
  counterButton.disabled = true;
  counterStatus.textContent = "Claiming light...";

  try {
    const response = await fetch("/api/counter/increment", {
      method: "POST"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to update counter");
    }

    counterValue.textContent = Number(payload.value).toLocaleString("en-US");
    counterStatus.textContent = "Light accepted.";
  } catch (error) {
    counterStatus.textContent = error.message;
    counterButton.disabled = false;
  }
}

async function placeSelectedLight() {
  if (!globeState.selected) {
    return;
  }

  globeSubmitButton.disabled = true;
  globeStatus.textContent = "Placing your light...";

  try {
    const response = await fetch("/api/lights", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(globeState.selected)
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to place light");
    }

    state.lights = Array.isArray(payload.lights) ? payload.lights : state.lights;
    const placedLabel = globeState.selected.regionName || globeState.selected.countryName || "the globe";
    globeState.selected = null;
    updateSelectedText();
    globeStatus.textContent = `Your light was added in ${placedLabel}.`;
    queueGlobeRender();
  } catch (error) {
    globeStatus.textContent = error.message;
    updateSelectedText();
  }
}

function getPointerPosition(event) {
  const rect = globeCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    size: rect.width
  };
}

function handleGlobePointerDown(event) {
  const pointer = getPointerPosition(event);
  globeState.dragging = true;
  globeState.dragMoved = false;
  globeState.lastX = pointer.x;
  globeState.lastY = pointer.y;
  globeCanvas.setPointerCapture(event.pointerId);
}

function handleGlobePointerMove(event) {
  if (!globeState.dragging) {
    return;
  }

  const pointer = getPointerPosition(event);
  const dx = pointer.x - globeState.lastX;
  const dy = pointer.y - globeState.lastY;

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    globeState.dragMoved = true;
  }

  globeState.yaw += dx * 0.01;
  globeState.pitch = clamp(globeState.pitch + (dy * 0.01), -1.15, 1.15);
  globeState.lastX = pointer.x;
  globeState.lastY = pointer.y;
  queueGlobeRender();
}

function handleGlobePointerUp(event) {
  const pointer = getPointerPosition(event);
  const radius = pointer.size * 0.34 * globeState.zoom;
  const localX = pointer.x - (pointer.size / 2);
  const localY = pointer.y - (pointer.size / 2);

  if (!globeState.dragMoved) {
    const coordinates = inverseProject(localX, localY, radius);
    globeState.selected = coordinates ? resolveSelectionMetadata(coordinates.lat, coordinates.lng) : null;
    updateSelectedText();
    if (coordinates) {
      globeStatus.textContent = isDetailedZoom()
        ? "Location selected. Country and state detail are active."
        : "Location selected. Zoom in further to see state detail where available.";
    }
  }

  globeState.dragging = false;
  if (globeCanvas.hasPointerCapture(event.pointerId)) {
    globeCanvas.releasePointerCapture(event.pointerId);
  }
  queueGlobeRender();
}

function handleGlobeWheel(event) {
  event.preventDefault();
  const nextZoom = globeState.zoom + (event.deltaY > 0 ? -0.08 : 0.08);
  globeState.zoom = clamp(nextZoom, 0.78, 6);

  if (globeState.selected) {
    globeState.selected = resolveSelectionMetadata(globeState.selected.lat, globeState.selected.lng);
    updateSelectedText();
  }

  queueGlobeRender();
}

function startGlobeAnimation() {
  function tick() {
    if (!globeState.dragging) {
      globeState.yaw += 0.0013;
    }
    queueGlobeRender();
    window.requestAnimationFrame(tick);
  }

  window.requestAnimationFrame(tick);
}

function attachGlobeEvents() {
  globeCanvas.addEventListener("pointerdown", handleGlobePointerDown);
  globeCanvas.addEventListener("pointermove", handleGlobePointerMove);
  globeCanvas.addEventListener("pointerup", handleGlobePointerUp);
  globeCanvas.addEventListener("pointercancel", () => {
    globeState.dragging = false;
  });
  globeCanvas.addEventListener("wheel", handleGlobeWheel, { passive: false });
  window.addEventListener("resize", queueGlobeRender);
}

async function boot() {
  const results = await Promise.allSettled([loadSite(), loadLights(), loadGeoData()]);

  const siteResult = results[0];
  const lightsResult = results[1];
  const geoResult = results[2];

  if (siteResult.status === "rejected") {
    throw siteResult.reason;
  }

  if (lightsResult.status === "rejected") {
    globeStatus.textContent = "Unable to load existing lights right now.";
  }

  if (geoResult.status === "rejected") {
    globeStatus.textContent = "Detailed map data is unavailable right now. Basic placement still works.";
  }

  queueGlobeRender();
}

counterButton.addEventListener("click", incrementCounter);
globeSubmitButton.addEventListener("click", placeSelectedLight);

attachGlobeEvents();
updateSelectedText();
startGlobeAnimation();

boot().catch((error) => {
  counterStatus.textContent = "Unable to load content.";
  globeStatus.textContent = error.message || "Unable to load globe.";
});
