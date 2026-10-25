// Binary STL for GitHub's native 3D file viewer. STL preserves geometry, not materials or UI.
// Labels are actual raised meshes so the native viewer remains understandable without CSS.
export function exportSTL(THREE, roots, components) {
  const labels = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  function label(text, x, z, maxWidth) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = "bold 13px monospace";
    const width = Math.ceil(context.measureText(text).width) + 2;
    canvas.width = width;
    canvas.height = 18;
    context.font = "bold 13px monospace";
    context.fillStyle = "#fff";
    context.fillText(text, 1, 13);
    const pixels = context.getImageData(0, 0, width, 18).data;
    const scale = Math.min(maxWidth / width, 0.035);
    for (let row = 0; row < 18; row++) {
      for (let col = 0; col < width;) {
        if (pixels[(row * width + col) * 4 + 3] < 120) {
          col++;
          continue;
        }
        const start = col;
        while (col < width && pixels[(row * width + col) * 4 + 3] >= 120) col++;
        const block = new THREE.Mesh(
          new THREE.BoxGeometry((col - start) * scale, 0.045, scale),
          material,
        );
        block.position.set(
          x + ((start + col) / 2 - width / 2) * scale,
          0.17,
          z + (row - 9) * scale,
        );
        labels.add(block);
      }
    }
  }
  for (const c of components)
    label(c.title, c.position[0], c.position[2] + 2.1, 3.5);
  label("Skill Issue", -8, -8, 4);
  const meshes = [];
  for (const root of [...roots, labels]) {
    root.updateMatrixWorld(true);
    root.traverseVisible((object) => {
      if (object.isMesh && object.geometry.attributes.position)
        meshes.push(object);
    });
  }
  const triangleCount = meshes.reduce(
    (sum, mesh) =>
      sum +
      (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) /
        3,
    0,
  );
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 80).set(
    new TextEncoder().encode(
      "Skill Issue architecture | geometry-only GitHub viewer | units arbitrary",
    ),
  );
  view.setUint32(80, triangleCount, true);
  const up = new THREE.Matrix4().makeRotationX(Math.PI / 2); // STL convention: Z up.
  const matrix = new THREE.Matrix4();
  const vertices = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  const normal = new THREE.Vector3(),
    edge = new THREE.Vector3();
  let offset = 84;
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    matrix.multiplyMatrices(up, mesh.matrixWorld);
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      for (let j = 0; j < 3; j++)
        vertices[j]
          .fromBufferAttribute(position, index ? index.getX(i + j) : i + j)
          .applyMatrix4(matrix)
          .multiplyScalar(5); // Match GitHub’s default STL camera scale.
      normal
        .subVectors(vertices[1], vertices[0])
        .cross(edge.subVectors(vertices[2], vertices[0]))
        .normalize();
      for (const vector of [normal, ...vertices]) {
        for (const value of [vector.x, vector.y, vector.z]) {
          view.setFloat32(offset, value, true);
          offset += 4;
        }
      }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }
  labels.traverse((object) => object.geometry?.dispose());
  material.dispose();
  return new Uint8Array(buffer);
}
