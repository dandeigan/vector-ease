"use client";

import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { EngineState, StudioEngine } from "@/lib/studio/engine";
import { FONTS } from "@/lib/studio/fonts";
import type { StudioTextSettings } from "@/lib/studio/types";
import HelpTip, { Steps } from "./HelpTip";
import MmInput from "./MmInput";

const KIND_LABEL: Record<string, string> = {
  text: "Text",
  shape: "Shape",
  group: "Group",
  image: "Image",
  multi: "items selected",
};

export default function SelectionPanel({
  state,
  engine,
  textAreaRef,
}: {
  state: EngineState;
  engine: StudioEngine;
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const sel = state.selection;

  if (sel.count === 0) {
    return (
      <section className="p-4">
        <h3 className="panel-title">Selection</h3>
        <p className="text-xs text-foreground-muted mt-2 leading-relaxed">
          Click something on the board to move, resize or change it. Use <b>Text</b> on the left to write a name or date.
        </p>
      </section>
    );
  }

  const title = sel.kind === "multi" ? `${sel.count} ${KIND_LABEL.multi}` : sel.name && sel.kind === "group" ? sel.name : KIND_LABEL[sel.kind];

  return (
    <section className="p-4 space-y-4">
      <div>
        <h3 className="panel-title">Selection</h3>
        <p className="text-sm font-semibold mt-1 truncate" title={title}>{title}</p>
      </div>

      {sel.kind === "text" && sel.text && <TextEditor text={sel.text} engine={engine} textAreaRef={textAreaRef} />}

      <div>
        <Label>Size (keeps proportions)</Label>
        <div className="flex items-center gap-2">
          <MmInput label="W" value={sel.widthMm} onCommit={(v) => engine.setSelectionSize("w", v)} />
          <MmInput label="H" value={sel.heightMm} onCommit={(v) => engine.setSelectionSize("h", v)} />
        </div>
      </div>

      {sel.kind !== "image" && (
        <div>
          <div className="flex items-center justify-between">
            <Label>Layer</Label>
            <HelpTip title="Changing what the laser does">
              <p className="mb-2">The layer decides the job: <b className="text-red-400">Cut</b> through, <b className="text-blue-400">Score</b> a line, or <b>Engrave</b> (fill).</p>
              <Steps items={[
                <>If only part of a design should change, click <b>Ungroup</b> on the left first.</>,
                <>Click the part you want (hold <b>Shift</b> for more than one).</>,
                <>Pick the new layer here. Its colour changes on the board.</>,
              ]} />
            </HelpTip>
          </div>
          <select
            value={sel.layerId ?? ""}
            onChange={(e) => engine.assignSelectionToLayer(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm focus:outline-none focus:border-dd-gold-400/50"
          >
            {sel.layerId === null && <option value="">Mixed layers…</option>}
            {state.layers.filter((l) => l.operation !== "image").map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      {sel.kind === "group" && (
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          This moves as one piece. Use <b>Ungroup</b> on the left to change parts of it.
        </p>
      )}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted mb-1.5">{children}</div>;
}

function TextEditor({
  text,
  engine,
  textAreaRef,
}: {
  text: StudioTextSettings;
  engine: StudioEngine;
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [draft, setDraft] = useState(text.text);
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(text.text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow outside changes (undo, selecting other text) unless the user is typing.
  if (seen !== text.text) {
    setSeen(text.text);
    if (!focused) setDraft(text.text);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const pushText = (value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => engine.updateSelectedText({ text: value }), 200);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Words</Label>
        <textarea
          ref={textAreaRef}
          value={draft}
          rows={Math.min(5, Math.max(2, draft.split("\n").length))}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (timer.current) clearTimeout(timer.current);
            if (draft !== text.text) engine.updateSelectedText({ text: draft });
          }}
          onChange={(e) => pushText(e.target.value)}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base focus:outline-none focus:border-dd-gold-400/60"
          placeholder="Type a name, date…"
        />
      </div>

      <div>
        <Label>Font</Label>
        <div className="grid grid-cols-1 gap-1 max-h-48 overflow-y-auto pr-1">
          {FONTS.map((f) => (
            <button
              key={f.id}
              onClick={() => engine.updateSelectedText({ fontId: f.id })}
              className={`text-left px-3 py-1.5 rounded-lg border transition-colors ${
                text.fontId === f.id ? "border-dd-gold-400/60 bg-dd-gold-400/10" : "border-border hover:border-dd-gold-400/30"
              }`}
              title={f.label}
            >
              <span style={{ fontFamily: `studio-${f.id}, sans-serif`, fontSize: 18 }}>{draft.split("\n")[0].slice(0, 18) || "Abc"}</span>
              <span className="block text-[10px] text-foreground-muted">{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label>Letter size</Label>
          <MmInput value={text.sizeMm} onCommit={(v) => engine.updateSelectedText({ sizeMm: v })} />
        </div>
        <div>
          <Label>Align</Label>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["left", "center", "right"] as const).map((a) => {
              const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
              return (
                <button
                  key={a}
                  onClick={() => engine.updateSelectedText({ align: a })}
                  className={`p-2 ${text.align === a ? "bg-dd-gold-400/15 text-dd-gold-400" : "text-foreground-muted hover:text-foreground"}`}
                  title={`Align ${a}`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <div className="flex justify-between">
          <Label>Letter spacing</Label>
          <span className="text-[10px] font-mono text-foreground-muted">{text.letterSpacing.toFixed(1)} mm</span>
        </div>
        <input
          type="range"
          min={-2}
          max={10}
          step={0.1}
          value={text.letterSpacing}
          onChange={(e) => engine.updateSelectedText({ letterSpacing: parseFloat(e.target.value) })}
          className="w-full"
        />
      </div>

      {draft.includes("\n") && (
        <div>
          <div className="flex justify-between">
            <Label>Line spacing</Label>
            <span className="text-[10px] font-mono text-foreground-muted">{text.lineHeight.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.7}
            max={2.5}
            step={0.05}
            value={text.lineHeight}
            onChange={(e) => engine.updateSelectedText({ lineHeight: parseFloat(e.target.value) })}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}
