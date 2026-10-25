import { components, routes, repository } from "./data.js";

const $ = (id) => document.getElementById(id);
let activeRoute = "overview",
  selected = null,
  viewer = null;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let paused =
  reduced.matches || new URLSearchParams(location.search).has("still");
const labels = new Map();
const componentButtons = new Map();
function setFacts(facts) {
  $("detail-facts").replaceChildren(
    ...facts.map(([term, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }),
  );
}
function inspect(id) {
  selected = id;
  const c = components.find((item) => item.id === id);
  $("detail-kicker").textContent = c.kicker;
  $("detail-title").textContent = c.title;
  $("detail-body").textContent = c.body;
  setFacts(c.facts);
  $("detail-source").href = repository + c.source;
  if (id === "retrieval" && activeRoute === "fallback") {
    $("detail-kicker").textContent = "REMOTE FALLBACK";
    $("detail-title").textContent = "Tags → vectors → candidates.";
    $("detail-body").textContent =
      "When local routes cannot serve the request, Gemini tags the draft. Cached Gemini tag embeddings drive Tiger pgvector retrieval. The resulting shortlist still receives fresh review and generation.";
    setFacts([
      ["Tag / review model", "Gemini Flash-Lite"],
      ["Embedding model", "gemini-embedding-001"],
      ["Candidates", "Up to 5 at ≥ 0.88"],
    ]);
    $("detail-source").href = repository + "backend/app/pipeline/retrieve.py";
  }
  if (id === "retrieval" && activeRoute === "lexical") {
    $("detail-kicker").textContent = "LOCAL LEXICAL NOMINATION";
    $("detail-title").textContent = "Match locally. Review freshly.";
    $("detail-body").textContent =
      "If direct semantic retrieval is unavailable, eligible end-cursor requests can rank documents in a fresh Tiger snapshot. Title, summary, or tag overlap must support the match. Uncertain matches continue to remote tag retrieval.";
    setFacts([
      ["Remote retrieval calls", "None on this route"],
      ["Candidates", "Up to 3"],
      ["Relevance verdict", "Fresh Gemini review"],
    ]);
    $("detail-source").href = repository + "backend/app/pipeline/catalog.py";
  }
  for (const [key, button] of [...labels, ...componentButtons])
    button.setAttribute("aria-pressed", String(key === id));
  viewer?.select(id);
}
function setRoute(id) {
  activeRoute = id;
  const route = routes[id];
  document
    .querySelectorAll("[data-route]")
    .forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.route === id)),
    );
  $("route-kicker").textContent = route.kicker;
  $("route-title").textContent = route.title;
  $("route-copy").textContent = route.copy;
  for (const [key, button] of labels)
    button.classList.toggle("dimmed", !route.nodes.includes(key));
  labels.get("retrieval").querySelector("strong").textContent =
    id === "fallback" ? "Remote retrieval" : "Local retrieval";
  labels.get("retrieval").querySelector("span").textContent =
    id === "fallback"
      ? "GEMINI TAGS → PGVECTOR"
      : id === "lexical"
        ? "METADATA-SUPPORTED SHORTLIST"
        : "EMBEDDINGGEMMA 2 → LEXICAL";
  viewer?.route(route);
  if (route.selected) inspect(route.selected);
  else {
    selected = null;
    $("detail-kicker").textContent = "THE SYSTEM";
    $("detail-title").textContent = "Grounded, then generated.";
    $("detail-body").textContent =
      "A fast shortlist brings relevant knowledge into one fresh Gemini review and generation call. Each result is validated before it reaches the editor.";
    setFacts(route.facts);
    $("detail-source").href = repository + "backend/app/pipeline/run.py";
    for (const button of [...labels.values(), ...componentButtons.values()])
      button.setAttribute("aria-pressed", "false");
    viewer?.select(null);
  }
}
for (const c of components) {
  const button = document.createElement("button");
  button.className = "node-label";
  button.setAttribute("aria-label", `Inspect ${c.title}`);
  button.setAttribute("aria-pressed", "false");
  const title = document.createElement("strong");
  title.textContent = c.title;
  title.dataset.short = c.short;
  const subtitle = document.createElement("span");
  subtitle.textContent = c.subtitle;
  button.append(title, subtitle);
  button.onclick = () => inspect(c.id);
  $("labels").append(button);
  labels.set(c.id, button);
  const textButton = document.createElement("button");
  textButton.textContent = c.short;
  textButton.setAttribute("aria-pressed", "false");
  textButton.onclick = () => inspect(c.id);
  $("component-buttons").append(textButton);
  componentButtons.set(c.id, textButton);
}
document
  .querySelectorAll("[data-route]")
  .forEach((button) => (button.onclick = () => setRoute(button.dataset.route)));
