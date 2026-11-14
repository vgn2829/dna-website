import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  useEditor, EditorContent, NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer,
  Node, Mark, Extension, mergeAttributes, type Editor, type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Braces, GitBranch, ImagePlus, Italic, Link2, List, ListOrdered,
  MousePointerClick, Minus, Plus, Redo2, Square, Highlighter, Trash2, Underline as UnderlineIcon, Undo2, Unlink,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import {
  groupByCategory, newCondition, type Condition, type DocNode, type VariableOption,
} from '../../../lib/emailCentre';
import { ConditionBuilder, type ConditionContext } from './ConditionBuilder';
import { Spinner } from './shared';

// What the node views (condition builders) need to know about the current audience.
export interface EditorEnv { cond: ConditionContext; known: Set<string> }
const EnvCtx = createContext<EditorEnv | null>(null);
const useEnv = () => useContext(EnvCtx)!;

// ── Custom nodes ────────────────────────────────────────────────────────────
function ButtonView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper style={{ margin: '0 0 14px' }} data-drag-handle>
      <div contentEditable={false} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 8, borderRadius: 10, border: `1px solid ${selected ? 'var(--color-accent-blue)' : 'var(--color-hairline)'}` }}>
        <span style={{ background: '#E91E8C', color: '#fff', borderRadius: 100, padding: '8px 18px', fontWeight: 600, fontSize: 13 }}>{String(node.attrs.label) || 'Button'}</span>
        <input aria-label="Button label" className="ec-mini" style={{ width: 150 }} value={String(node.attrs.label ?? '')} onChange={e => updateAttributes({ label: e.target.value })} placeholder="Label" />
        <input aria-label="Button link" className="ec-mini" style={{ flex: 1, minWidth: 180 }} value={String(node.attrs.href ?? '')} onChange={e => updateAttributes({ href: e.target.value })} placeholder="https://… or {{event_link}}" />
        <button type="button" className="ec-tb" aria-label="Remove button" onClick={deleteNode}><Trash2 size={13} /></button>
      </div>
    </NodeViewWrapper>
  );
}

// The DNA lime marker (as in the welcome email).
const HighlightMark = Mark.create({
  name: 'highlight',
  parseHTML() { return [{ tag: 'mark' }]; },
  renderHTML({ HTMLAttributes }) { return ['mark', mergeAttributes({ style: 'background:#e0f55b;color:#111;padding:0 3px;border-radius:2px' }, HTMLAttributes), 0]; },
  addCommands() {
    return { toggleHighlight: () => ({ commands }: { commands: { toggleMark: (n: string) => boolean } }) => commands.toggleMark('highlight') } as never;
  },
});

const ButtonNode = Node.create({
  name: 'button', group: 'block', atom: true, draggable: true,
  addAttributes() { return { label: { default: 'Click here' }, href: { default: 'https://' } }; },
  parseHTML() { return [{ tag: 'a[data-ec-button]' }]; },
  renderHTML({ HTMLAttributes }) { return ['a', mergeAttributes({ 'data-ec-button': '' }, HTMLAttributes)]; },
  addNodeView() { return ReactNodeViewRenderer(ButtonView); },
});

const TONES: { id: string; label: string; bg: string; fg: string; border: string }[] = [
  { id: 'highlight', label: 'Highlight', bg: '#e0f55b', fg: '#111', border: 'transparent' },
  { id: 'lime', label: 'Lime', bg: '#dced3e', fg: '#111', border: 'transparent' },
  { id: 'outline', label: 'Outline', bg: '#fff', fg: '#333', border: '#111' },
  { id: 'dark', label: 'Dark', bg: '#222', fg: '#fff', border: 'transparent' },
];

// A coloured panel with an optional small monospace label — schedule blocks, notices, announcements.
function CalloutView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const tone = TONES.find(t => t.id === node.attrs.tone) ?? TONES[0];
  return (
    <NodeViewWrapper style={{ margin: '0 0 14px' }}>
      <div contentEditable={false} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 4 }}>
        <select aria-label="Panel colour" className="ec-mini" value={tone.id} onChange={e => updateAttributes({ tone: e.target.value })}>
          {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <input aria-label="Panel label" className="ec-mini" style={{ width: 220 }} placeholder="Optional label, e.g. Travel arrangements" value={String(node.attrs.label ?? '')} onChange={e => updateAttributes({ label: e.target.value })} />
        <button type="button" className="ec-tb" aria-label="Remove panel" onClick={deleteNode}><Trash2 size={13} /></button>
      </div>
      <div style={{ background: tone.bg, color: tone.fg, border: `2px solid ${tone.border}`, borderRadius: 6, padding: '10px 14px' }}>
        {String(node.attrs.label ?? '') && <div contentEditable={false} style={{ fontFamily: "'Courier New',monospace", fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{String(node.attrs.label)}</div>}
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}

const CalloutNode = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes() { return { tone: { default: 'highlight' }, label: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-ec-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ 'data-ec-callout': '' }, HTMLAttributes), 0]; },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});

