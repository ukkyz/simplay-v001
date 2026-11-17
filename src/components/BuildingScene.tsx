"use client";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useEffect, useRef } from "react";
import { ZONE_META } from "@/game/constants";
import type { FloorPlan, PropKind, ZoneKind } from "@/game/types";
import { isSolid } from "@/game/plans";

export type SceneMode = "preview" | "fps" | "tps";

export interface NpcSpec {
  id: string;
  name: string;
  role: "security" | "reception";
  line: string;
}

interface Props {
  plan: FloorPlan;
  mode: SceneMode;
  npcs: NpcSpec[];
  owner?: string;
  onPrompt?: (text: string | null) => void;
  onTalk?: (npc: NpcSpec) => void;
  onTelemetry?: (t: { x: number; z: number; yaw: number; fps: number }) => void;
}

const EYE = 1.7; // GDD §11 q9: 1:1 metres, 2.9 m ceiling, 1.7 m eye height
const CEIL = 2.9;
const RADIUS = 0.32;

const PROP_GEO: Record<PropKind, { c: number; s: [number, number, number]; y: number }> = {
  desk: { c: 0x8a6a45, s: [0.85, 0.06, 0.5], y: 0.74 },
  rack: { c: 0x1d3b4a, s: [0.62, 1.9, 0.9], y: 0.95 },
  machine: { c: 0xc2703a, s: [1.1, 1.25, 1.0], y: 0.62 },
  tank: { c: 0x6f7f86, s: [0.85, 1.7, 0.85], y: 0.85 },
  console: { c: 0x2f6f68, s: [1.3, 0.95, 0.45], y: 0.47 },
  crate: { c: 0x9a7b4f, s: [0.72, 0.72, 0.72], y: 0.36 },
  planter: { c: 0x4d8b3a, s: [0.8, 0.62, 0.8], y: 0.31 },
  bunk: { c: 0x5b6d8a, s: [0.9, 0.5, 1.9], y: 0.25 },
};

function makeLabel(text: string, color: string): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "rgba(7,13,16,.86)";
  g.fillRect(0, 34, 512, 60);
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.strokeRect(0, 34, 512, 60);
  g.fillStyle = color;
  g.font = "600 40px 'IBM Plex Mono', monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text.toUpperCase(), 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(2.1, 0.52, 1);
  return sp;
}

function npcMesh(n: NpcSpec): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.26, 0.72, 4, 10),
    new THREE.MeshStandardMaterial({ color: n.role === "security" ? 0x2b3a42 : 0x2f4b4a, roughness: 0.55, metalness: 0.35 }),
  );
  body.position.y = 0.86;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.3, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.35, metalness: 0.6 }),
  );
  head.position.y = 1.5;
  head.castShadow = true;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.02),
    new THREE.MeshBasicMaterial({ color: n.role === "security" ? 0xff6a55 : 0x35d6c0 }),
  );
  visor.position.set(0, 1.52, 0.17);
  const shoulder = new THREE.Mesh(
    new THREE.BoxGeometry(0.66, 0.12, 0.3),
    new THREE.MeshStandardMaterial({ color: n.role === "security" ? 0xff6a55 : 0x35d6c0, roughness: 0.5 }),
  );
  shoulder.position.y = 1.22;
  const label = makeLabel(n.name, n.role === "security" ? "#ff6a55" : "#35d6c0");
  label.position.y = 2.05;
  g.add(body, head, visor, shoulder, label);
  g.userData = { visor, head, label, base: 0 };
  return g;
}

function playerMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.27, 0.78, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0x1b2f36, roughness: 0.6 }),
  );
  body.position.y = 0.9;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9c3a5, roughness: 0.75 }),
  );
  head.position.y = 1.55;
  head.castShadow = true;
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.9, 0.5),
    new THREE.MeshBasicMaterial({ color }),
  );
  stripe.position.set(0, 1.0, 0);
  g.add(body, head, stripe);
  return g;
}