function updateMotion() {
  $("motion").textContent = paused ? "Play flow" : "Pause flow";
  $("motion").setAttribute("aria-pressed", String(paused));
}
$("motion").onclick = () => {
  paused = !paused;
  updateMotion();
};
updateMotion();
reduced.addEventListener("change", (event) => {
  paused = event.matches;
  updateMotion();
});
$("reset").onclick = () => viewer?.reset();
setRoute("overview");

try {
  // Dynamic imports preserve the readable explorer if WebGL or dependencies are unavailable.
  const [THREE, { OrbitControls }, { createModel }] = await Promise.all([
    import("three"),
    import("three/addons/OrbitControls.js"),
    import("./models.js"),
  ]);
  const stage = $("stage");
  const host = $("canvas-host");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef3fa);
  const camera = new THREE.OrthographicCamera(-15, 15, 8, -8, 0.1, 150);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xeef3fa);
  renderer.domElement.setAttribute(
    "aria-label",
    "3D architecture model; use the component buttons for keyboard access",
  );
  renderer.domElement.setAttribute("role", "img");
  host.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minZoom = 0.7;
  controls.maxZoom = 1.8;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.2;
  function reset() {
    camera.position.set(1.6, 19, 27);
    controls.target.set(0, 0.5, -0.3);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
  }
  reset();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb7c5db, 2.4));
  const sun = new THREE.DirectionalLight(0xfffcf5, 3.1);
  sun.position.set(-9, 18, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -18,
    right: 18,
    top: 15,
    bottom: -15,
    near: 1,
    far: 60,
  });
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0001;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc8d6ff, 1.4);
  fill.position.set(12, 8, -8);
  scene.add(fill);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0xeef3fa, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.12;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(40, 40, 0xc4d1e5, 0xdde5f0);
  grid.position.y = -0.105;
  grid.material.transparent = true;
  grid.material.opacity = 0.38;
  scene.add(grid);
  const groups = new Map();
  for (const c of components) {
    const model = createModel(c);
    scene.add(model);
    groups.set(c.id, model);
  }
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.75, 0.025, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0x3468be }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  const edges = [];
  const v = (x, z, y = 0.2) => new THREE.Vector3(x, y, z);
  function edge(id, points, { background = false, color = 0x6385b7 } = {}) {
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.12);
    const group = new THREE.Group();
    scene.add(group);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      transparent: true,
      opacity: background ? 0.5 : 0.8,
    });
    if (background) {
      for (let t = 0; t < 1; t += 0.065) {
        const part = new THREE.CatmullRomCurve3([
          curve.getPoint(t),
          curve.getPoint(Math.min(1, t + 0.035)),
        ]);
        group.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(part, 4, 0.022, 5, false),
            material,
          ),
        );
      }
    } else
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, 96, 0.028, 6, false),
          material,
        ),
      );
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.29, 12),
      material,
    );
    arrow.position.copy(curve.getPoint(0.91));
    arrow.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      curve.getTangent(0.91).normalize(),
    );
    group.add(arrow);
    const pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 12, 8),
      new THREE.MeshBasicMaterial({ color: background ? 0x7796be : 0x4074c2 }),
    );
    group.add(pulse);
    edges.push({ id, group, curve, material, pulse, background });
  }
  edge("input", [v(-7.25, 2), v(-6.25, 2)]);
  edge("nominate", [v(-2.75, 2), v(-1.75, 2)]);
  edge("generate", [v(1.75, 2), v(2.75, 2)]);
  edge("validate", [v(6.25, 2), v(7.25, 2)]);
  edge(
    "return",
    [
      v(9, 3.55),
      v(9, 5.6),
      v(7.8, 6.15),
      v(-7.8, 6.15),
      v(-9, 5.6),
      v(-9, 3.55),
    ],
    { color: 0x7e9bbd },
  );
  edge(
    "snapshot",
    [v(-0.45, -5), v(0.9, -4.8), v(1.25, -3), v(0.8, -1.8), v(0.5, 0.45)],
    { background: true, color: 0x7964b7 },
  );
  edge("trace", [v(-4.5, 0.45), v(-4.5, -1.4), v(-3, -2.4), v(-2.2, -3.45)], {
    background: true,
  });
  edge("export", [v(-0.45, -5), v(1.7, -5), v(3.75, -5)], {
    background: true,
    color: 0x539fbd,
  });
  edge("mcp", [v(-7.25, -5), v(-5.8, -5), v(-4.5, -3.8), v(-4.5, 0.45)], {
    color: 0x566c8c,
  });
  edge("fallback-db", [v(0, 0.45), v(0, -1.5), v(-1.9, -2.1), v(-2.2, -3.45)], {
    color: 0x7964b7,
  });
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let pointerStart = null;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    pointerStart = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (
      !pointerStart ||
      Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 5
    )
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...groups.values()], true)[0];
    if (hit) inspect(hit.object.userData.component);
  });
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    renderer.setSize(w, h);
    const aspect = w / h;
    const width = 26.6;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = width / aspect / 2;
    camera.bottom = -width / aspect / 2;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  viewer = {
    reset,
    select(id) {
      ring.visible = !!id;
      if (id) {
        const p = groups.get(id).position;
        ring.position.set(p.x, 0.16, p.z);
      }
    },
    route(route) {
      for (const e of edges) {
        const active = route.edges.includes(e.id);
        e.group.visible = active;
        e.material.opacity = e.background ? 0.5 : 0.8;
      }
    },
  };
  viewer.route(routes[activeRoute]);
  if (selected) viewer.select(selected);
  let elapsed = 0,
    last = performance.now();
  function frame(now) {
    const delta = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!paused) elapsed += delta;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      e.pulse.position.copy(e.curve.getPoint((elapsed * 0.22 + i * 0.137) % 1));
      e.pulse.visible = !paused;
    }
    for (const c of components) {
      const p = new THREE.Vector3(
        c.position[0],
        -0.15,
        c.position[2] + 1.92,
      ).project(camera);
      const label = labels.get(c.id);
      label.style.left = `${(p.x * 0.5 + 0.5) * host.clientWidth}px`;
      label.style.top = `${(-p.y * 0.5 + 0.5) * host.clientHeight}px`;
      label.style.visibility = p.z < 1 && p.z > -1 ? "visible" : "hidden";
    }
    renderer.render(scene, camera);
    document.documentElement.dataset.sceneReady = "true";
  }
  renderer.setAnimationLoop(frame);
  document.addEventListener("visibilitychange", () => {
    renderer.setAnimationLoop(document.hidden ? null : frame);
    last = performance.now();
  });
} catch (error) {
  $("stage").classList.add("no-webgl");
  $("fallback").hidden = false;
  $("reset").disabled = true;
  $("motion").disabled = true;
  $("interaction-hint").textContent = "Use the component buttons below";
  document.documentElement.dataset.sceneReady = "fallback";
  console.warn("Architecture 3D unavailable:", error.message);
}