function BlockView({ editor, node, getPos, deleteNode }: NodeViewProps) {
  const env = useEnv();
  const hasElse = node.content.content.some(b => b.attrs.when == null);
  const addBranch = (otherwise: boolean) => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const at = pos + node.nodeSize - 1; // end of this block's content
    const field = env.cond.fields[0]?.name ?? '';
    editor.chain().focus().insertContentAt(at, {
      type: 'conditionalBranch', attrs: { when: otherwise ? null : newCondition(field) }, content: [{ type: 'paragraph' }],
    }).run();
  };
  return (
    <NodeViewWrapper className="ec-cond">
      <div contentEditable={false} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <GitBranch size={14} style={{ color: 'var(--color-accent-blue)' }} aria-hidden />
        <strong style={{ fontSize: 12 }}>Conditional content</strong>
        <span className="ec-hint">— each recipient sees the first branch whose condition matches</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="ec-tb" onClick={() => addBranch(false)}><Plus size={13} /> Else-if branch</button>
        {!hasElse && <button type="button" className="ec-tb" onClick={() => addBranch(true)}><Plus size={13} /> Otherwise</button>}
        <button type="button" className="ec-tb" aria-label="Remove conditional block" onClick={deleteNode}><Trash2 size={13} /></button>
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

const ConditionalBlockNode = Node.create({
  name: 'conditionalBlock', group: 'block', content: 'conditionalBranch+', defining: true, isolating: true,
  parseHTML() { return [{ tag: 'div[data-ec-block]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ 'data-ec-block': '' }, HTMLAttributes), 0]; },
  addNodeView() { return ReactNodeViewRenderer(BlockView); },
});

function BranchView({ editor, node, getPos, updateAttributes, deleteNode }: NodeViewProps) {
  const env = useEnv();
  const when = node.attrs.when as Condition | null;
  const pos = getPos();
  const siblings = typeof pos === 'number' ? editor.state.doc.resolve(pos).parent.childCount : 1;
  return (
    <NodeViewWrapper className={`ec-branch${when == null ? ' is-else' : ''}`}>
      <div className="ec-branch-head" contentEditable={false}>
        {when == null
          ? <strong>Otherwise <span className="ec-hint" style={{ fontWeight: 400 }}>(everyone not matched above)</span></strong>
          : <ConditionBuilder value={when} ctx={env.cond} onChange={c => updateAttributes({ when: c })} />}
        {when != null && (
          <button type="button" className="ec-tb" title="Show this to everyone not matched above" onClick={() => updateAttributes({ when: null })}>Make “otherwise”</button>
        )}
        {siblings > 1 && <button type="button" className="ec-tb" aria-label="Remove branch" onClick={deleteNode}><Trash2 size={13} /></button>}
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

const ConditionalBranchNode = Node.create({
  name: 'conditionalBranch', content: 'block+', defining: true, isolating: true,
  addAttributes() { return { when: { default: null } }; },
  parseHTML() { return [{ tag: 'div[data-ec-branch]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes({ 'data-ec-branch': '' }, { 'data-when': JSON.stringify(HTMLAttributes.when ?? null) }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(BranchView); },
});

// Highlights {{variables}}; unknown ones (typos) turn red so they are caught while typing.
const TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,40})\s*(?:\|[^{}]*)?\}\}/g;
function variableHighlight(knownRef: { current: Set<string> }) {
  return Extension.create({
    name: 'variableHighlight',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('ecVariableHighlight'),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const m of node.text.matchAll(TOKEN)) {
                const from = pos + (m.index ?? 0);
                decos.push(Decoration.inline(from, from + m[0].length, { class: knownRef.current.has(m[1].toLowerCase()) ? 'ec-var' : 'ec-var ec-var-bad' }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      })];
    },
  });
}

// ── Toolbar pieces ──────────────────────────────────────────────────────────
function Tb({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="ec-tb" title={label} aria-label={label} aria-pressed={active ?? undefined} disabled={disabled}
      onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>
  );
}

export function VariableMenu({ options, onPick, label = 'Insert variable', compact }: { options: VariableOption[]; onPick: (name: string) => void; label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = options.filter(o => !q || o.name.includes(q.toLowerCase()) || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQ(''); }}>
      <PopoverTrigger asChild>
        <button type="button" className={compact ? 'ec-btn' : 'ec-tb'} style={compact ? { minHeight: 32, padding: '4px 10px' } : undefined} onMouseDown={e => e.preventDefault()} aria-label={label}>
          <Braces size={14} /> {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" style={{ width: 300, maxHeight: 360, overflow: 'auto', padding: 10, background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)' }}>
        <input autoFocus className="ec-input" style={{ marginBottom: 8, minHeight: 34 }} placeholder="Search variables…" aria-label="Search variables" value={q} onChange={e => setQ(e.target.value)} />
        {filtered.length === 0 && <p className="ec-hint">No variables match. Add custom fields from a CSV, a recipient, or “Message variables”.</p>}
        {groupByCategory(filtered).map(([cat, opts]) => (
          <div key={cat} style={{ marginBottom: 8 }}>
            <p className="ec-label" style={{ marginBottom: 4 }}>{cat}</p>
            {opts.map(o => (
              <button key={o.name} type="button" onClick={() => { onPick(o.name); setOpen(false); setQ(''); }}
                style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, textAlign: 'left', background: 'none', border: 0, color: 'var(--color-ink)', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 13 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <span><code style={{ color: 'var(--color-brand-text)' }}>{`{{${o.name}}}`}</code></span>
                <span className="ec-hint">{o.sample ?? ''}</span>
              </button>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LinkMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (o) setUrl((editor.getAttributes('link').href as string) ?? 'https://'); }}>
      <PopoverTrigger asChild>
        <button type="button" className="ec-tb" title="Link" aria-label="Link" aria-pressed={editor.isActive('link')} onMouseDown={e => e.preventDefault()}><Link2 size={15} /></button>
      </PopoverTrigger>
      <PopoverContent align="start" style={{ width: 320, padding: 10, background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)' }}>
        <label className="ec-label" htmlFor="ec-link-url">Link address</label>
        <input id="ec-link-url" autoFocus className="ec-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://… or mailto:… or {{event_link}}"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button type="button" className="ec-btn ec-btn-primary" onClick={apply}>Apply</button>
          {editor.isActive('link') && <button type="button" className="ec-btn" onClick={() => { editor.chain().focus().unsetLink().run(); setOpen(false); }}><Unlink size={13} /> Remove</button>}
        </div>
      </PopoverContent>
    </Popover>
  );
  function apply() {
    const href = url.trim();
    if (!href) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setOpen(false);
  }
}

function ImageMenu({ editor, onUpload }: { editor: Editor; onUpload?: (file: File) => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('https://');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const insert = (src: string) => { editor.chain().focus().setImage({ src, alt: '' }).run(); setOpen(false); setUrl('https://'); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="ec-tb" title="Insert image" aria-label="Insert image" onMouseDown={e => e.preventDefault()}><ImagePlus size={15} /></button>
      </PopoverTrigger>
      <PopoverContent align="start" style={{ width: 320, padding: 10, background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)' }}>
        <label className="ec-label" htmlFor="ec-img-url">Image address (https)</label>
        <input id="ec-img-url" className="ec-input" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (/^https:\/\//i.test(url)) insert(url.trim()); } }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="ec-btn ec-btn-primary" disabled={!/^https:\/\/.+/i.test(url)} onClick={() => insert(url.trim())}>Insert</button>
          {onUpload && (
            <>
              <button type="button" className="ec-btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Spinner /> : null} Upload image…</button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={async e => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                setBusy(true); setErr('');
                try { insert(await onUpload(f)); } catch (x) { setErr(x instanceof Error ? x.message : 'Upload failed'); } finally { setBusy(false); }
              }} />
            </>
          )}
        </div>
        {err && <p role="alert" className="ec-hint" style={{ color: 'var(--color-error)', marginTop: 6 }}>{err}</p>}
        <p className="ec-hint" style={{ marginTop: 6 }}>Uploaded images travel inside the email (private — no public link).</p>
      </PopoverContent>
    </Popover>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────
export function RichEditor({ value, onChange, variables, env, onUploadImage, ariaLabel = 'Email body' }: {
  value: DocNode; onChange: (doc: DocNode) => void; variables: VariableOption[]; env: EditorEnv;
  onUploadImage?: (file: File) => Promise<string>; ariaLabel?: string;
}) {
  const knownRef = useRef(env.known);
  knownRef.current = env.known;
  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, blockquote: false, strike: false }),
    Underline,
    Link.configure({ openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } }),
    Image,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyle, Color,
    HighlightMark, ButtonNode, CalloutNode, ConditionalBlockNode, ConditionalBranchNode,
    variableHighlight(knownRef),
  ], []);

  // Keep every option the editor sees referentially stable: TipTap compares options on each
  // render and re-applies them (re-rendering all node views) when they differ. `content` is
  // only the INITIAL document — the editor owns the document afterwards (remount via `key` to reset).
  const initialContent = useRef(value).current;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editorProps = useMemo(() => ({ attributes: { class: 'ec-prose', role: 'textbox', 'aria-multiline': 'true', 'aria-label': ariaLabel } }), [ariaLabel]);
  const onUpdate = useCallback(({ editor: ed }: { editor: Editor }) => onChangeRef.current(ed.getJSON() as DocNode), []);

  const editor = useEditor({ extensions, content: initialContent as never, editorProps, onUpdate });

  // Re-run the highlighter when the set of valid variables changes. setProps({}) re-evaluates
  // decorations without dispatching a transaction (a transaction here would notify every
  // subscriber and re-render the editor).
  const knownKey = [...env.known].sort().join(',');
  useEffect(() => { if (editor && !editor.isDestroyed) editor.view.setProps({}); }, [editor, knownKey]);

  if (!editor) return <div className="ec-editor-wrap" style={{ minHeight: 320 }} />;

  const heading = editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : '0';
  const insertToken = (name: string) => editor.chain().focus().insertContent(`{{${name}}}`).run();
  const insertConditional = () => {
    const field = env.cond.fields[0]?.name ?? '';
    editor.chain().focus().insertContent({
      type: 'conditionalBlock',
      content: [
        { type: 'conditionalBranch', attrs: { when: newCondition(field) }, content: [{ type: 'paragraph' }] },
        { type: 'conditionalBranch', attrs: { when: null }, content: [{ type: 'paragraph' }] },
      ],
    }).run();
  };

  return (
    <EnvCtx.Provider value={env}>
      <div className="ec-editor-wrap">
        <div className="ec-toolbar" role="toolbar" aria-label="Formatting" aria-controls="ec-editor-surface">
          <Tb label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 size={15} /></Tb>
          <Tb label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 size={15} /></Tb>
          <span className="ec-sep" />
          <select aria-label="Text style" className="ec-mini" value={heading} onChange={e => {
            const v = e.target.value;
            if (v === '0') editor.chain().focus().setParagraph().run();
            else editor.chain().focus().setHeading({ level: Number(v) as 1 | 2 | 3 }).run();
          }}>
            <option value="0">Paragraph</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
          </select>
          <Tb label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Tb>
          <Tb label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Tb>
          <Tb label="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={15} /></Tb>
          <Tb label="Lime highlight" active={editor.isActive('highlight')} onClick={() => (editor.chain().focus() as unknown as { toggleHighlight: () => { run: () => void } }).toggleHighlight().run()}><Highlighter size={15} /></Tb>
          <label className="ec-tb" title="Text colour" style={{ cursor: 'pointer', position: 'relative' }}>
            <span aria-hidden style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid var(--color-hairline)', background: (editor.getAttributes('textStyle').color as string) || 'var(--color-ink)' }} />
            <input type="color" aria-label="Text colour" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
              value={/^#[0-9a-fA-F]{6}$/.test((editor.getAttributes('textStyle').color as string) ?? '') ? (editor.getAttributes('textStyle').color as string) : '#111111'}
              onInput={e => editor.chain().focus().setColor((e.target as HTMLInputElement).value).run()} />
          </label>
          <span className="ec-sep" />
          <Tb label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={15} /></Tb>
          <Tb label="Align centre" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={15} /></Tb>
          <Tb label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={15} /></Tb>
          <span className="ec-sep" />
          <Tb label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></Tb>
          <Tb label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></Tb>
          <LinkMenu editor={editor} />
          <ImageMenu editor={editor} onUpload={onUploadImage} />
          <Tb label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={15} /></Tb>
          <Tb label="Insert highlighted panel" onClick={() => editor.chain().focus().insertContent({ type: 'callout', attrs: { tone: 'highlight', label: '' }, content: [{ type: 'paragraph' }] }).run()}><Square size={15} /></Tb>
          <Tb label="Insert button" onClick={() => editor.chain().focus().insertContent({ type: 'button', attrs: { label: 'Click here', href: 'https://' } }).run()}><MousePointerClick size={15} /></Tb>
          <span className="ec-sep" />
          <VariableMenu options={variables} onPick={insertToken} />
          <button type="button" className="ec-tb" onMouseDown={e => e.preventDefault()} onClick={insertConditional} title="Show different content to different recipients">
            <GitBranch size={14} /> Conditional block
          </button>
        </div>
        <div id="ec-editor-surface"><EditorContent editor={editor} /></div>
      </div>
    </EnvCtx.Provider>
  );
}
