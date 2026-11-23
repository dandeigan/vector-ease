"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { EngineState, LayerWithCount, StudioEngine } from "@/lib/studio/engine";
import { OPERATION_LABELS } from "@/lib/studio/layers";
import HelpTip, { Steps } from "./HelpTip";
import type { LayerOperation } from "@/lib/studio/types";

const OP_HINT: Record<LayerOperation, string> = {
  cut: "cuts all the way through",
  score: "light line on the surface",
  engrave: "fills the shape in",
  image: "engraves a photo",
};

export default function LayersPanel({ state, engine }: { state: EngineState; engine: StudioEngine }) {
  return (
    <section className="p-4 border-t border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h3 className="panel-title">Layers</h3>
          <HelpTip title="How layers work">
            <p className="mb-2">Each layer is one laser job. <b className="text-red-400">Cut</b> goes all the way through, <b className="text-blue-400">Score</b> draws a light line, <b>Engrave</b> fills shapes in. The number on each layer is how many shapes it holds. 0 means that job does nothing.</p>
            <p className="font-semibold mb-1">Move part of a design to another layer</p>
            <Steps items={[
              <>Click the design. If it moves as one piece, click <b>Ungroup</b> on the left.</>,
              <>Click an empty spot on the board, then click the part you want. Hold <b>Shift</b> to pick more than one.</>,
              <>Under <b>Selection</b>, change <b>Layer</b> (for example Score → Cut).</>,
            ]} />
            <p className="font-semibold mt-2 mb-1">Add a cut-out border</p>
            <Steps items={[
              <>Click <b>Circle</b> or <b>Box</b> on the left.</>,
              <>Drag its corners (or type the size) so it sits around your design.</>,
              <>Set its <b>Layer</b> to <b>Cut</b>.</>,
            ]} />
            <p className="mt-2 text-foreground-muted">The eye icon hides a layer. Hidden layers are left out of the export.</p>
          </HelpTip>
        </div>
        <button
          onClick={() => engine.addLayer("engrave")}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground-muted hover:text-dd-gold-400"
          title="Add a layer"
        >
          <Plus className="w-3.5 h-3.5" /> Add layer
        </button>
      </div>
      <p className="text-[10px] text-foreground-muted mt-1 mb-3">Each layer is one laser job: cut, score or engrave.</p>
      <div className="space-y-2">
        {state.layers.map((layer, i) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            engine={engine}
            first={i === 0}
            last={i === state.layers.length - 1}
            canDelete={state.layers.length > 1}
          />
        ))}
      </div>
    </section>
  );
}

function LayerRow({
  layer, engine, first, last, canDelete,
}: {
  layer: LayerWithCount;
  engine: StudioEngine;
  first: boolean;
  last: boolean;
  canDelete: boolean;
}) {
  const [name, setName] = useState(layer.name);
  const [seen, setSeen] = useState(layer.name);
  if (seen !== layer.name) {
    setSeen(layer.name);
    setName(layer.name);
  }

  return (
    <div className={`group rounded-lg border border-border bg-background/60 px-2.5 py-2 ${layer.visible ? "" : "opacity-50"}`}>
      <div className="flex items-center gap-2">
        <label className="relative w-5 h-5 rounded-md border border-white/15 shrink-0 cursor-pointer overflow-hidden" style={{ backgroundColor: layer.color }} title="Change colour">
          <input
            type="color"
            value={layer.color}
            onChange={(e) => engine.updateLayer(layer.id, { color: e.target.value.toUpperCase() })}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== layer.name ? engine.updateLayer(layer.id, { name: name.trim() }) : setName(layer.name)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="flex-1 min-w-0 bg-transparent text-sm font-medium px-1 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-dd-gold-400/40"
          aria-label="Layer name"
        />
        <span className="text-[10px] font-mono text-foreground-muted" title="Shapes on this layer">{layer.count}</span>
        <button
          onClick={() => engine.setLayerVisible(layer.id, !layer.visible)}
          className="p-1 rounded text-foreground-muted hover:text-dd-blue-400"
          title={layer.visible ? "Hide (hidden layers aren't exported)" : "Show"}
        >
          {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 pl-7">
        <select
          value={layer.operation}
          onChange={(e) => engine.updateLayer(layer.id, { operation: e.target.value as LayerOperation })}
          disabled={layer.operation === "image"}
          className="bg-background border border-border rounded px-1.5 py-1 text-[11px] focus:outline-none focus:border-dd-gold-400/50 disabled:opacity-60"
        >
          {(["cut", "score", "engrave"] as const).map((op) => (
            <option key={op} value={op}>{OPERATION_LABELS[op]}</option>
          ))}
          {layer.operation === "image" && <option value="image">{OPERATION_LABELS.image}</option>}
        </select>
        <span className="text-[10px] text-foreground-muted truncate">{OP_HINT[layer.operation]}</span>
        <div className="ml-auto flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => engine.moveLayer(layer.id, -1)} disabled={first} className="p-0.5 text-foreground-muted hover:text-foreground disabled:opacity-20" title="Move up (runs earlier)">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => engine.moveLayer(layer.id, 1)} disabled={last} className="p-0.5 text-foreground-muted hover:text-foreground disabled:opacity-20" title="Move down (runs later)">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {canDelete && (
            <button
              onClick={() => engine.deleteLayer(layer.id)}
              className="p-0.5 text-foreground-muted hover:text-red-400"
              title={layer.count ? "Delete layer (its shapes move to a similar layer)" : "Delete layer"}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
