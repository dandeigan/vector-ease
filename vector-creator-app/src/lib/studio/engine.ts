import {
  ActiveSelection, Canvas, FabricImage, FabricObject, Group, Path, Point, util,
} from "fabric";
import { buildSvg } from "./export-svg";
import { textToPath } from "./fonts";
import { ellipsePath, heartPath, multiply, rectPath, starPath, translate } from "./geometry";
import { DEFAULT_LAYERS, LAYER_PALETTE, newLayerId } from "./layers";
import type { ImportedDesign, LayerOperation, Matrix, StudioLayer, StudioTextSettings } from "./types";

/** Custom properties saved with every object (undo, autosave, duplicate). */
const PROPS = ["layerId", "studioText", "studioName"];
const AUTOSAVE_KEY = "vectorease-studio-v1";
const SCREEN_STROKE_MM = 0.35;
const MAX_HISTORY = 60;

export type ShapeKind = "rect" | "circle" | "heart" | "star";

export interface SelectionInfo {
  count: number;
  kind: "none" | "text" | "shape" | "group" | "image" | "multi";
  layerId: string | null; // null = mixed or nothing
  text: StudioTextSettings | null;
  widthMm: number;
  heightMm: number;
  name: string | null;
}

export interface LayerWithCount extends StudioLayer {
  count: number;
}

export interface EngineState {
  layers: LayerWithCount[];
  selection: SelectionInfo;
  canUndo: boolean;
  canRedo: boolean;
  board: { w: number; h: number };
  zoomPct: number;
  isEmpty: boolean;
  projectName: string;
}

interface Snapshot {
  board: { w: number; h: number };
  layers: StudioLayer[];
  projectName: string;
  objects: unknown[];
}

// Studio-wide selection handle styling.
Object.assign(FabricObject.ownDefaults, {
  borderColor: "#F5A623",
  cornerColor: "#F5A623",
  cornerStrokeColor: "#080B12",
  cornerStyle: "circle",
  cornerSize: 10,
  transparentCorners: false,
  borderScaleFactor: 1.5,
  padding: 2,
});

const isGroup = (o: FabricObject): o is Group => o instanceof Group && !(o instanceof ActiveSelection);

/** All drawable objects inside an object (recursing into groups / selections). */
function leavesOf(o: FabricObject): FabricObject[] {
  if (o instanceof Group) return o.getObjects().flatMap(leavesOf);
  return [o];
}

/**
 * True size of an object's shapes in mm, ignoring the on-screen line
 * thickness (a 100 mm circle reads 100, not 100.35).
 */
