import type { Drawing } from './model.ts';

export const TOOL_GROUPS: { id: string; label: string; icon: string; tools: { kind: Drawing['kind']; label: string }[] }[] = [
  { id: 'lines', label: 'Lines', icon: 'trend', tools: [
    { kind: 'trend', label: 'Trendline' }, { kind: 'ray', label: 'Ray' }, { kind: 'extended', label: 'Extended line' },
    { kind: 'info', label: 'Info line' }, { kind: 'horizontal', label: 'Horizontal line' }, { kind: 'horizontal-ray', label: 'Horizontal ray' },
    { kind: 'vertical', label: 'Vertical line' }, { kind: 'crossline', label: 'Crossline' },
  ] },
  { id: 'fibonacci', label: 'Fibonacci', icon: 'fib', tools: [{ kind: 'fib', label: 'Fib retracement' }, { kind: 'fib-time', label: 'Fib time zone' }] },
  { id: 'brushes', label: 'Brushes', icon: 'brush', tools: [{ kind: 'brush', label: 'Brush' }, { kind: 'highlighter', label: 'Highlighter' }] },
  { id: 'arrows', label: 'Arrows', icon: 'arrow', tools: [{ kind: 'arrow', label: 'Arrow' }, { kind: 'arrow-up', label: 'Arrow mark up' }, { kind: 'arrow-down', label: 'Arrow mark down' }] },
  { id: 'shapes', label: 'Shapes', icon: 'rectangle', tools: [{ kind: 'rectangle', label: 'Rectangle' }, { kind: 'circle', label: 'Circle' }, { kind: 'ellipse', label: 'Ellipse' }] },
  { id: 'measures', label: 'Measures', icon: 'measure', tools: [{ kind: 'price-range', label: 'Price range' }, { kind: 'date-range', label: 'Date range' }, { kind: 'range', label: 'Date and price range' }] },
];
export const DRAWING_KINDS = TOOL_GROUPS.flatMap(g => g.tools.map(t => t.kind));
export const toolLabel = (kind: Drawing['kind']) => TOOL_GROUPS.flatMap(g => g.tools).find(t => t.kind === kind)?.label ?? kind;
export const freehand = (kind: string) => kind === 'brush' || kind === 'highlighter';
export const singlePoint = (kind: string) => ['horizontal', 'horizontal-ray', 'vertical', 'crossline', 'arrow-up', 'arrow-down'].includes(kind);
export const boxShape = (kind: string) => ['rectangle', 'ellipse', 'range'].includes(kind);