export default function BuildingScene({ plan, mode, npcs, owner, onPrompt, onTalk, onTelemetry }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const api = useRef<{
    renderer?: THREE.WebGLRenderer;
    scene?: THREE.Scene;
    camera?: THREE.PerspectiveCamera;
    orbit?: OrbitControls;
    player?: THREE.Group;
    npcObjs?: THREE.Group[];
    ceiling?: THREE.Group;
    pos?: THREE.Vector3;
    yaw?: number;
    pitch?: number;
    keys?: Record<string, boolean>;
    dragging?: boolean;
    raf?: number;
  }>({});
  const modeRef = useRef<SceneMode>(mode);
  const cbRef = useRef({ onPrompt, onTalk, onTelemetry, npcs });
  cbRef.current = { onPrompt, onTalk, onTelemetry, npcs };
  modeRef.current = mode;

  // ---------------- build the scene from the plan ----------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const a = api.current;
    const W = plan.w;
    const H = plan.h;
    const ox = -W / 2;
    const oz = -H / 2;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = "crosshair";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1418);
    scene.fog = new THREE.Fog(0x0a1418, 42, 165);

    const camera = new THREE.PerspectiveCamera(64, host.clientWidth / host.clientHeight, 0.08, 420);
    camera.position.set(W * 0.9, Math.max(W, H) * 0.85, H * 1.15);

    // lights
    scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x16262b, 0.62));
    const sun = new THREE.DirectionalLight(0xffe6bd, 1.35);
    sun.position.set(W * 0.8, 34, H * 0.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const span = Math.max(W, H) * 1.2;
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0012;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7fd8ff, 0.32);
    fill.position.set(-W, 12, -H);
    scene.add(fill);

    // terrain + pad
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x14232a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(400, 200, 0x1e4048, 0x16303a);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.32;
    grid.position.y = -0.1;
    scene.add(grid);
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(W + 8, 0.16, H + 8),
      new THREE.MeshStandardMaterial({ color: 0x22343b, roughness: 0.95 }),
    );
    pad.position.y = -0.06;
    pad.receiveShadow = true;
    scene.add(pad);

    // ---- floors (instanced, coloured by zone) ----
    const floorCells: { x: number; z: number; z2: ZoneKind }[] = [];
    const wallCells: { x: number; z: number }[] = [];
    const doorCells: { x: number; z: number }[] = [];
    const glassCells: { x: number; z: number }[] = [];
    const propCells: { x: number; z: number; p: PropKind }[] = [];
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const c = plan.cells[z * W + x];
        if (c.t === 1) {
          floorCells.push({ x, z, z2: (c.z ?? "corridor") as ZoneKind });
          if (c.p) propCells.push({ x, z, p: c.p });
        } else if (c.t === 2) wallCells.push({ x, z });
        else if (c.t === 3) doorCells.push({ x, z });
        else if (c.t === 4) glassCells.push({ x, z });
      }

    const floorGeo = new THREE.BoxGeometry(1.005, 0.12, 1.005);
    const floorMat = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0.04 });
    const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, Math.max(1, floorCells.length));
    floorMesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    floorCells.forEach((f, i) => {
      m4.setPosition(ox + f.x + 0.5, 0.06, oz + f.z + 0.5);
      floorMesh.setMatrixAt(i, m4);
      floorMesh.setColorAt(i, col.set(ZONE_META[f.z2].color));
    });
    floorMesh.instanceMatrix.needsUpdate = true;
    if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
    scene.add(floorMesh);

    // ---- walls ----
    const wallGeo = new THREE.BoxGeometry(1.02, CEIL, 1.02);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x9fb0b4, roughness: 0.82, metalness: 0.06 });
    const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, Math.max(1, wallCells.length));
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    wallCells.forEach((w, i) => {
      m4.setPosition(ox + w.x + 0.5, CEIL / 2, oz + w.z + 0.5);
      wallMesh.setMatrixAt(i, m4);
      const edge = w.x === 0 || w.z === 0 || w.x === W - 1 || w.z === H - 1;
      wallMesh.setColorAt(i, col.set(edge ? 0x7d8f95 : 0xb6c5c8));
    });
    wallMesh.instanceMatrix.needsUpdate = true;
    if (wallMesh.instanceColor) wallMesh.instanceColor.needsUpdate = true;
    scene.add(wallMesh);

    // ---- glazing ----
    if (glassCells.length) {
      const gGeo = new THREE.BoxGeometry(1.0, CEIL * 0.92, 0.14);
      const gMat = new THREE.MeshPhysicalMaterial({
        color: 0x9fd8ff,
        transparent: true,
        opacity: 0.26,
        roughness: 0.08,
        metalness: 0.1,
      });
      const gMesh = new THREE.InstancedMesh(gGeo, gMat, glassCells.length);
      glassCells.forEach((w, i) => {
        m4.setPosition(ox + w.x + 0.5, CEIL * 0.46, oz + w.z + 0.5);
        gMesh.setMatrixAt(i, m4);
      });
      gMesh.instanceMatrix.needsUpdate = true;
      scene.add(gMesh);
    }

    // ---- doors: lintel + frame ----
    const doorGroup = new THREE.Group();
    doorCells.forEach((d) => {
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(1.02, CEIL - 2.15, 1.02),
        new THREE.MeshStandardMaterial({ color: 0x6d7f85, roughness: 0.85 }),
      );
      lintel.position.set(ox + d.x + 0.5, 2.15 + (CEIL - 2.15) / 2, oz + d.z + 0.5);
      lintel.castShadow = true;
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(1.04, 0.05, 0.1),
        new THREE.MeshBasicMaterial({ color: 0xf2a33c }),
      );
      strip.position.set(ox + d.x + 0.5, 2.12, oz + d.z + 0.5);
      doorGroup.add(lintel, strip);
    });
    scene.add(doorGroup);

    // ---- props ----
    const propGroups = new Map<PropKind, THREE.InstancedMesh>();
    propCells.forEach((pc) => {
      const spec = PROP_GEO[pc.p];
      let mesh = propGroups.get(pc.p);
      if (!mesh) {
        const geo = pc.p === "tank" ? new THREE.CylinderGeometry(spec.s[0] / 2, spec.s[0] / 2, spec.s[1], 14) : new THREE.BoxGeometry(...spec.s);
        mesh = new THREE.InstancedMesh(
          geo,
          new THREE.MeshStandardMaterial({ color: spec.c, roughness: 0.62, metalness: pc.p === "rack" || pc.p === "tank" ? 0.5 : 0.12 }),
          propCells.filter((q) => q.p === pc.p).length,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.i = 0;
        propGroups.set(pc.p, mesh);
        scene.add(mesh);
      }
      const i = mesh.userData.i++;
      m4.makeRotationY(((pc.x * 7 + pc.z * 13) % 4) * (Math.PI / 2));
      m4.setPosition(ox + pc.x + 0.5, spec.y, oz + pc.z + 0.5);
      mesh.setMatrixAt(i, m4);
      mesh.instanceMatrix.needsUpdate = true;
    });

    // ---- ceiling + light strips (hidden in orbit preview) ----
    const ceiling = new THREE.Group();
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.18, H),
      new THREE.MeshStandardMaterial({ color: 0x2c3d44, roughness: 0.95 }),
    );
    roof.position.y = CEIL + 0.09;
    roof.castShadow = true;
    ceiling.add(roof);
    const stripGeo = new THREE.BoxGeometry(1.6, 0.06, 0.24);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xfff2d6 });
    const placed: [number, number][] = [];
    for (let z = 2; z < H - 1; z += 4)
      for (let x = 2; x < W - 1; x += 4) {
        if (isSolid(plan, x + 0.5, z + 0.5)) continue;
        if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3.4)) continue;
        placed.push([x, z]);
        const s = new THREE.Mesh(stripGeo, stripMat);
        s.position.set(ox + x + 0.5, CEIL - 0.06, oz + z + 0.5);
        ceiling.add(s);
      }
    const warm = new THREE.PointLight(0xffd9a8, 12, Math.max(W, H) * 1.1, 2);
    warm.position.set(0, CEIL - 0.4, 0);
    ceiling.add(warm);
    scene.add(ceiling);

    // ---- NPCs ----
    const npcObjs: THREE.Group[] = [];
    const lobby = findLobby(plan);
    npcs.forEach((n, i) => {
      const g = npcMesh(n);
      const anchor = n.role === "reception" ? lobby : corridorPoint(plan, i);
      g.position.set(ox + anchor.x, 0.12, oz + anchor.z);
      g.userData.home = { x: anchor.x, z: anchor.z };
      g.userData.spec = n;
      scene.add(g);
      npcObjs.push(g);
    });

    // ---- player ----
    const player = playerMesh(0xf2a33c);
    const spawn = spawnPoint(plan);
    player.position.set(ox + spawn.x, 0.12, oz + spawn.z);
    player.visible = false;
    scene.add(player);
    if (owner) {
      const tag = makeLabel(owner, "#f2a33c");
      tag.position.y = 2.1;
      player.add(tag);
    }

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 1.1, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.07;
    orbit.maxPolarAngle = Math.PI * 0.495;
    orbit.minDistance = 4;
    orbit.maxDistance = Math.max(W, H) * 3.2;
    orbit.update();

    a.renderer = renderer;
    a.scene = scene;
    a.camera = camera;
    a.orbit = orbit;
    a.player = player;
    a.npcObjs = npcObjs;
    a.ceiling = ceiling;
    a.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    a.yaw = Math.PI;
    a.pitch = 0;
    a.keys = {};

    // ------------------------- input -------------------------
    const kd = (e: KeyboardEvent) => {
      a.keys![e.code] = true;
      if (e.code === "KeyE") {
        const near = nearestNpc();
        if (near) cbRef.current.onTalk?.(near.userData.spec as NpcSpec);
      }
      if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => {
      a.keys![e.code] = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    const onCanvasClick = () => {
      if (modeRef.current === "fps" && document.pointerLockElement !== renderer.domElement)
        renderer.domElement.requestPointerLock?.();
    };
    renderer.domElement.addEventListener("click", onCanvasClick);

    const onDown = () => {
      a.dragging = true;
    };
    const onUp = () => {
      a.dragging = false;
    };
    const onMove = (e: MouseEvent) => {
      if (modeRef.current === "fps") {
        if (document.pointerLockElement !== renderer.domElement) return;
        a.yaw! -= e.movementX * 0.0022;
        a.pitch = Math.max(-1.45, Math.min(1.45, a.pitch! - e.movementY * 0.0022));
      } else if (modeRef.current === "tps" && a.dragging) {
        a.yaw! -= e.movementX * 0.005;
        a.pitch = Math.max(-0.5, Math.min(1.1, a.pitch! + e.movementY * 0.004));
      }
    };
    renderer.domElement.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);

    const onResize = () => {
      if (!host.clientWidth) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    // ------------------------- loop -------------------------
    const clock = new THREE.Clock();
    let frames = 0;
    let fpsT = 0;
    let fps = 60;
    let lastPrompt: string | null = null;

    function nearestNpc(): THREE.Group | null {
      let best: THREE.Group | null = null;
      let bd = 2.4;
      for (const n of npcObjs) {
        const d = Math.hypot(n.position.x - player.position.x, n.position.z - player.position.z);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    }

    function tryMove(dx: number, dz: number) {
      const p = a.pos!;
      const nx = p.x + dx;
      const nz = p.z + dz;
      if (!blocked(nx, p.z, plan, W, H)) p.x = nx;
      if (!blocked(p.x, nz, plan, W, H)) p.z = nz;
    }

    function blocked(x: number, z: number, pl: FloorPlan, w: number, h: number) {
      for (const [sx, sz] of [
        [RADIUS, RADIUS],
        [-RADIUS, RADIUS],
        [RADIUS, -RADIUS],
        [-RADIUS, -RADIUS],
      ])
        if (isSolid(pl, x + sx, z + sz) || x + sx < 0.2 || z + sz < 0.2 || x + sx > w - 0.2 || z + sz > h - 0.2) return true;
      return false;
    }

    function animate() {
      a.raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      frames++;
      fpsT += dt;
      if (fpsT > 0.5) {
        fps = Math.round(frames / fpsT);
        frames = 0;
        fpsT = 0;
      }
      const m = modeRef.current;

      // NPC idle animation + patrol
      npcObjs.forEach((n, i) => {
        const spec = n.userData.spec as NpcSpec;
        const home = n.userData.home as { x: number; z: number };
        if (spec.role === "security") {
          const wp = corridorPoint(plan, i + Math.floor(t / 6));
          const tx = ox + wp.x;
          const tz = oz + wp.z;
          n.position.x += (tx - n.position.x) * Math.min(1, dt * 0.9);
          n.position.z += (tz - n.position.z) * Math.min(1, dt * 0.9);
          n.rotation.y = Math.atan2(tx - n.position.x, tz - n.position.z);
        } else {
          n.position.y = 0.12 + Math.sin(t * 1.6) * 0.012;
          n.rotation.y = Math.atan2(player.position.x - n.position.x, player.position.z - n.position.z);
        }
        const ud = n.userData as { visor: THREE.Mesh };
        (ud.visor.material as THREE.MeshBasicMaterial).color.setHex(
          Math.sin(t * 2.4 + i) > 0.2 ? (spec.role === "security" ? 0xff6a55 : 0x35d6c0) : 0x553322,
        );
        void home;
      });

      // player movement
      const k = a.keys!;
      const sprint = k["ShiftLeft"] || k["ShiftRight"];
      const speed = (m === "fps" ? 3.1 : 3.6) * (sprint ? 1.85 : 1);
      let fwd = 0;
      let strafe = 0;
      if (k["KeyW"] || k["ArrowUp"]) fwd += 1;
      if (k["KeyS"] || k["ArrowDown"]) fwd -= 1;
      if (k["KeyD"] || k["ArrowRight"]) strafe += 1;
      if (k["KeyA"] || k["ArrowLeft"]) strafe -= 1;
      if (m !== "preview" && (fwd || strafe)) {
        const len = Math.hypot(fwd, strafe) || 1;
        const yaw = a.yaw!;
        // forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
        const dx = ((-Math.sin(yaw) * fwd + Math.cos(yaw) * strafe) / len) * speed * dt;
        const dz = ((-Math.cos(yaw) * fwd - Math.sin(yaw) * strafe) / len) * speed * dt;
        tryMove(dx, dz);
      }

      const px = ox + a.pos!.x;
      const pz = oz + a.pos!.z;
      player.position.set(px, 0.12 + (fwd || strafe ? Math.abs(Math.sin(t * 9)) * 0.035 : 0), pz);
      player.rotation.y = a.yaw!;
      player.visible = m === "tps";
      ceiling.visible = m !== "preview";

      if (m === "preview") {
        orbit.enabled = true;
        orbit.update();
      } else {
        orbit.enabled = false;
        if (m === "fps") {
          camera.position.set(px, EYE, pz);
          camera.rotation.order = "YXZ";
          camera.rotation.y = a.yaw!;
          camera.rotation.x = a.pitch!;
          camera.rotation.z = 0;
        } else {
          const dist = 4.4;
          const horiz = Math.cos(a.pitch!) * dist;
          camera.position.set(
            px + Math.sin(a.yaw!) * horiz,
            Math.max(0.55, 1.35 + Math.sin(a.pitch!) * dist + 0.9),
            pz + Math.cos(a.yaw!) * horiz,
          );
          camera.lookAt(px, 1.35, pz);
        }
      }

      // proximity prompt
      const near = m === "preview" ? null : nearestNpc();
      const prompt = near ? `E — talk to ${(near.userData.spec as NpcSpec).name}` : null;
      if (prompt !== lastPrompt) {
        lastPrompt = prompt;
        cbRef.current.onPrompt?.(prompt);
      }
      cbRef.current.onTelemetry?.({ x: a.pos!.x, z: a.pos!.z, yaw: a.yaw!, fps });
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(a.raf!);
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      renderer.domElement.removeEventListener("click", onCanvasClick);
      renderer.domElement.removeEventListener("mousedown", onDown);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      orbit.dispose();
      scene.traverse((o) => {
        const any = o as THREE.Mesh;
        if (any.geometry) any.geometry.dispose();
        const mat = any.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      api.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, plan.revision, plan.w, plan.h, npcs.map((n) => n.id).join("|"), owner]);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden bg-ink-950" />;
}

/* --------------------------- plan helpers --------------------------- */

function findLobby(plan: FloorPlan): { x: number; z: number } {
  for (let z = 0; z < plan.h; z++)
    for (let x = 0; x < plan.w; x++) {
      const c = plan.cells[z * plan.w + x];
      if (c.t === 1 && c.z === "lobby") return { x: x + 0.5, z: z + 0.5 };
    }
  return { x: 2.5, z: 2.5 };
}

function spawnPoint(plan: FloorPlan) {
  const l = findLobby(plan);
  return l;
}

function corridorPoint(plan: FloorPlan, seed: number): { x: number; z: number } {
  const pts: { x: number; z: number }[] = [];
  for (let z = 1; z < plan.h - 1; z++)
    for (let x = 1; x < plan.w - 1; x++) {
      const c = plan.cells[z * plan.w + x];
      if (c.t === 1 && (c.z === "corridor" || c.z === "lobby")) pts.push({ x: x + 0.5, z: z + 0.5 });
    }
  if (!pts.length) return findLobby(plan);
  return pts[Math.abs(seed * 7) % pts.length];
}
