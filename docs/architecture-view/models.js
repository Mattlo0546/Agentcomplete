import * as THREE from "three";

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.15,
    ...extra,
  });
const white = mat(0xfafcff),
  dark = mat(0x24334c),
  metal = mat(0xb8c8de, { metalness: 0.65, roughness: 0.3 });
function mesh(
  group,
  geometry,
  material,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...position);
  m.rotation.set(...rotation);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}
function box(g, w, h, d, m, p, r) {
  return mesh(g, new THREE.BoxGeometry(w, h, d), m, p, r);
}
function cylinder(g, r, h, m, p) {
  return mesh(g, new THREE.CylinderGeometry(r, r, h, 48), m, p);
}
function rod(g, a, b, r, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = mesh(
    g,
    new THREE.CylinderGeometry(r, r, dir.length(), 12),
    material,
  );
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}
function screenTexture(terminal = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 448;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = terminal ? "#26344b" : "#f6f9fe";
  ctx.fillRect(0, 0, 768, 448);
  ctx.fillStyle = terminal ? "#3a4b65" : "#dbe6f5";
  ctx.fillRect(0, 0, 768, 58);
  ["#e4978a", "#e3c17b", "#86bda7"].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(28 + i * 27, 28, 7, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = terminal ? "#edf4ff" : "#26344b";
  ctx.font = "bold 34px monospace";
  ctx.fillText(terminal ? "> Codex" : "Skill Issue", 35, 125);
  ctx.font = "25px monospace";
  ctx.fillText(terminal ? "$ get_refined_prompt" : "Add retries with", 35, 194);
  ctx.fillStyle = terminal ? "#a9c9fa" : "#728bb0";
  ctx.fillText(terminal ? "  prompt ready" : "exponential backoff", 35, 239);
  ctx.fillStyle = terminal ? "#5d799e" : "#d5dfed";
  ctx.fillRect(35, 294, terminal ? 310 : 550, 9);
  ctx.fillRect(35, 324, terminal ? 440 : 400, 9);
  ctx.fillStyle = terminal ? "#a9c9fa" : "#3468be";
  ctx.fillRect(35, 380, 22, 5);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function laptop(g, terminal) {
  const accent = terminal ? dark : metal;
  box(g, 2.65, 0.13, 1.8, accent, [0, 0.25, 0.15]);
  box(g, 2.5, 1.65, 0.14, accent, [0, 1.14, -0.55]);
  mesh(
    g,
    new THREE.PlaneGeometry(2.28, 1.34),
    new THREE.MeshBasicMaterial({ map: screenTexture(terminal) }),
    [0, 1.16, -0.47],
  );
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 12; c++)
      box(g, 0.15, 0.02, 0.12, terminal ? metal : dark, [
        -1.02 + c * 0.186,
        0.33,
        -0.05 + r * 0.17,
      ]);
  box(g, 0.64, 0.015, 0.28, white, [0, 0.33, 0.77]);
}
function server(g, color) {
  const accent = mat(color);
  box(g, 1.65, 2.3, 1.2, dark, [0, 1.35, 0]);
  for (let i = 0; i < 4; i++) {
    box(g, 1.48, 0.43, 1.23, white, [0, 0.58 + i * 0.52, 0.03]);
    for (let j = 0; j < 6; j++)
      box(g, 0.055, 0.2, 0.03, metal, [
        -0.55 + j * 0.13,
        0.58 + i * 0.52,
        0.66,
      ]);
    mesh(g, new THREE.SphereGeometry(0.05, 12, 8), accent, [
      0.58,
      0.58 + i * 0.52,
      0.68,
    ]);
  }
  box(g, 1.9, 0.12, 1.5, metal, [0, 0.19, 0]);
}
function chip(g, color) {
  const accent = mat(color, { metalness: 0.55 });
  box(g, 2.2, 0.16, 2.1, accent, [0, 0.37, 0]);
  for (let i = 0; i < 8; i++) {
    const t = -0.86 + i * 0.245;
    box(g, 0.1, 0.08, 0.38, metal, [t, 0.32, 1.16]);
    box(g, 0.1, 0.08, 0.38, metal, [t, 0.32, -1.16]);
    box(g, 0.38, 0.08, 0.1, metal, [1.16, 0.32, t]);
    box(g, 0.38, 0.08, 0.1, metal, [-1.16, 0.32, t]);
  }
  box(g, 1.45, 0.38, 1.45, dark, [0, 0.65, 0]);
  box(g, 1.3, 0.08, 1.3, mat(0xa893db), [0, 0.89, 0]);
  for (let x = 0; x < 3; x++)
    for (let z = 0; z < 3; z++) {
      cylinder(g, 0.14, 0.13, white, [-0.4 + x * 0.4, 1.0, -0.4 + z * 0.4]);
    }
  for (let i = 0; i < 3; i++)
    box(g, 1.25, 0.07, 0.53, white, [0.17 * i - 0.17, 1.33 + i * 0.25, -0.05]);
}
function gemini(g) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.4);
  shape.bezierCurveTo(0.18, 0.35, 0.35, 0.18, 1.25, 0);
  shape.bezierCurveTo(0.35, -0.18, 0.18, -0.35, 0, -1.4);
  shape.bezierCurveTo(-0.18, -0.35, -0.35, -0.18, -1.25, 0);
  shape.bezierCurveTo(-0.35, 0.18, -0.18, 0.35, 0, 1.4);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.28,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.07,
    bevelThickness: 0.06,
    curveSegments: 32,
  });
  mesh(
    g,
    geometry,
    mat(0x6495e7, { metalness: 0.5, roughness: 0.24 }),
    [0, 1.7, 0],
    [0, -0.18, 0],
  );
  cylinder(g, 0.95, 0.12, metal, [0, 0.2, 0]);
  mesh(
    g,
    new THREE.TorusGeometry(1, 0.025, 8, 64),
    mat(0x93b6ee),
    [0, 1.7, 0.02],
    [0, Math.PI / 2, 0],
  );
}
function database(g, color) {
  const accent = mat(color);
  for (let i = 0; i < 3; i++) {
    cylinder(g, 1.05, 0.57, accent, [0, 0.6 + i * 0.64, 0]);
    cylinder(g, 1.055, 0.06, white, [0, 0.9 + i * 0.64, 0]);
    mesh(g, new THREE.SphereGeometry(0.055, 12, 8), mat(0xbde7ef), [
      0.52,
      0.6 + i * 0.64,
      0.92,
    ]);
  }
  cylinder(g, 1.15, 0.12, metal, [0, 0.22, 0]);
}
function validation(g, color) {
  for (let i = 0; i < 3; i++) {
    const layer = new THREE.Group();
    g.add(layer);
    layer.position.set(-0.25 + i * 0.26, 0.4 + i * 0.2, -0.4 + i * 0.23);
    box(layer, 1.85, 2.05, 0.09, i === 2 ? white : metal, [0, 1, 0]);
    if (i === 2) {
      const accent = mat(color);
      rod(
        layer,
        new THREE.Vector3(-0.53, 1.18, 0.08),
        new THREE.Vector3(-0.1, 0.76, 0.08),
        0.075,
        accent,
      );
      rod(
        layer,
        new THREE.Vector3(-0.1, 0.76, 0.08),
        new THREE.Vector3(0.6, 1.5, 0.08),
        0.075,
        accent,
      );
      box(layer, 1.1, 0.055, 0.03, metal, [0, 0.36, 0.07]);
    }
  }
}
function snowflake(g, color) {
  const accent = mat(color, { metalness: 0.4 });
  const center = new THREE.Vector3(0, 1.65, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const end = center.clone().addScaledVector(dir, 1.2);
    rod(g, center, end, 0.08, accent);
    const base = center.clone().addScaledVector(dir, 0.75);
    for (const side of [-1, 1]) {
      const branch = new THREE.Vector3(
        Math.cos(a + (side * Math.PI) / 3),
        Math.sin(a + (side * Math.PI) / 3),
        0,
      );
      rod(g, base, base.clone().addScaledVector(branch, 0.43), 0.07, accent);
    }
  }
  mesh(g, new THREE.IcosahedronGeometry(0.2, 0), white, [0, 1.65, 0]);
  cylinder(g, 0.92, 0.13, metal, [0, 0.2, 0]);
  rod(
    g,
    new THREE.Vector3(0, 0.25, 0),
    new THREE.Vector3(0, 0.65, 0),
    0.05,
    metal,
  );
}
export function createModel(component) {
  const group = new THREE.Group();
  const pedestal = box(group, 3.35, 0.15, 3.0, white, [0, 0.04, 0]);
  pedestal.userData.pedestal = true;
  box(group, 2.6, 0.035, 0.06, mat(component.color), [0, 0.135, 1.37]);
  const builders = {
    laptop: (g) => laptop(g, false),
    terminal: (g) => laptop(g, true),
    server: (g) => server(g, component.color),
    chip: (g) => chip(g, component.color),
    gemini,
    database: (g) => database(g, component.color),
    validation: (g) => validation(g, component.color),
    snowflake: (g) => snowflake(g, component.color),
  };
  builders[component.model](group);
  group.position.set(...component.position);
  group.userData.component = component.id;
  group.traverse((obj) => {
    obj.userData.component = component.id;
  });
  return group;
}
