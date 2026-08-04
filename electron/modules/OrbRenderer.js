import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ─── Shaders ───────────────────────────────────────────────────────────────

/** Fresnel Rim Glow — acende apenas nas bordas do rosto (efeito de brilho holográfico) */
const scanlineVertex = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const scanlineFragment = /* glsl */ `
  uniform float uScanY;
  uniform vec3  uColor;
  varying vec3  vWorldPos;

  void main() {
    float dist      = abs(vWorldPos.y - uScanY);
// Narrower, softer scanline
float intensity = 1.0 - smoothstep(0.0, 0.06, dist);
float alpha = intensity * 0.45; // reduce overall opacity
if (alpha < 0.01) discard;
gl_FragColor = vec4(uColor, alpha);
  }
`;

// ─── Classe Principal ───────────────────────────────────────────────────────

/**
 * OrbRenderer — Renderizador holográfico do rosto 3D (JARVIS / M.J.B.S)
 *
 * Técnicas aplicadas:
 *  1. Depth Occluder   — malha sólida invisível que esconde as faces traseiras do wireframe
 *  2. Wireframe neon   — linhas ciano finas da estrutura frontal do rosto
 *  3. Fresnel Rim Glow — glow adicional injetado nos materiais do VRM
 *  4. Scanline         — varredura animada de luz na frente do rosto
 */
