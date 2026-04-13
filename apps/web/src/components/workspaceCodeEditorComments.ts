import { type Extension } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

// ---------------------------------------------------------------------------
// Public annotation type
// ---------------------------------------------------------------------------

export interface InlineCommentAnnotation {
  kind: "draft-form" | "draft-comment";
  /** Unique identifier for the annotation (used for portal mapping & WidgetType.eq). */
  id: string;
  /** 1-based line number where the widget renders (after this line). */
  lineEnd: number;
  /** 1-based start line of the comment range (used for line highlighting). */
  lineStart: number;
}

// ---------------------------------------------------------------------------
// Portal registry – bridges CodeMirror DOM to React portals
// ---------------------------------------------------------------------------

export class PortalRegistry {
  private containers = new Map<string, HTMLElement>();
  private listeners = new Set<() => void>();
  private snapshot: ReadonlyMap<string, HTMLElement> = new Map();

  register(id: string, el: HTMLElement): void {
    this.containers.set(id, el);
    this.updateSnapshot();
  }

  unregister(id: string): void {
    this.containers.delete(id);
    this.updateSnapshot();
  }

  getSnapshot(): ReadonlyMap<string, HTMLElement> {
    return this.snapshot;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private updateSnapshot(): void {
    this.snapshot = new Map(this.containers);
    for (const cb of this.listeners) {
      cb();
    }
  }
}

// ---------------------------------------------------------------------------
// CodeMirror effect to set the full list of comment widgets
// ---------------------------------------------------------------------------

export const setCommentWidgets = StateEffect.define<InlineCommentAnnotation[]>();

// ---------------------------------------------------------------------------
// Widget implementation
// ---------------------------------------------------------------------------

class CommentPortalWidget extends WidgetType {
  constructor(
    readonly annotation: InlineCommentAnnotation,
    private readonly portalRegistry: PortalRegistry,
  ) {
    super();
  }

  override eq(other: CommentPortalWidget): boolean {
    return (
      this.annotation.id === other.annotation.id &&
      this.annotation.kind === other.annotation.kind &&
      this.annotation.lineEnd === other.annotation.lineEnd
    );
  }

  override toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-comment-widget";
    container.dataset.commentId = this.annotation.id;
    container.dataset.commentKind = this.annotation.kind;
    this.portalRegistry.register(this.annotation.id, container);
    return container;
  }

  override destroy(): void {
    this.portalRegistry.unregister(this.annotation.id);
  }

  override get estimatedHeight(): number {
    return this.annotation.kind === "draft-form" ? 180 : 90;
  }

  override ignoreEvent(): boolean {
    // Allow all events (clicks, focus, keyboard) inside the widget.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Build decorations from annotation list
// ---------------------------------------------------------------------------

function buildDecorations(
  annotations: InlineCommentAnnotation[],
  docLines: number,
  registry: PortalRegistry,
  state: { doc: { line: (n: number) => { to: number; from: number } } },
): DecorationSet {
  if (annotations.length === 0) {
    return Decoration.none;
  }

  const decorations: { from: number; to: number; value: Decoration }[] = [];

  for (const annotation of annotations) {
    const clampedEnd = Math.max(1, Math.min(annotation.lineEnd, docLines));
    const pos = state.doc.line(clampedEnd).to;
    decorations.push({
      from: pos,
      to: pos,
      value: Decoration.widget({
        widget: new CommentPortalWidget(annotation, registry),
        block: true,
        side: 1,
      }),
    });

    // Highlight the line range for the active comment form.
    if (annotation.kind === "draft-form") {
      const clampedStart = Math.max(1, Math.min(annotation.lineStart, docLines));
      for (let line = clampedStart; line <= clampedEnd; line += 1) {
        const lineFrom = state.doc.line(line).from;
        decorations.push({
          from: lineFrom,
          to: lineFrom,
          value: Decoration.line({ class: "cm-comment-highlight" }),
        });
      }
    }
  }

  // Sort decorations by position for RangeSet.
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(
    decorations.map((d) => d.value.range(d.from, d.to)),
    true,
  );
}

// ---------------------------------------------------------------------------
// Factory: creates the full extension given a PortalRegistry
// ---------------------------------------------------------------------------

export function commentWidgetsExtension(registry: PortalRegistry): Extension {
  const field = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decorations, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setCommentWidgets)) {
          return buildDecorations(effect.value, tr.state.doc.lines, registry, tr.state);
        }
      }
      return decorations.map(tr.changes);
    },
    provide(f) {
      return EditorView.decorations.from(f);
    },
  });

  const theme = EditorView.baseTheme({
    ".cm-comment-widget": {
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: "14px",
      lineHeight: "normal",
      padding: "0",
    },
    ".cm-comment-highlight": {
      backgroundColor: "color-mix(in srgb, var(--primary) 8%, transparent)",
    },
  });

  return [field, theme];
}
