import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft, ArrowUpRight, BookOpen, Code2, Command, CornerDownLeft, Feather, FileText, Search, X,
} from "lucide-react";
import "./command-palette.css";

export interface PaletteOption {
  id: string;
  title: string;
  detail?: string;
  kind: "action" | "problem" | "thread" | "thought" | "reflection";
  meta?: string;
}

export interface PaletteSection {
  title: string;
  options: readonly PaletteOption[];
}

export interface PalettePreview {
  title: string;
  eyebrow: string;
  meta?: string;
  sections: { label?: string; text: string }[];
  actions?: { id: string; label: string }[];
}

interface CommandPaletteProps {
  query: string;
  onQueryChange: (value: string) => void;
  sections: readonly PaletteSection[];
  preview?: PalettePreview | null;
  onChoose: (option: PaletteOption) => void;
  onPreviewAction: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
  shortcutLabel?: string;
}

const optionIcons = {
  action: Command,
  problem: Code2,
  thread: Feather,
  thought: FileText,
  reflection: BookOpen,
};

export function CommandPalette({
  query, onQueryChange, sections, preview, onChoose, onPreviewAction, onBack, onClose, shortcutLabel,
}: CommandPaletteProps) {
  const uid = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const scrollToSelection = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const options = sections.flatMap(section => section.options);
  const activeIndex = Math.max(0, options.findIndex(option => option.id === selected));
  const active = options[activeIndex];
  const optionId = (index: number) => `${uid}-option-${index}`;
  const showingPreview = !!preview;

  useLayoutEffect(() => {
    const surface = dialog.current;
    if (!surface) return;
    const previousFocus = document.activeElement;
    surface.showModal();
    return () => {
      if (surface.open) surface.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  useLayoutEffect(() => {
    const target = showingPreview ? previewHeading.current : input.current;
    target?.focus({ preventScroll: true });
    if (!showingPreview) {
      results.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
  }, [showingPreview]);

  useLayoutEffect(() => {
    if (!scrollToSelection.current) return;
    scrollToSelection.current = false;
    results.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !active
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const next = (activeIndex + offset + options.length) % options.length;
      if (next !== activeIndex) {
        scrollToSelection.current = true;
        setSelected(options[next].id);
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat) onChoose(active);
    }
  }

  function onEscape() {
    if (preview) onBack();
    else onClose();
  }

  return (
    <dialog className="command-palette" ref={dialog} aria-label="Command palette" data-interactive
      onCancel={event => { event.preventDefault(); onEscape(); }}
      onKeyDown={event => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}>
      {preview ? <>
        <div className="command-palette-top">
          <button type="button" className="command-palette-back" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true"/> Back to results
          </button>
          <button type="button" className="command-palette-close" onClick={onClose} aria-label="Close command palette">
            <X size={16} aria-hidden="true"/>
          </button>
        </div>
        <div className="command-palette-preview">
          <p className="command-palette-kicker">{preview.eyebrow}</p>
          <h2 tabIndex={-1} ref={previewHeading}>{preview.title}</h2>
          {preview.meta && <p className="command-palette-meta">{preview.meta}</p>}
          {preview.sections.map(({ label, text }, index) => (
            <section className="command-palette-preview-note" key={index}>
              {label && <h3>{label}</h3>}
              <p>{text}</p>
            </section>
          ))}
          {!!preview.actions?.length && <div className="command-palette-preview-actions">
            {preview.actions.map(action => (
              <button type="button" key={action.id} onClick={() => onPreviewAction(action.id)}>
                {action.label}<ArrowUpRight size={14} aria-hidden="true"/>
              </button>
            ))}
          </div>}
        </div>
        <footer className="command-palette-footer"><span><kbd>Esc</kbd> Back to results</span><span>Local notebook</span></footer>
      </> : <>
        <div className="command-palette-top">
          <Search size={18} className="command-palette-search-icon" aria-hidden="true"/>
          <input ref={input} type="text" role="combobox" aria-label="Search commands and notebook" autoComplete="off"
            spellCheck={false} maxLength={200} aria-autocomplete="list" aria-expanded={!!options.length} aria-controls={`${uid}-results`}
            aria-activedescendant={active ? optionId(activeIndex) : undefined}
            placeholder="Search or run a command…" value={query}
            onChange={event => {
              setSelected(null);
              if (results.current) results.current.scrollTop = 0;
              onQueryChange(event.target.value);
            }}
            onKeyDown={onSearchKey}/>
          <button type="button" className="command-palette-close" onClick={onClose} aria-label="Close command palette">
            <X size={16} aria-hidden="true"/>
          </button>
        </div>
        <div className="command-palette-results" id={`${uid}-results`} ref={results} role="listbox" aria-label="Commands and notebook results">
          {sections.filter(section => section.options.length > 0).map(section => (
            <div role="group" aria-label={section.title} key={section.title} className="command-palette-section">
              <div className="command-palette-kicker" aria-hidden="true">{section.title}</div>
              {section.options.map(option => {
                const Icon = optionIcons[option.kind];
                const current = option.id === active?.id;
                return (
                  <div key={option.id} id={optionId(options.indexOf(option))} role="option" aria-selected={current}
                    className="command-palette-option"
                    onPointerMove={event => { if (event.pointerType === "mouse") setSelected(option.id); }}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => { setSelected(option.id); onChoose(option); }}>
                    <Icon size={15} className="command-palette-option-icon" aria-hidden="true"/>
                    <div className="command-palette-option-copy">
                      <strong>{option.title}</strong>
                      {option.detail && <small>{option.detail}</small>}
                    </div>
                    {option.meta && <span className="command-palette-option-meta">{option.meta}</span>}
                    {current && <CornerDownLeft size={13} className="command-palette-option-key" aria-hidden="true"/>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {!options.length && <p className="command-palette-empty" role="status">
          <strong>No matches</strong>Try a problem title, a word from a note, or a different command.
        </p>}
        <footer className="command-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
          {shortcutLabel && <span className="command-palette-shortcut">{shortcutLabel}</span>}
        </footer>
      </>}
    </dialog>
  );
}