export class OrbRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.vrm = null;
    this.modelLoaded = false;
    this.error = null;
    this.isSpeaking = false;
    this.blinkResetHandle = null;
    this.nextBlinkAt = Date.now() + this._randomBlinkDelay();
    this.clock = new THREE.Clock();

    // Uniforms dos shaders (referências para atualizar no loop)
    this.scanlineMat = null;

    // ── Cena, Câmera e Renderer ──────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.z = 3.8;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.sortObjects = true;
    // Enable per-material clipping for clean bust cut
    this.renderer.localClippingEnabled = true;

    // ── Iluminação sutil de ambiente ─────────────────────────────────────────
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const dirLight = new THREE.DirectionalLight(0x88ddff, 0.6);
    dirLight.position.set(3, 5, 5);
    this.scene.add(dirLight);

    // ── VRM e grupo de modelo ────────────────────────────────────────────────
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    // storage for overlays and clipping plane
    this._overlays = [];
    this._clippingPlane = null;

    // Temporary toggle: enable overlays (true to display circuit overlay)
    this._enableOverlays = true;

    // ── Inicia carregamento e loop ───────────────────────────────────────────
    this.loadModel();
    this.draw = this.draw.bind(this);
    this.draw();
  }

  _randomBlinkDelay() {
    return 2000 + Math.random() * 4000;
  }

  _scheduleNextBlink() {
    this.nextBlinkAt = Date.now() + this._randomBlinkDelay();
  }

  loadModel() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const modelPath = new URL('../assets/jarvis-face.vrm', import.meta.url).href;

    const processModel = (gltf) => {
      const vrm = gltf.userData.vrm;
      if (!vrm) {
        throw new Error('VRM não encontrado em gltf.userData.vrm');
      }

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);

      this.vrm = vrm;
      this.vrm.scene.traverse((child) => {
        if (child.isMesh) {
          const name = (child.name || '').toLowerCase();
          const matName = (child.material && child.material.name) ? String(child.material.name).toLowerCase() : '';
          // Debug: log mesh and material names to help tune eye filters if needed
          console.log('VRM mesh:', child.name || '<unnamed>', 'material:', child.material?.name || '<none>');

          // Hide body/large clothing pieces
          if (name.includes('body') || name.includes('clothes') || name.includes('skirt') || name.includes('pants')) {
            child.visible = false;
          }

          // Eyes/iris should keep their original material (no wireframe overlay / optional glow)
          const eyeKeywords = ['eye','iris','pupil','eyeball','eyelid','lash','sclera'];
          const mouthKeywords = ['mouth','lip','lips','tongue','jaw','chin'];
          const isEye = eyeKeywords.some((k) => name.includes(k) || matName.includes(k));
          const isMouth = mouthKeywords.some((k) => name.includes(k) || matName.includes(k));

          // Additional heuristic: skip overlay for very small meshes (likely eyeballs/iris pieces)
          let isSmall = false;
          try {
            if (child.geometry && child.geometry.boundingBox === null) child.geometry.computeBoundingBox();
            if (child.geometry && child.geometry.boundingBox) {
              const gb = child.geometry.boundingBox;
              const gSize = new THREE.Vector3();
              gSize.subVectors(gb.max, gb.min);
              // if the mesh is less than ~12% of head size in any axis, treat as small
              if (gSize.x < 0.12 || gSize.y < 0.12 || gSize.z < 0.12) isSmall = true;
            }
          } catch (e) {
            // ignore bbox issues
          }

          const skipOverlay = isEye || isSmall || isMouth;

          child.castShadow = true;
          child.receiveShadow = true;
          // Skip hologram patch for eyes and mouth to preserve original shading and morph visibility
          if (child.material && !isMouth) {
            // Normalize material array handling
            const mats = Array.isArray(child.material) ? child.material : [child.material];

            // Attempt lightweight hologram patch for non-eye materials
            mats.forEach((m) => {
              if (!isEye && m) {
                try { this._patchMaterialForHologram(m); } catch (e) { console.warn('Patch hologram skipped for material', m?.name, e); }
              }
            });

            // Additionally, dim the base skin/MToon materials to reveal only the overlay
            try {
              const meshNameLower = (child.name || '').toLowerCase();
              const looksLikeSkin = meshNameLower.includes('face') || mats.some(m => ((m && m.name) || '').toLowerCase().includes('face') || ((m && m.name) || '').toLowerCase().includes('skin'));
              if (looksLikeSkin) {
                mats.forEach((mat) => {
                  if (!mat) return;
                  try { mat.transparent = true; } catch (e) {}
                  try { mat.opacity = 0.06; } catch (e) {}
                  try { if (mat.color) mat.color.set(0x001030); } catch (e) {}
                  try { mat.depthWrite = false; } catch (e) {}
                  try { mat.needsUpdate = true; } catch (e) {}
                });
              }
            } catch (e) {
              // ignore
            }

            // Eye styling: prefer emissive cyan glow for iris/eye parts
            if (isEye) {
              mats.forEach((eyeMat, idx) => {
                try {
                  if (!eyeMat) return;
                  if (eyeMat.emissive !== undefined) {
                    try { eyeMat.emissive.set(0x00F0FF); } catch(e){}
                    try { eyeMat.emissiveIntensity = 4.0; } catch(e){}
                    try { if (eyeMat.color) eyeMat.color.set(0x001030); } catch(e){}
                    try { eyeMat.transparent = false; } catch(e){}
                    try { eyeMat.depthWrite = false; } catch(e){}
                    try { eyeMat.needsUpdate = true; } catch(e){}
                  } else {
                    // Replace with simple emissive material (fast path)
                    try {
                      const newMat = new THREE.MeshStandardMaterial({ color: 0x001030, emissive: new THREE.Color(0x00F0FF), emissiveIntensity: 4.0, roughness: 0.1, metalness: 0.0 });
                      if (Array.isArray(child.material)) child.material[idx] = newMat; else child.material = newMat;
                    } catch (e) { /* ignore */ }
                  }
                } catch (e) { }
              });
            }
          }

          // Eye styling: prefer emissive cyan glow for iris/eye parts
          if (isEye) {
            try {
              const eyeMat = child.material;
              if (eyeMat) {
                if (eyeMat.emissive !== undefined) {
                  try { eyeMat.emissive.set(0x00F0FF); } catch(e){}
                  try { eyeMat.emissiveIntensity = 3.0; } catch(e){}
                  try { if (eyeMat.color) eyeMat.color.set(0x001030); } catch(e){}
                  try { eyeMat.transparent = false; } catch(e){}
                  try { eyeMat.depthWrite = false; } catch(e){}
                  eyeMat.needsUpdate = true;
                } else {
                  // Replace with simple emissive material (fast path)
                  try {
                    child.material = new THREE.MeshStandardMaterial({ color: 0x001030, emissive: new THREE.Color(0x00F0FF), emissiveIntensity: 3.0, roughness: 0.1, metalness: 0.0 });
                  } catch (e) { /* ignore */ }
                }
              }
            } catch (e) { }
          }

          // If we're skipping overlay for this mesh, ensure any previously created overlay
          // referring to the same geometry or skeleton is removed (defensive cleanup).
          if (skipOverlay && this._overlays && this._overlays.length) {
            const overlaysToRemove = [];
              this._overlays.forEach((ov) => {
             try {
               if (ov.geometry === child.geometry || (ov.skeleton && child.skeleton && ov.skeleton === child.skeleton)) {
                 if (ov.parent) ov.parent.remove(ov);
                 // dispose resources
                 try { if (ov.geometry) ov.geometry.dispose(); } catch (e) {}
                 try {
                   const mat = ov.material;
                   if (mat) {
                     if (Array.isArray(mat)) {
                       mat.forEach(m => { try { if (m.map && m.map !== this._pointSpriteTexture) m.map.dispose(); } catch(e){}; try{ m.dispose(); }catch(e){} });
                     } else {
                       try { if (mat.map && mat.map !== this._pointSpriteTexture) mat.map.dispose(); } catch (e) {}
                       try { mat.dispose(); } catch (e) {}
                     }
                   }
                 } catch (e) {}
                 overlaysToRemove.push(ov);
               }
             } catch (e) {
               // ignore
             }
              });
              this._overlays = this._overlays.filter((o) => !overlaysToRemove.includes(o));
          }

          const meshNameLower = (child.name || '').toLowerCase();
          const isFaceMesh = meshNameLower.includes('face') || meshNameLower.includes('head');
          if (child.isSkinnedMesh && !skipOverlay && this._enableOverlays && isFaceMesh) {
            this._createCircuitOverlay(child);
          }
        }
      });

      this._setupScanline();
      this._resizeAndCenterModel();
      this.modelGroup.add(this.vrm.scene);
      this.modelLoaded = true;
    };

    loader.load(
      modelPath,
      (gltf) => {
        try {
          processModel(gltf);
        } catch (err) {
          this.error = err;
          console.error('❌ Erro ao processar modelo VRM:', err);
        }
      },
      undefined,
      (err) => {
        this.error = err;
        console.error('❌ VRM não carregou:', err);
      },
    );
  }

  _resizeAndCenterModel() {
    const faceMeshes = [];
    this.vrm.scene.traverse((child) => {
      if (child.isMesh && child.visible && (child.name || '').toLowerCase().includes('face')) {
        faceMeshes.push(child);
      }
    });

    const box = new THREE.Box3();
    if (faceMeshes.length > 0) {
      faceMeshes.forEach((mesh) => box.expandByObject(mesh));
    } else {
      box.setFromObject(this.vrm.scene);
    }

    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) / 2;
    const targetRadius = 1.6;
    const scale = radius > 0 ? targetRadius / radius : 1.0;

    this.modelGroup.scale.setScalar(scale);

    const center = new THREE.Vector3();
    box.getCenter(center);
    this.modelGroup.position.set(-center.x * scale, -center.y * scale - 0.05, -center.z * scale);

    // create horizontal clipping plane slightly below the chin to remove dangling neck pieces
    // compute a local Y for the cut a bit above the min bound (10% of height above bottom)
    const cutLocalY = box.min.y + size.y * 0.12;
    // convert to world Y after modelGroup transform
    this.modelGroup.updateMatrixWorld(true);
    const cutWorld = new THREE.Vector3(0, cutLocalY, 0);
    this.modelGroup.localToWorld(cutWorld);
    const cutWorldY = cutWorld.y;
    this._clippingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -cutWorldY);

    // apply clipping to materials and overlays
    this._applyClippingPlaneToMaterials();

    if (this.scanlinePlane) {
      const headCenterY = box.min.y + size.y * 0.55;
      this.scanlinePlane.position.set(0, headCenterY - center.y, 0.65);
    }
  }

  _patchMaterialForHologram(material) {
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((mat) => {
      if (mat.userData?.hologramPatched) {
        return;
      }

      // Only patch materials that are standard/physical to avoid breaking custom shader materials
      if (!mat.isMeshStandardMaterial) {
        // skip non-standard materials (MToon / ShaderMaterial) to avoid compile issues
        return;
      }

      const originalOnBeforeCompile = mat.onBeforeCompile?.bind(mat);
      mat.onBeforeCompile = (shader, renderer) => {
        try {
          if (typeof originalOnBeforeCompile === 'function') {
            originalOnBeforeCompile(shader, renderer);
          }

          // lightweight hologram uniforms
          shader.uniforms.uHoloColor = { value: new THREE.Color(0x00e5ff) };
          shader.uniforms.uHoloPower = { value: 1.2 }; // further reduced power to avoid washing mouth

          const effectCode = `
            /* injected hologram rim */
            float rimFactor = 0.0;
            #ifdef NORMAL
              rimFactor = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), uHoloPower);
            #endif
                vec3 rimColor = uHoloColor * rimFactor * 0.25; // reduced intensity
            gl_FragColor.rgb += rimColor;
          `;

          const token = '#include <dithering_fragment>';
          if (typeof shader.fragmentShader === 'string' && shader.fragmentShader.includes(token)) {
            shader.fragmentShader = shader.fragmentShader.replace(token, `${token}\n${effectCode}`);
          } else if (typeof shader.fragmentShader === 'string' && shader.fragmentShader.includes('gl_FragColor')) {
            shader.fragmentShader = shader.fragmentShader + '\n' + effectCode;
          } else {
            console.warn('Skipping hologram injection for material (incompatible shader):', mat.name);
          }
        } catch (e) {
          console.warn('Hologram patch failed for material', mat.name, e);
        }
      };

      mat.userData = { ...mat.userData, hologramPatched: true };
      mat.needsUpdate = true;
    });

    // Apply clipping plane if already computed
    if (this._clippingPlane) {
      const mats = Array.isArray(material) ? material : [material];
      mats.forEach((m) => {
        m.clippingPlanes = [this._clippingPlane];
        m.clipShadows = true;
      });
    }
  }

  /*
  _createWireframeOverlay(mesh) {
    // Double-check mesh/material names to avoid overlaying eyes
    const name = (mesh.name || '').toLowerCase();
    const matName = (mesh.material && mesh.material.name) ? String(mesh.material.name).toLowerCase() : '';
    if (name.includes('eye') || name.includes('iris') || matName.includes('eye') || matName.includes('iris')) {
      // skip overlay for eye meshes
      return;
    }

    // Use MeshStandardMaterial and enable skinning/morphTargets explicitly after construction
    const wireMaterial = new THREE.MeshStandardMaterial({
      color: 0x00c8f0,
      wireframe: true,
      transparent: true,
      opacity: 0.32, // further reduce visual dominance
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      side: THREE.FrontSide,
      emissive: new THREE.Color(0x00c8f0),
      emissiveIntensity: 0.6,
    });
    // Set advanced flags explicitly to avoid setValues warnings
    wireMaterial.skinning = true;
    wireMaterial.morphTargets = true;
    // Reduce overlay dominance further
    wireMaterial.opacity = 0.22;
    wireMaterial.emissiveIntensity = 0.35;

    const overlay = new THREE.SkinnedMesh(mesh.geometry, wireMaterial);
    overlay.bind(mesh.skeleton, mesh.bindMatrix);
    overlay.morphTargetInfluences = mesh.morphTargetInfluences;
    overlay.morphTargetDictionary = mesh.morphTargetDictionary;
    overlay.frustumCulled = false;
    overlay.renderOrder = 2;
    overlay.castShadow = false;
    overlay.receiveShadow = false;

    if (mesh.parent) {
      mesh.parent.add(overlay);
      this._overlays.push(overlay);
    }

    // If clipping plane exists, apply to overlay material
    if (this._clippingPlane) {
      overlay.material.clippingPlanes = [this._clippingPlane];
      overlay.material.clipShadows = true;
    }
  }
  */

  _createCircuitOverlay(mesh) {
    console.log('[OrbRenderer] _createCircuitOverlay CALLED for', mesh && mesh.name);
    try {
    // Rebuild overlay as a projected geodesic net with styled lines and glowing sprites
    const name = (mesh.name || '').toLowerCase();
    const matName = (mesh.material && mesh.material.name) ? String(mesh.material.name).toLowerCase() : '';
    if (name.includes('eye') || name.includes('iris') || matName.includes('eye') || matName.includes('iris')) return;

    // Remove existing overlays for this mesh
    if (this._overlays && this._overlays.length) {
      const toRemove = [];
      this._overlays.forEach((ov) => {
        if (ov.parent === mesh || ov.parent === mesh.parent || ov.__ownerMesh === mesh) {
          if (ov.parent) ov.parent.remove(ov);
          // dispose geometry/material where safe to avoid GPU memory leaks
          try {
            if (ov.geometry) {
              ov.geometry.dispose();
            }
          } catch (e) {
            // ignore
          }
          try {
            const mat = ov.material;
            if (mat) {
              if (Array.isArray(mat)) {
                mat.forEach(m => { try { if (m.map && m.map !== this._pointSpriteTexture) m.map.dispose(); } catch(e){}; try{ m.dispose(); }catch(e){} });
              } else {
                try { if (mat.map && mat.map !== this._pointSpriteTexture) mat.map.dispose(); } catch (e) {}
                try { mat.dispose(); } catch (e) {}
              }
            }
          } catch (e) {
            // ignore
          }
          toRemove.push(ov);
        }
      });
      this._overlays = this._overlays.filter(o => !toRemove.includes(o));
    }

    // If there was a previous baked geometry for this skinned mesh from an older overlay, dispose it
    try {
      if (mesh.userData && mesh.userData._bakedOverlayGeometry) {
        try { mesh.userData._bakedOverlayGeometry.dispose(); } catch (e) {}
        delete mesh.userData._bakedOverlayGeometry;
      }
      if (mesh.userData && mesh.userData._bakedOverlayMesh) {
        try { if (mesh.userData._bakedOverlayMesh.material) mesh.userData._bakedOverlayMesh.material.dispose(); } catch (e) {}
        delete mesh.userData._bakedOverlayMesh;
      }
    } catch (e) {
      // ignore
    }

    // Ensure geometry has bounding sphere
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const bs = mesh.geometry.boundingSphere;

    // Compute world-scaled radius to account for parent/model scaling (VRM models often scaled via modelGroup)
    const worldScaleVec = new THREE.Vector3();
    mesh.getWorldScale(worldScaleVec);
    const maxWorldScale = Math.max(worldScaleVec.x, worldScaleVec.y, worldScaleVec.z) || 1.0;
    const projectionRadiusFactor = 0.90; // smaller factor to keep plexus close to skin (tweak 0.85-0.92)
    const worldRadius = bs.radius * maxWorldScale * projectionRadiusFactor;

    // Debug bounding info to detect shared buffers / incorrect bounding spheres
    console.log('[OrbRenderer] bounding debug', {
      meshName: mesh.name,
      bsRadius: bs.radius,
      bsCenter: bs.center.toArray(),
      worldRadius,
      vertexCount: mesh.geometry.getAttribute('position').count,
      drawRange: mesh.geometry.drawRange ? { start: mesh.geometry.drawRange.start, count: mesh.geometry.drawRange.count } : null,
      groups: mesh.geometry.groups && mesh.geometry.groups.length ? mesh.geometry.groups.map(g=>({start:g.start,count:g.count,materialIndex:g.materialIndex})) : null,
      hasIndex: !!mesh.geometry.index,
      indexCount: mesh.geometry.index ? mesh.geometry.index.count : null,
    });

    // Create an icosahedron (geodesic) used only for directions; use unit radius and normalize directions
    let detail = 3; // density (reduced to avoid dome effect)
    detail = Math.min(5, Math.max(2, detail));
    const ico = new THREE.IcosahedronGeometry(1.0, detail);
    const icoPos = ico.getAttribute('position');

    const raycaster = new THREE.Raycaster();
    // Use the bounding sphere center transformed to world space — more accurate for skinned meshes
    const worldCenter = bs.center.clone();
    mesh.localToWorld(worldCenter);

    // If mesh is skinned, build (and cache) a CPU-baked geometry & temp mesh for raycasting
    let raycastTarget = mesh;
    if (mesh.isSkinnedMesh) {
      try {
        if (!mesh.userData._bakedOverlayGeometry) {
          const srcPos = mesh.geometry.getAttribute('position');
          const skinned = new Float32Array(srcPos.count * 3);
          const tmpPos = new THREE.Vector3();
          for (let vi = 0; vi < srcPos.count; vi++) {
            tmpPos.fromBufferAttribute(srcPos, vi);
            // Apply skinning transform for this vertex. Newer Three versions use applyBoneTransform
            if (typeof mesh.applyBoneTransform === 'function') {
              mesh.applyBoneTransform(vi, tmpPos);
            } else if (typeof mesh.boneTransform === 'function') {
              mesh.boneTransform(vi, tmpPos);
            } else {
              // Fallback: skeleton.pose() may align bones to bind pose but does not bake vertex positions.
              // Keep tmpPos as-is and log so we can detect this case in tests.
              console.warn('[OrbRenderer] warning: no mesh.applyBoneTransform/boneTransform available for', mesh.name, '- falling back to identity vertex (overlay may be incorrect)');
            }
            skinned[vi * 3] = tmpPos.x;
            skinned[vi * 3 + 1] = tmpPos.y;
            skinned[vi * 3 + 2] = tmpPos.z;
          }
          const bakedGeo = new THREE.BufferGeometry();
          bakedGeo.setAttribute('position', new THREE.Float32BufferAttribute(skinned, 3));
          if (mesh.geometry.index) bakedGeo.setIndex(mesh.geometry.index.array.slice());
          bakedGeo.computeBoundingSphere();
          mesh.userData._bakedOverlayGeometry = bakedGeo;
        }

        if (!mesh.userData._bakedOverlayMesh) {
          const mat = new THREE.MeshBasicMaterial({ visible: false });
          const tmpMesh = new THREE.Mesh(mesh.userData._bakedOverlayGeometry, mat);
          tmpMesh.matrixAutoUpdate = false;
          mesh.userData._bakedOverlayMesh = tmpMesh;
        }

        // ensure temp mesh world matrix matches skinned mesh
        const bakedMesh = mesh.userData._bakedOverlayMesh;
        bakedMesh.matrixWorld.copy(mesh.matrixWorld);

        // Diagnostic: compare sample baked vertex world positions vs applying mesh transforms
        try {
          const bakedGeo = bakedMesh.geometry;
          const posAttr = bakedGeo.getAttribute('position');
          const vcount = posAttr.count;
          const sampleIdx = [0, Math.floor(vcount/2), Math.max(0, vcount-1)];
          const samples = sampleIdx.map(idx => {
            const lp = new THREE.Vector3().fromBufferAttribute(posAttr, idx);
            const worldFromBaked = lp.clone();
            bakedMesh.localToWorld(worldFromBaked);
            const worldFromMesh = lp.clone();
            mesh.localToWorld(worldFromMesh);
            return {
              idx,
              local: lp.toArray(),
              worldFromBaked: worldFromBaked.toArray(),
              worldFromMesh: worldFromMesh.toArray(),
            };
          });

          console.log('[OrbRenderer] baked-geo diagnostic', {
            meshName: mesh.name,
            bakedMeshMatrixWorld: bakedMesh.matrixWorld.elements ? bakedMesh.matrixWorld.elements.slice(0,16) : null,
            meshMatrixWorld: mesh.matrixWorld.elements ? mesh.matrixWorld.elements.slice(0,16) : null,
            samples,
            skeletonPresent: !!mesh.skeleton,
            boneCount: mesh.skeleton ? mesh.skeleton.bones.length : 0,
          });
        } catch (diagErr) {
          console.warn('[OrbRenderer] baked-geo diagnostic failed for', mesh.name, diagErr && diagErr.message);
        }

        raycastTarget = bakedMesh;
      } catch (err) {
        try {
          console.error('[OrbRenderer] failed to create baked overlay geometry for skinned mesh', mesh.name, err && err.message, err && err.stack);
        } catch (logErr) {
          console.error('[OrbRenderer] failed to create baked overlay geometry (and failed to log error object)', mesh.name, logErr);
        }
        raycastTarget = mesh; // fallback
      }
    }

    // Diagnostic pass: compare the mesh's normal front-face raycast behaviour
    // with DoubleSide. The latter is used for the actual projection so faces
    // whose winding points away from the ray do not become artificial fallbacks.
    const raycastMaterial = !Array.isArray(raycastTarget.material) ? raycastTarget.material : null;
    const originalRaycastSide = raycastMaterial?.side;
    const canCompareSides = typeof originalRaycastSide === 'number';
    let frontSideHits = 0;
    let doubleSideHits = 0;

    const hitPoints = new Array(icoPos.count);
    const tmpVec = new THREE.Vector3();
    const tmpDir = new THREE.Vector3();

    for (let i = 0; i < icoPos.count; i++) {
      tmpVec.fromBufferAttribute(icoPos, i);
      tmpDir.copy(tmpVec).normalize();

      // Compute world-space direction from ico local direction
      const q = new THREE.Quaternion();
      mesh.getWorldQuaternion(q);
      const tmpDirWorld = tmpDir.clone().applyQuaternion(q).normalize();

      // Raycast: use an origin outside the bounding sphere and cast back towards the center
      // This improves hits for partially open meshes (e.g., face meshes missing back-of-head geometry)
      const rayOrigin = worldCenter.clone().add(tmpDirWorld.clone().multiplyScalar(worldRadius * 1.5));
      const rayDirection = tmpDirWorld.clone().negate();
      raycaster.set(rayOrigin, rayDirection);

      if (canCompareSides) raycastMaterial.side = THREE.FrontSide;
      const frontIntersects = raycaster.intersectObject(raycastTarget, true);
      if (frontIntersects.length > 0) frontSideHits += 1;

      if (canCompareSides) raycastMaterial.side = THREE.DoubleSide;
      const intersects = raycaster.intersectObject(raycastTarget, true);
      if (intersects.length > 0) doubleSideHits += 1;

      if (intersects && intersects.length > 0) {
        const p = intersects[0].point.clone();
        // Use the original mesh's local space for overlay placement
        mesh.worldToLocal(p);
        hitPoints[i] = p;
      }
    }

    if (canCompareSides) raycastMaterial.side = originalRaycastSide;

    // Keep only triangles whose three geodesic directions hit the real face.
    // This deliberately removes the old spherical fallback for a clean visual
    // diagnosis: no hit means no node and no line.
    const projectedVerts = [];
    const projectedIndices = [];
    const pointIndex = new Map();
    const addHitPoint = (sourceIndex) => {
      let index = pointIndex.get(sourceIndex);
      if (index === undefined) {
        const point = hitPoints[sourceIndex];
        index = projectedVerts.length / 3;
        pointIndex.set(sourceIndex, index);
        projectedVerts.push(point.x, point.y, point.z);
      }
      return index;
    };
    const sourceIndices = ico.index ? ico.index.array : null;
    const sourceCount = sourceIndices ? sourceIndices.length : icoPos.count;
    let retainedTriangles = 0;
    for (let sourceOffset = 0; sourceOffset < sourceCount; sourceOffset += 3) {
      const a = sourceIndices ? sourceIndices[sourceOffset] : sourceOffset;
      const b = sourceIndices ? sourceIndices[sourceOffset + 1] : sourceOffset + 1;
      const c = sourceIndices ? sourceIndices[sourceOffset + 2] : sourceOffset + 2;
      if (!hitPoints[a] || !hitPoints[b] || !hitPoints[c]) continue;
      projectedIndices.push(addHitPoint(a), addHitPoint(b), addHitPoint(c));
      retainedTriangles += 1;
    }

    console.log('[OrbRenderer] raycast coverage', {
      meshName: mesh.name,
      totalRays: icoPos.count,
      frontSideHits,
      doubleSideHits,
      recoveredByDoubleSide: doubleSideHits - frontSideHits,
      fallbacksRemoved: icoPos.count - doubleSideHits,
      retainedTriangles,
      totalTriangles: sourceCount / 3,
      usedBaked: !!mesh.isSkinnedMesh,
    });

    if (retainedTriangles === 0) {
      console.warn('[OrbRenderer] no projected triangles; fallback sphere intentionally disabled');
      return;
    }

    const projectedGeo = new THREE.BufferGeometry();
    projectedGeo.setAttribute('position', new THREE.Float32BufferAttribute(projectedVerts, 3));
    projectedGeo.setIndex(projectedIndices);

    // Build wireframe segments and classify by radial distance for inner/outer fade
    const wire = new THREE.WireframeGeometry(projectedGeo);
    const posAttr = wire.getAttribute('position');
    const positions = posAttr.array;
    const totalSegments = positions.length / 6;

    const innerPositions = [];
    const outerPositions = [];
    const innerPoints = [];
    const outerPoints = [];

    projectedGeo.computeBoundingSphere();
    const centerSphere = projectedGeo.boundingSphere.center;
    const maxR = projectedGeo.boundingSphere.radius;

    // Debug: log bounding sphere used for inner/outer classification
    // debug: bounding sphere computed for classification (removed verbose logging)

    // More tolerant thresholds — some projected midpoints may lie slightly outside bounding sphere due to projection/fallbacks
    const threshInnerFactor = 0.7; // inner region (stronger lines & more points)
    const threshOuterFactor = 1.05; // outer region (softer lines)
    const threshInner = maxR * threshInnerFactor;
    const threshOuter = maxR * threshOuterFactor;

    for (let s = 0; s < totalSegments; s++) {
      const base = s * 6;
      const x1 = positions[base], y1 = positions[base+1], z1 = positions[base+2];
      const x2 = positions[base+3], y2 = positions[base+4], z2 = positions[base+5];
      const mx = (x1 + x2) * 0.5, my = (y1 + y2) * 0.5, mz = (z1 + z2) * 0.5;
      const dx = mx - centerSphere.x, dy = my - centerSphere.y, dz = mz - centerSphere.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

      // only log the first segment sample in debug mode (kept minimal)
      if (s === 0) {
        console.log('[OrbRenderer] segment sample', { s, mx, my, mz, dist, threshInner, threshOuter });
      }

      if (dist < threshInner) {
        innerPositions.push(x1,y1,z1,x2,y2,z2);
        if ((s % 3) === 0) innerPoints.push(mx,my,mz);
      } else if (dist < threshOuter) {
        outerPositions.push(x1,y1,z1,x2,y2,z2);
        if ((s % 6) === 0) outerPoints.push(mx,my,mz);
      }
    }

    // Fallback sampling: if filtering produced nothing (too strict), sample every Nth segment to guarantee some visuals
    if (innerPositions.length === 0 && outerPositions.length === 0) {
      console.warn('[OrbRenderer] overlay classification produced zero segments — falling back to uniform sampling');
      const stride = Math.max(2, Math.floor(totalSegments / 120)); // aim for ~120 segments max
      for (let s = 0; s < totalSegments; s += stride) {
        const base = s * 6;
        const x1 = positions[base], y1 = positions[base+1], z1 = positions[base+2];
        const x2 = positions[base+3], y2 = positions[base+4], z2 = positions[base+5];
        outerPositions.push(x1,y1,z1,x2,y2,z2);
        const mx = (x1 + x2) * 0.5, my = (y1 + y2) * 0.5, mz = (z1 + z2) * 0.5;
        outerPoints.push(mx,my,mz);
      }
    }

    const innerLineGeo = new THREE.BufferGeometry();
    const outerLineGeo = new THREE.BufferGeometry();
    if (innerPositions.length) innerLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(innerPositions, 3));
    if (outerPositions.length) outerLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outerPositions, 3));

    const innerPointGeo = new THREE.BufferGeometry();
    const outerPointGeo = new THREE.BufferGeometry();
    if (innerPoints.length) innerPointGeo.setAttribute('position', new THREE.Float32BufferAttribute(innerPoints, 3));
    if (outerPoints.length) outerPointGeo.setAttribute('position', new THREE.Float32BufferAttribute(outerPoints, 3));

    const primaryColor = 0x00F0FF; // cyan blue
    const innerLineMat = new THREE.LineBasicMaterial({ color: primaryColor, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const outerLineMat = new THREE.LineBasicMaterial({ color: primaryColor, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });

    if (!this._pointSpriteTexture) {
      const size = 64;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
      grad.addColorStop(0,'rgba(255,255,255,1)');
      grad.addColorStop(0.08,'rgba(0,240,255,0.98)');
      grad.addColorStop(0.22,'rgba(0,240,255,0.55)');
      grad.addColorStop(0.5,'rgba(0,240,255,0.12)');
      grad.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
      this._pointSpriteTexture = new THREE.CanvasTexture(canvas);
    }

    const innerPointMat = new THREE.SpriteMaterial({ map: this._pointSpriteTexture, color: primaryColor, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false });
    const outerPointMat = new THREE.SpriteMaterial({ map: this._pointSpriteTexture, color: primaryColor, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false });

    const innerLines = innerPositions.length ? new THREE.LineSegments(innerLineGeo, innerLineMat) : null;
    const outerLines = outerPositions.length ? new THREE.LineSegments(outerLineGeo, outerLineMat) : null;

    const createSpritesFromPositions = (posArray, mat, ownerMesh, scaleBase) => {
      const sprites = [];
      for (let i = 0; i < posArray.length; i += 3) {
        const sx = posArray[i], sy = posArray[i+1], sz = posArray[i+2];
        const sprite = new THREE.Sprite(mat.clone());
        sprite.position.set(sx, sy, sz);
        const r = 0.85 + (Math.random() * 0.4); // reduce variance so sprites are small and consistent
        sprite.scale.setScalar(scaleBase * r);
        sprite.__ownerMesh = ownerMesh;
        sprites.push(sprite);
      }
      return sprites;
    };

    // Use smaller base sprite sizes to reduce strong blob look
    const spritesInner = innerPoints.length ? createSpritesFromPositions(innerPoints, innerPointMat, mesh, 0.04) : [];
    const spritesOuter = outerPoints.length ? createSpritesFromPositions(outerPoints, outerPointMat, mesh, 0.03) : [];

    let createdLineCount = 0;
    if (innerLines) { innerLines.frustumCulled = false; mesh.add(innerLines); this._overlays.push(innerLines); createdLineCount += (innerLines.geometry ? (innerLines.geometry.getAttribute('position').count / 2) : 0); }
    if (outerLines) { outerLines.frustumCulled = false; mesh.add(outerLines); this._overlays.push(outerLines); createdLineCount += (outerLines.geometry ? (outerLines.geometry.getAttribute('position').count / 2) : 0); }
    spritesInner.forEach(s => { mesh.add(s); this._overlays.push(s); });
    spritesOuter.forEach(s => { mesh.add(s); this._overlays.push(s); });

    const spriteCount = spritesInner.length + spritesOuter.length;
    // Debug logging: counts to help diagnose missing overlay
    console.log('[OrbRenderer] _createCircuitOverlay created:', {
      projectedVertices: projectedVerts.length / 3,
      totalSegments,
      createdLineCount,
      spriteCount,
      innerPoints: innerPoints.length / 3,
      outerPoints: outerPoints.length / 3,
    });

    // Apply clipping plane if needed
    if (this._clippingPlane) {
      if (innerLineMat) { innerLineMat.clippingPlanes = [this._clippingPlane]; innerLineMat.clipShadows = true; }
      if (outerLineMat) { outerLineMat.clippingPlanes = [this._clippingPlane]; outerLineMat.clipShadows = true; }
      innerPointMat.clippingPlanes = [this._clippingPlane]; innerPointMat.clipShadows = true;
      outerPointMat.clippingPlanes = [this._clippingPlane]; outerPointMat.clipShadows = true;
    }
  } catch (err) {
      console.error('[OrbRenderer] _createCircuitOverlay CRASHED for mesh', mesh && mesh.name, err);
    }
  }

  _setupScanline() {
    this.scanlineMat = new THREE.ShaderMaterial({
      uniforms: {
        uScanY: { value: -2.0 },
        uColor: { value: new THREE.Color(0xaaffff) },
      },
      vertexShader: scanlineVertex,
      fragmentShader: scanlineFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });

    const plane = new THREE.PlaneGeometry(1.6, 1.6); // smaller so it affects mostly the face and reduce dome effect
    this.scanlinePlane = new THREE.Mesh(plane, this.scanlineMat);
    this.scanlinePlane.renderOrder = 5;
    this.scanlinePlane.position.set(0, 1.15, 0.6); // slightly closer and lower
    this.scanlinePlane.rotation.x = -0.15;
    this.modelGroup.add(this.scanlinePlane);

    // ensure scanline is clipped if necessary
    if (this._clippingPlane) {
      this.scanlineMat.clippingPlanes = [this._clippingPlane];
      this.scanlineMat.clipShadows = true;
    }
  }

  setExpression(name, weight = 1) {
    if (!this.vrm?.expressionManager?.setValue) return;
    this.vrm.expressionManager.setValue(name, weight);
  }

  setViseme(viseme, weight) {
    return this.setExpression(viseme, weight);
  }

  // Apply current clipping plane to all relevant materials/overlays
  _applyClippingPlaneToMaterials() {
    if (!this._clippingPlane) return;

    // Apply to main meshes
    this.vrm.scene.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          m.clippingPlanes = [this._clippingPlane];
          m.clipShadows = true;
        });
      }
    });

    // Overlays
    this._overlays.forEach((ov) => {
      if (ov.material) {
        ov.material.clippingPlanes = [this._clippingPlane];
        ov.material.clipShadows = true;
      }
    });

    // Scanline
    if (this.scanlineMat) {
      this.scanlineMat.clippingPlanes = [this._clippingPlane];
      this.scanlineMat.clipShadows = true;
    }
  }

  blink() {
    if (!this.vrm?.expressionManager?.setValue) return;

    this.vrm.expressionManager.setValue('blink', 1);
    if (this.blinkResetHandle) {
      clearTimeout(this.blinkResetHandle);
    }
    this.blinkResetHandle = setTimeout(() => {
      if (this.vrm?.expressionManager?.setValue) {
        this.vrm.expressionManager.setValue('blink', 0);
      }
      this.blinkResetHandle = null;
    }, 150);

    this._scheduleNextBlink();
  }

  setSpeaking(isSpeaking) {
    this.isSpeaking = isSpeaking;
  }

  isReady() {
    return this.modelLoaded && !this.error;
  }

  draw() {
    try {
      const rect = this.canvas.getBoundingClientRect();
      if (this.canvas.width !== rect.width || this.canvas.height !== rect.height) {
        this.renderer.setSize(rect.width, rect.height, false);
        this.camera.aspect = rect.width / rect.height;
        this.camera.updateProjectionMatrix();
      }

      const t = Date.now();
      const delta = this.clock.getDelta();

      if (this.vrm) {
        this.vrm.update(delta);

        if (Date.now() >= this.nextBlinkAt) {
          this.blink();
        }

        const headBone = this.vrm.humanoid?.getNormalizedBoneNode('head');
        if (headBone) {
          const oscSpeed = this.isSpeaking ? 0.0025 : 0.001;
          const maxAngle = this.isSpeaking
            ? (10 * Math.PI) / 180
            : (5 * Math.PI) / 180;
          headBone.rotation.y = Math.sin(t * oscSpeed) * maxAngle;
        }
      }

      if (this.scanlineMat) {
        const scanCycle = 4000;
        const scanPhase = (t % scanCycle) / scanCycle;
        this.scanlineMat.uniforms.uScanY.value = -2.0 + scanPhase * 4.0;
      }

      this.renderer.render(this.scene, this.camera);
    } catch (err) {
      console.error('❌ Erro no draw loop:', err);
    }

    requestAnimationFrame(this.draw);
  }
}