function geometryRect(o: FabricObject) {
  const leaves = leavesOf(o);
  const saved = leaves.map((l) => l.strokeWidth);
  leaves.forEach((l) => { l.strokeWidth = 0; l.setCoords(); });
  const rects = leaves.map((l) => l.getBoundingRect());
  leaves.forEach((l, i) => { l.strokeWidth = saved[i]; l.setCoords(); });
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

export class StudioEngine {
  readonly canvas: Canvas;
  board = { w: 300, h: 300 };
  layers: StudioLayer[] = DEFAULT_LAYERS.map((l) => ({ ...l }));
  projectName = "Untitled design";

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private restoring = false;
  private textToken = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listener: (s: EngineState) => void;

  constructor(el: HTMLCanvasElement, listener: (s: EngineState) => void) {
    this.listener = listener;
    this.canvas = new Canvas(el, {
      preserveObjectStacking: true,
      backgroundColor: "",
      selectionColor: "rgba(245,166,35,0.08)",
      selectionBorderColor: "#F5A623",
      selectionLineWidth: 1,
      uniformScaling: true,
      stopContextMenu: true,
    });

    this.canvas.on("before:render", ({ ctx }) => this.drawBoard(ctx));
    this.canvas.on("object:modified", (e) => this.onModified(e.target));
    this.canvas.on("selection:created", () => this.emit());
    this.canvas.on("selection:updated", () => this.emit());
    this.canvas.on("selection:cleared", () => this.emit());
    this.canvas.on("object:scaling", () => this.emit());
    this.canvas.on("mouse:wheel", (opt) => this.onWheel(opt.e as WheelEvent));
  }

  /* ───────────────────────── lifecycle ───────────────────────── */

  async init(size: { width: number; height: number }) {
    this.resize(size);
    const saved = this.readAutosave();
    if (saved) {
      try {
        await this.restore(saved);
      } catch {
        // Corrupt autosave: start fresh.
      }
    }
    this.undoStack = [this.snapshot()];
    this.zoomToFit();
  }

  dispose() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.canvas.dispose();
  }

  resize({ width, height }: { width: number; height: number }) {
    this.canvas.setDimensions({ width, height });
    this.canvas.requestRenderAll();
  }

  /* ───────────────────────── state ───────────────────────── */

  private leaves(): FabricObject[] {
    return this.canvas.getObjects().flatMap(leavesOf);
  }

  getState(): EngineState {
    const leaves = this.leaves();
    const counts = new Map<string, number>();
    for (const l of leaves) {
      const id = l.layerId as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return {
      layers: this.layers.map((l) => ({ ...l, count: counts.get(l.id) ?? 0 })),
      selection: this.selectionInfo(),
      canUndo: this.undoStack.length > 1,
      canRedo: this.redoStack.length > 0,
      board: { ...this.board },
      zoomPct: Math.round((this.canvas.getZoom() / (96 / 25.4)) * 100),
      isEmpty: this.canvas.getObjects().length === 0,
      projectName: this.projectName,
    };
  }

  private emit() {
    this.listener(this.getState());
  }

  private selectionInfo(): SelectionInfo {
    const active = this.canvas.getActiveObject();
    if (!active) {
      return { count: 0, kind: "none", layerId: null, text: null, widthMm: 0, heightMm: 0, name: null };
    }
    const leafLayers = new Set(leavesOf(active).map((l) => l.layerId as string));
    const rect = geometryRect(active);
    let kind: SelectionInfo["kind"] = "shape";
    if (active instanceof ActiveSelection) kind = "multi";
    else if (isGroup(active)) kind = "group";
    else if (active instanceof FabricImage) kind = "image";
    else if (active.studioText) kind = "text";
    return {
      count: active instanceof ActiveSelection ? active.getObjects().length : 1,
      kind,
      layerId: leafLayers.size === 1 ? [...leafLayers][0] : null,
      text: kind === "text" && active.studioText ? { ...active.studioText } : null,
      widthMm: rect.width,
      heightMm: rect.height,
      name: active.studioName ?? null,
    };
  }

  /* ───────────────────────── history + autosave ───────────────────────── */

  private snapshot(): string {
    const data: Snapshot = {
      board: this.board,
      layers: this.layers,
      projectName: this.projectName,
      objects: (this.canvas.toObject(PROPS) as { objects: unknown[] }).objects,
    };
    return JSON.stringify(data);
  }

  /** Record the current state as an undo step (call after every change). */
  commit() {
    if (this.restoring) return;
    const snap = this.snapshot();
    if (this.undoStack[this.undoStack.length - 1] === snap) {
      this.emit();
      return;
    }
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.scheduleAutosave(snap);
    this.emit();
  }

  private async restore(snap: string) {
    const data = JSON.parse(snap) as Snapshot;
    this.restoring = true;
    try {
      this.board = data.board ?? this.board;
      this.layers = data.layers?.length ? data.layers : DEFAULT_LAYERS.map((l) => ({ ...l }));
      this.projectName = data.projectName ?? this.projectName;
      this.canvas.discardActiveObject();
      await this.canvas.loadFromJSON({ objects: data.objects ?? [] });
      this.canvas.backgroundColor = "";
      this.restyleAll();
    } finally {
      this.restoring = false;
    }
    this.emit();
  }

  async undo() {
    if (this.undoStack.length < 2) return;
    this.redoStack.push(this.undoStack.pop()!);
    const snap = this.undoStack[this.undoStack.length - 1];
    await this.restore(snap);
    this.scheduleAutosave(snap);
  }

  async redo() {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(snap);
    await this.restore(snap);
    this.scheduleAutosave(snap);
  }

  private scheduleAutosave(snap: string) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, snap);
      } catch {
        // Storage full (big images) or blocked: autosave is a convenience only.
      }
    }, 600);
  }

  private readAutosave(): string | null {
    try {
      return localStorage.getItem(AUTOSAVE_KEY);
    } catch {
      return null;
    }
  }

  async newProject() {
    this.canvas.discardActiveObject();
    this.canvas.clear();
    this.canvas.backgroundColor = "";
    this.layers = DEFAULT_LAYERS.map((l) => ({ ...l }));
    this.board = { w: 300, h: 300 };
    this.projectName = "Untitled design";
    this.zoomToFit();
    this.commit();
  }

  /* ───────────────────────── board + view ───────────────────────── */

  private drawBoard(ctx: CanvasRenderingContext2D) {
    const v = this.canvas.viewportTransform;
    const z = v[0];
    ctx.save();
    // transform (not setTransform): keep Fabric's retina scaling underneath.
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, this.board.w, this.board.h);
    ctx.shadowBlur = 0;

    // 10 mm grid (only when it won't turn into mush)
    if (z * 10 >= 8) {
      ctx.beginPath();
      for (let x = 10; x < this.board.w; x += 10) { ctx.moveTo(x, 0); ctx.lineTo(x, this.board.h); }
      for (let y = 10; y < this.board.h; y += 10) { ctx.moveTo(0, y); ctx.lineTo(this.board.w, y); }
      ctx.strokeStyle = "rgba(15,20,32,0.06)";
      ctx.lineWidth = 1 / z;
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(15,20,32,0.25)";
    ctx.lineWidth = 1 / z;
    ctx.strokeRect(0, 0, this.board.w, this.board.h);
    ctx.restore();
  }

  zoomToFit() {
    const { width, height } = this.canvas;
    const margin = 48;
    const z = Math.max(0.2, Math.min((width - margin * 2) / this.board.w, (height - margin * 2) / this.board.h));
    this.canvas.setViewportTransform([z, 0, 0, z, (width - this.board.w * z) / 2, (height - this.board.h * z) / 2]);
    this.canvas.requestRenderAll();
    this.emit();
  }

  zoomBy(factor: number, at?: { x: number; y: number }) {
    const point = new Point(at?.x ?? this.canvas.width / 2, at?.y ?? this.canvas.height / 2);
    const z = Math.min(80, Math.max(0.2, this.canvas.getZoom() * factor));
    this.canvas.zoomToPoint(point, z);
    this.canvas.requestRenderAll();
    this.emit();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(Math.pow(0.99, e.deltaY), { x: e.offsetX, y: e.offsetY });
    } else {
      this.canvas.relativePan(new Point(-e.deltaX, -e.deltaY));
      this.canvas.requestRenderAll();
    }
  }

  setBoardSize(w: number, h: number) {
    this.board = { w: Math.max(5, Math.min(3000, w)), h: Math.max(5, Math.min(3000, h)) };
    this.zoomToFit();
    this.commit();
  }

  /** Shrink/grow the board to the design, with a small margin, and move the design inside it. */
  fitBoardToDesign(margin = 5) {
    const objs = this.canvas.getObjects();
    if (!objs.length) return;
    this.canvas.discardActiveObject();
    const rects = objs.map(geometryRect);
    const minX = Math.min(...rects.map((r) => r.left));
    const minY = Math.min(...rects.map((r) => r.top));
    const maxX = Math.max(...rects.map((r) => r.left + r.width));
    const maxY = Math.max(...rects.map((r) => r.top + r.height));
    const dx = margin - minX, dy = margin - minY;
    for (const o of objs) {
      o.set({ left: o.left + dx, top: o.top + dy });
      o.setCoords();
    }
    this.board = { w: Math.ceil((maxX - minX + margin * 2) * 10) / 10, h: Math.ceil((maxY - minY + margin * 2) * 10) / 10 };
    this.zoomToFit();
    this.commit();
  }

  /* ───────────────────────── layers ───────────────────────── */

  private layer(id: string | undefined): StudioLayer {
    return this.layers.find((l) => l.id === id) ?? this.layers[0];
  }

  /** Paint a drawable object the way its layer says (cut = outline, engrave = filled). */
  private styleLeaf(o: FabricObject) {
    const layer = this.layer(o.layerId);
    o.visible = layer.visible;
    if (o instanceof FabricImage) {
      o.dirty = true;
      return;
    }
    if (layer.operation === "engrave") {
      o.set({ fill: layer.color, stroke: null, strokeWidth: 0 });
    } else {
      o.set({ fill: "", stroke: layer.color, strokeWidth: SCREEN_STROKE_MM, strokeUniform: true });
    }
    o.setCoords();
  }

  private restyleAll() {
    for (const o of this.leaves()) this.styleLeaf(o);
    for (const o of this.canvas.getObjects()) {
      if (isGroup(o)) {
        o.triggerLayout();
        o.dirty = true;
      }
      o.setCoords();
    }
    this.canvas.requestRenderAll();
  }

  private mergeLayers(incoming: StudioLayer[]) {
    for (const l of incoming) {
      if (!this.layers.some((x) => x.id === l.id)) this.layers.push({ ...l });
    }
  }

  setLayerVisible(id: string, visible: boolean) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, visible } : l));
    this.canvas.discardActiveObject();
    this.restyleAll();
    this.commit();
  }

  updateLayer(id: string, patch: Partial<Pick<StudioLayer, "name" | "color" | "operation">>) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
    this.restyleAll();
    this.commit();
  }

  addLayer(operation: LayerOperation = "engrave"): string {
    const used = new Set(this.layers.map((l) => l.color.toUpperCase()));
    const color = LAYER_PALETTE.find((c) => !used.has(c.toUpperCase())) ?? LAYER_PALETTE[this.layers.length % LAYER_PALETTE.length];
    const sameOp = this.layers.filter((l) => l.operation === operation).length;
    const base = operation === "cut" ? "Cut" : operation === "score" ? "Score" : "Engrave";
    const layer: StudioLayer = { id: newLayerId(), name: `${base} ${sameOp + 1}`, color, operation, visible: true };
    this.layers.push(layer);
    this.commit();
    return layer.id;
  }

  /** Delete a layer; anything on it moves to the first layer of the same kind (or the first layer). */
  deleteLayer(id: string) {
    if (this.layers.length <= 1) return;
    const victim = this.layer(id);
    const rest = this.layers.filter((l) => l.id !== id);
    const target = rest.find((l) => l.operation === victim.operation) ?? rest[0];
    for (const o of this.leaves()) if (o.layerId === id) o.layerId = target.id;
    this.layers = rest;
    this.restyleAll();
    this.commit();
  }

  moveLayer(id: string, dir: -1 | 1) {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.layers.length) return;
    const next = [...this.layers];
    [next[i], next[j]] = [next[j], next[i]];
    this.layers = next;
    this.commit();
  }

  /** Put everything selected onto a layer. */
  assignSelectionToLayer(id: string) {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    for (const o of leavesOf(active)) {
      if (o instanceof FabricImage) continue; // photos stay on the image layer
      o.layerId = id;
      this.styleLeaf(o);
    }
    if (isGroup(active)) active.dirty = true;
    this.canvas.requestRenderAll();
    this.commit();
  }

  /* ───────────────────────── adding things ───────────────────────── */

  private placeOnBoard(obj: FabricObject, opts: { growBoard: boolean }) {
    obj.setCoords();
    const r = geometryRect(obj);
    if (opts.growBoard && (r.width > this.board.w - 10 || r.height > this.board.h - 10)) {
      this.board = {
        w: Math.max(this.board.w, Math.ceil(r.width + 20)),
        h: Math.max(this.board.h, Math.ceil(r.height + 20)),
      };
    }
    obj.setPositionByOrigin(new Point(this.board.w / 2, this.board.h / 2), "center", "center");
    obj.setCoords();
  }

  private addAndSelect(obj: FabricObject) {
    for (const leaf of leavesOf(obj)) this.styleLeaf(leaf);
    if (isGroup(obj)) obj.triggerLayout();
    this.canvas.add(obj);
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
  }

  /** Add an imported design (from LAC, SVG…) as one movable group. */
  async addDesign(design: ImportedDesign) {
    this.mergeLayers(design.layers);
    const objs: FabricObject[] = [];
    for (const item of design.items) {
      if (item.kind === "path") {
        objs.push(new Path(item.d, { layerId: item.layerId, studioName: item.name, fillRule: item.fillRule ?? "evenodd" }));
      } else {
        const img = await FabricImage.fromURL(item.dataUrl);
        const nw = img.width || 1, nh = img.height || 1;
        const fit: Matrix = [item.width / nw, 0, 0, item.height / nh, 0, 0];
        const t = multiply(item.transform, multiply(fit, translate(nw / 2, nh / 2)));
        util.applyTransformToObject(img, t);
        img.layerId = item.layerId;
        img.studioName = item.name;
        objs.push(img);
      }
    }
    if (!objs.length) return;
    const obj = objs.length === 1 ? objs[0] : new Group(objs, { studioName: design.name });
    if (this.canvas.getObjects().length === 0) this.projectName = design.name;
    this.placeOnBoard(obj, { growBoard: true });
    this.addAndSelect(obj);
    this.zoomToFit();
    this.commit();
  }

  async addText(settings: StudioTextSettings) {
    const d = await textToPath(settings);
    const p = new Path(d, { layerId: this.defaultLayerFor("engrave"), studioText: { ...settings }, studioName: "Text", fillRule: "nonzero" });
    this.placeOnBoard(p, { growBoard: false });
    this.addAndSelect(p);
    this.commit();
  }

  /** Change the selected text. Keeps its position, rotation and layer. */
  async updateSelectedText(patch: Partial<StudioTextSettings>) {
    const active = this.canvas.getActiveObject();
    if (!active || !(active instanceof Path) || !active.studioText || active.group) return;
    const settings: StudioTextSettings = { ...active.studioText, ...patch };
    const token = ++this.textToken;
    const d = await textToPath(settings);
    if (token !== this.textToken || !this.canvas.getObjects().includes(active)) return; // a newer edit won
    this.replaceTextObject(active, settings, d);
    this.commit();
  }

  private replaceTextObject(old: Path, settings: StudioTextSettings, d: string, scale = { x: old.scaleX, y: old.scaleY }) {
    const center = old.getCenterPoint();
    const next = new Path(d, {
      layerId: old.layerId,
      studioText: settings,
      studioName: old.studioName ?? "Text",
      fillRule: "nonzero",
      scaleX: scale.x,
      scaleY: scale.y,
      angle: old.angle,
      flipX: old.flipX,
      flipY: old.flipY,
      skewX: old.skewX,
      skewY: old.skewY,
    });
    this.styleLeaf(next);
    next.setPositionByOrigin(center, "center", "center");
    next.setCoords();
    const index = this.canvas.getObjects().indexOf(old);
    this.canvas.remove(old);
    this.canvas.insertAt(index, next);
    this.canvas.setActiveObject(next);
    this.canvas.requestRenderAll();
  }

  private defaultLayerFor(op: LayerOperation): string {
    return (this.layers.find((l) => l.operation === op && l.visible) ?? this.layers.find((l) => l.operation === op) ?? this.layers[0]).id;
  }

  addShape(kind: ShapeKind) {
    const d =
      kind === "rect" ? rectPath(0, 0, 60, 40, 3)
      : kind === "circle" ? ellipsePath(25, 25, 25, 25)
      : kind === "heart" ? heartPath(50)
      : starPath(50);
    const names: Record<ShapeKind, string> = { rect: "Rectangle", circle: "Circle", heart: "Heart", star: "Star" };
    const p = new Path(d, { layerId: this.defaultLayerFor("cut"), studioName: names[kind], fillRule: "nonzero" });
    this.placeOnBoard(p, { growBoard: false });
    this.addAndSelect(p);
    this.commit();
  }

  /* ───────────────────────── editing ───────────────────────── */

  private async onModified(target: FabricObject | undefined) {
    // Scaling text with the handles: bake the scale into the font size so
    // the size box stays honest and the outlines stay crisp.
    if (target instanceof Path && target.studioText && !target.group) {
      const sx = target.scaleX, sy = target.scaleY;
      if (Math.abs(sx - sy) < 1e-3 && Math.abs(sx - 1) > 1e-3) {
        const s: StudioTextSettings = { ...target.studioText };
        s.sizeMm = Math.round(s.sizeMm * sx * 100) / 100;
        s.letterSpacing = Math.round((s.letterSpacing || 0) * sx * 100) / 100;
        const d = await textToPath(s);
        this.replaceTextObject(target, s, d, { x: 1, y: 1 });
      }
    }
    this.commit();
  }

  deleteSelected() {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    const targets = active instanceof ActiveSelection ? active.getObjects() : [active];
    this.canvas.discardActiveObject();
    this.canvas.remove(...targets);
    this.canvas.requestRenderAll();
    this.commit();
  }

  async duplicateSelected() {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    const originals = active instanceof ActiveSelection ? active.getObjects() : [active];
    this.canvas.discardActiveObject();
    const clones: FabricObject[] = [];
    for (const o of originals) {
      const c = await o.clone(PROPS);
      c.set({ left: c.left + 5, top: c.top + 5 });
      c.setCoords();
      this.canvas.add(c);
      clones.push(c);
    }
    for (const c of clones) for (const l of leavesOf(c)) this.styleLeaf(l);
    this.selectObjects(clones);
    this.commit();
  }

  private selectObjects(objs: FabricObject[]) {
    if (!objs.length) return;
    if (objs.length === 1) this.canvas.setActiveObject(objs[0]);
    else this.canvas.setActiveObject(new ActiveSelection(objs, { canvas: this.canvas }));
    this.canvas.requestRenderAll();
  }

  groupSelected() {
    const active = this.canvas.getActiveObject();
    if (!(active instanceof ActiveSelection)) return;
    const objs = active.getObjects();
    const index = Math.min(...objs.map((o) => this.canvas.getObjects().indexOf(o)));
    this.canvas.discardActiveObject();
    this.canvas.remove(...objs);
    const g = new Group(objs, { studioName: "Group" });
    this.canvas.insertAt(index, g);
    this.canvas.setActiveObject(g);
    this.canvas.requestRenderAll();
    this.commit();
  }

  ungroupSelected() {
    const active = this.canvas.getActiveObject();
    if (!active || !isGroup(active)) return;
    const index = this.canvas.getObjects().indexOf(active);
    this.canvas.discardActiveObject();
    const children = active.removeAll();
    this.canvas.remove(active);
    this.canvas.insertAt(index, ...children);
    for (const c of children) c.setCoords();
    this.selectObjects(children);
    this.commit();
  }

  /** Resize the selection to a width or height in mm, keeping proportions. */
  setSelectionSize(dim: "w" | "h", mm: number) {
    const active = this.canvas.getActiveObject();
    if (!active || !(mm > 0)) return;
    const r = geometryRect(active);
    const current = dim === "w" ? r.width : r.height;
    if (!current) return;
    const f = mm / current;
    const center = active.getCenterPoint();
    active.set({ scaleX: active.scaleX * f, scaleY: active.scaleY * f });
    active.setPositionByOrigin(center, "center", "center");
    active.setCoords();
    this.canvas.requestRenderAll();
    this.onModified(active);
  }

  nudge(dx: number, dy: number) {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    active.set({ left: active.left + dx, top: active.top + dy });
    active.setCoords();
    this.canvas.requestRenderAll();
    this.commit();
  }

  centerSelectionOnBoard() {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    active.setPositionByOrigin(new Point(this.board.w / 2, this.board.h / 2), "center", "center");
    active.setCoords();
    this.canvas.requestRenderAll();
    this.commit();
  }

  selectAll() {
    const objs = this.canvas.getObjects().filter((o) => o.visible !== false || isGroup(o));
    this.canvas.discardActiveObject();
    this.selectObjects(objs);
    this.emit();
  }

  /* ───────────────────────── export ───────────────────────── */

  exportSvg() {
    return buildSvg({ name: this.projectName, board: this.board, layers: this.layers, leaves: this.leaves() });
  }
}
