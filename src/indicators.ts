export type IndicatorPoint = { time: number; value: number | null };
export type IndicatorBandPoint = { time: number; value: number | null; value2: number | null };
export type IndicatorPane = { id: string; title: string; range?: [number, number]; levels?: { value: number; color?: string; label?: string }[] };
export type IndicatorSeriesBase = { id: string; name: string; paneId: string; color: string; offset?: number };
export type IndicatorLineSeries = IndicatorSeriesBase & { type: 'line'; points: IndicatorPoint[]; baseline?: number };
export type IndicatorHistogramSeries = IndicatorSeriesBase & { type: 'histogram'; points: IndicatorPoint[]; baseline?: number };
export type IndicatorBandSeries = IndicatorSeriesBase & { type: 'band'; points: IndicatorBandPoint[]; negativeColor?: string };
export type IndicatorSeries = IndicatorLineSeries | IndicatorHistogramSeries | IndicatorBandSeries;
export type BandVertex = { x: number; value: number; value2: number };
export type BandPolygon = { positive: boolean; vertices: { x: number; value: number }[] };
export type IndicatorOutput = { panes: IndicatorPane[]; series: IndicatorSeries[] };
export type IndicatorLayout = { paneCount: number; paneTop: number; paneHeight: number; paneSpace: number; priceBottom: number; volumeTop: number; volumeHeight: number };

export const MAX_INDICATOR_PANES = 4;
export const MAX_INDICATOR_SERIES = 64;
export const MAX_INDICATOR_POINTS = 100_000;
export const MAX_INDICATOR_TOTAL_POINTS = 500_000;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error(`${label} must be a short identifier.`);
}
function color(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} must be a color string.`);
}

/** Validate and detach an untrusted indicator result before replacing chart state. */
export function validateIndicatorOutput(input: unknown): IndicatorOutput {
  if (!record(input) || !Array.isArray(input.panes) || !Array.isArray(input.series)) throw new Error('Indicator output must contain panes and series arrays.');
  if (input.panes.length > MAX_INDICATOR_PANES || input.series.length > MAX_INDICATOR_SERIES) throw new Error('Indicator output exceeds the pane or series limit.');
  const paneIds = new Set<string>();
  const panes: IndicatorPane[] = input.panes.map((raw, index) => {
    if (!record(raw)) throw new Error(`Pane ${index} must be an object.`);
    identifier(raw.id, `Pane ${index} id`);
    if (raw.id === 'price' || paneIds.has(raw.id)) throw new Error(`Pane id ${raw.id} is reserved or duplicated.`);
    paneIds.add(raw.id);
    if (typeof raw.title !== 'string' || raw.title.length > 120) throw new Error(`Pane ${raw.id} title must be a string up to 120 characters.`);
    let range: [number, number] | undefined;
    if (raw.range !== undefined) {
      if (!Array.isArray(raw.range) || raw.range.length !== 2 || !raw.range.every(Number.isFinite) || raw.range[0] >= raw.range[1]) throw new Error(`Pane ${raw.id} range must contain two increasing finite values.`);
      range = [raw.range[0] as number, raw.range[1] as number];
    }
    let levels: IndicatorPane['levels'];
    if (raw.levels !== undefined) {
      if (!Array.isArray(raw.levels) || raw.levels.length > 100) throw new Error(`Pane ${raw.id} levels must be an array with at most 100 entries.`);
      levels = raw.levels.map((level, levelIndex) => {
        if (!record(level) || typeof level.value !== 'number' || !Number.isFinite(level.value)) throw new Error(`Pane ${raw.id} level ${levelIndex} must have a finite value.`);
        if (level.color !== undefined) color(level.color, `Pane ${raw.id} level ${levelIndex} color`);
        if (level.label !== undefined && (typeof level.label !== 'string' || level.label.length > 80)) throw new Error(`Pane ${raw.id} level ${levelIndex} label is too long.`);
        return { value: level.value, ...(level.color === undefined ? {} : { color: level.color as string }), ...(level.label === undefined ? {} : { label: level.label as string }) };
      });
    }
    return { id: raw.id, title: raw.title, ...(range ? { range } : {}), ...(levels ? { levels } : {}) };
  });
  const seriesIds = new Set<string>();
  let totalPoints = 0;
  const series: IndicatorSeries[] = input.series.map((raw, index) => {
    if (!record(raw)) throw new Error(`Series ${index} must be an object.`);
    identifier(raw.id, `Series ${index} id`);
    if (seriesIds.has(raw.id)) throw new Error(`Series id ${raw.id} is duplicated.`);
    seriesIds.add(raw.id);
    if (typeof raw.name !== 'string' || raw.name.length > 120) throw new Error(`Series ${raw.id} name must be a string up to 120 characters.`);
    identifier(raw.paneId, `Series ${raw.id} paneId`);
    if (raw.paneId !== 'price' && !paneIds.has(raw.paneId)) throw new Error(`Series ${raw.id} references an unknown pane.`);
    if (raw.type !== 'line' && raw.type !== 'histogram' && raw.type !== 'band') throw new Error(`Series ${raw.id} type must be line, histogram, or band.`);
    color(raw.color, `Series ${raw.id} color`);
    if (raw.negativeColor !== undefined) color(raw.negativeColor, `Series ${raw.id} negativeColor`);
    if (raw.offset !== undefined && (!Number.isInteger(raw.offset) || Math.abs(raw.offset as number) > 500)) throw new Error(`Series ${raw.id} offset must be an integer from -500 to 500.`);
    if (!Array.isArray(raw.points) || raw.points.length > MAX_INDICATOR_POINTS) throw new Error(`Series ${raw.id} points must be an array of at most ${MAX_INDICATOR_POINTS}.`);
    totalPoints += raw.points.length;
    if (totalPoints > MAX_INDICATOR_TOTAL_POINTS) throw new Error(`Indicator output exceeds the ${MAX_INDICATOR_TOTAL_POINTS} point limit.`);
    let previous = -1;
    const points = raw.points.map((point, pointIndex) => {
      if (!record(point) || !Number.isSafeInteger(point.time) || (point.time as number) < 0 || (point.time as number) > 8.64e15 || (point.value !== null && (typeof point.value !== 'number' || !Number.isFinite(point.value)))) throw new Error(`Series ${raw.id} point ${pointIndex} is invalid.`);
      if ((point.time as number) <= previous) throw new Error(`Series ${raw.id} times must be strictly increasing.`);
      previous = point.time as number;
      if (raw.type === 'band') {
        if (point.value2 !== null && (typeof point.value2 !== 'number' || !Number.isFinite(point.value2))) throw new Error(`Series ${raw.id} point ${pointIndex} second band value is invalid.`);
        if ((point.value === null) !== (point.value2 === null)) throw new Error(`Series ${raw.id} band point ${pointIndex} must null both values together.`);
        return { time: point.time as number, value: point.value as number | null, value2: point.value2 as number | null };
      }
      if (point.value2 !== undefined) throw new Error(`Series ${raw.id} point ${pointIndex} has a second value but is not a band.`);
      return { time: point.time as number, value: point.value as number | null };
    });
    if (raw.baseline !== undefined && (typeof raw.baseline !== 'number' || !Number.isFinite(raw.baseline))) throw new Error(`Series ${raw.id} baseline must be finite.`);
    if (raw.type === 'band' && raw.baseline !== undefined) throw new Error(`Band series ${raw.id} cannot have a baseline.`);
    return { id: raw.id, name: raw.name, paneId: raw.paneId, type: raw.type, color: raw.color, points, ...(raw.offset === undefined ? {} : { offset: raw.offset as number }), ...((raw.type === 'line' || raw.type === 'histogram') && raw.baseline !== undefined ? { baseline: raw.baseline as number } : {}), ...(raw.type === 'band' && raw.negativeColor !== undefined ? { negativeColor: raw.negativeColor as string } : {}) } as IndicatorSeries;
  });
  return { panes, series };
}

export function indicatorDataRange(
  series: IndicatorSeries[],
  visibleTime?: [number, number],
  timeForOffset?: (offset: number) => [number, number] | undefined,
  acceptValue: (value: number) => boolean = () => true,
): [number, number] | null {
  let low = Infinity, high = -Infinity;
  for (const item of series) {
    const itemTime = timeForOffset ? timeForOffset(item.offset ?? 0) : visibleTime;
    if (timeForOffset && !itemTime) continue;
    let start = 0, end = item.points.length;
    if (itemTime) {
      let left = 0, right = item.points.length;
      while (left < right) { const middle = (left + right) >>> 1; if (item.points[middle].time < itemTime[0]) left = middle + 1; else right = middle; }
      start = left;
      left = start; right = item.points.length;
      while (left < right) { const middle = (left + right) >>> 1; if (item.points[middle].time <= itemTime[1]) left = middle + 1; else right = middle; }
      end = left;
    }
    for (let i = start; i < end; i++) {
      const point = item.points[i];
      if (point.value !== null && acceptValue(point.value)) { low = Math.min(low, point.value); high = Math.max(high, point.value); }
      if (item.type === 'band') {
        const second = (point as IndicatorBandPoint).value2;
        if (second !== null && acceptValue(second)) { low = Math.min(low, second); high = Math.max(high, second); }
      }
    }
    if (item.type === 'histogram') { const baseline = item.baseline ?? 0; if (acceptValue(baseline)) { low = Math.min(low, baseline); high = Math.max(high, baseline); } }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return [low, high];
}

export function indicatorRange(series: IndicatorSeries[], fixed?: [number, number], visibleTime?: [number, number], timeForOffset?: (offset: number) => [number, number] | undefined): [number, number] {
  if (fixed) return [...fixed];
  const dataRange = indicatorDataRange(series, visibleTime, timeForOffset);
  if (!dataRange) return [0, 1];
  const [low, high] = dataRange;
  const span = high / 2 - low / 2;
  const pad = low === high ? Math.max(Math.abs(low) * 0.05, 1) : span * 0.12;
  return [Math.max(-Number.MAX_VALUE, low - pad), Math.min(Number.MAX_VALUE, high + pad)];
}

export function indicatorPriceRange(candles: [number, number] | null, overlays: [number, number] | null, log: boolean): [number, number] {
  if (!candles) {
    if (!overlays || log && overlays[0] <= 0) return log ? [1, 10] : [0, 1];
    if (log) {
      const low = Math.log(overlays[0]), high = Math.log(overlays[1]);
      const pad = Math.max((high - low) * 0.12, 0.0001);
      return [Math.max(Number.MIN_VALUE, Math.exp(low - pad)), Math.min(Number.MAX_VALUE, Math.exp(high + pad))];
    }
    const pad = Math.max((overlays[1] - overlays[0]) * 0.12, Math.abs(overlays[1]) * 0.0001, 0.000001);
    return [Math.max(-Number.MAX_VALUE, overlays[0] - pad), Math.min(Number.MAX_VALUE, overlays[1] + pad)];
  }
  if (!overlays || (overlays[0] >= candles[0] && overlays[1] <= candles[1])) return candles;
  if (log) {
    const low = Math.log(Math.min(candles[0], overlays[0] > 0 ? overlays[0] : candles[0]));
    const high = Math.log(Math.max(candles[1], overlays[1] > 0 ? overlays[1] : candles[1]));
    const pad = (high - low) * 0.04;
    return [Math.max(Number.MIN_VALUE, Math.exp(low - pad)), Math.min(Number.MAX_VALUE, Math.exp(high + pad))];
  }
  const low = Math.min(candles[0], overlays[0]), high = Math.max(candles[1], overlays[1]);
  const pad = Math.max((high - low) * 0.04, Math.abs(high) * 0.00003, 0.000001);
  return [Math.max(-Number.MAX_VALUE, low - pad), Math.min(Number.MAX_VALUE, high + pad)];
}

/** Split each contiguous band edge pair at any crossing into fillable polygons. */
export function bandPolygons(points: BandVertex[]): BandPolygon[] {
  const polygons: BandPolygon[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const directA = a.value - a.value2, directB = b.value - b.value2;
    const diffA = Number.isFinite(directA) ? directA : a.value / 2 - a.value2 / 2;
    const diffB = Number.isFinite(directB) ? directB : b.value / 2 - b.value2 / 2;
    if (diffA === 0 && diffB === 0) continue;
    const crosses = diffA < 0 && diffB > 0 || diffA > 0 && diffB < 0;
    if (!crosses) {
      polygons.push({ positive: diffA === 0 ? diffB >= 0 : diffA > 0, vertices: [{ x: a.x, value: a.value }, { x: b.x, value: b.value }, { x: b.x, value: b.value2 }, { x: a.x, value: a.value2 }] });
      continue;
    }
    const magnitude = Math.max(Math.abs(diffA), Math.abs(diffB));
    const normalizedA = diffA / magnitude, normalizedB = diffB / magnitude;
    const t = normalizedA / (normalizedA - normalizedB);
    const x = a.x + (b.x - a.x) * t;
    const crossing = a.value * (1 - t) + b.value * t;
    polygons.push({ positive: diffA > 0, vertices: [{ x: a.x, value: a.value }, { x, value: crossing }, { x, value: crossing }, { x: a.x, value: a.value2 }] });
    polygons.push({ positive: diffB > 0, vertices: [{ x, value: crossing }, { x: b.x, value: b.value }, { x: b.x, value: b.value2 }, { x, value: crossing }] });
  }
  return polygons;
}

export function indicatorY(value: number, range: [number, number], top: number, bottom: number): number {
  const directSpan = range[1] - range[0];
  const fraction = Number.isFinite(directSpan)
    ? (value - range[0]) / directSpan
    : (value / 2 - range[0] / 2) / (range[1] / 2 - range[0] / 2);
  return bottom - fraction * (bottom - top);
}

export function indicatorValueAtY(y: number, range: [number, number], top: number, bottom: number): number {
  const fraction = Math.max(0, Math.min(1, (bottom - y) / Math.max(Number.EPSILON, bottom - top)));
  return (range[0] / 2 * (1 - fraction) + range[1] / 2 * fraction) * 2;
}

export function indicatorLineSegments(points: IndicatorPoint[]): IndicatorPoint[][] {
  const segments: IndicatorPoint[][] = [];
  let current: IndicatorPoint[] = [];
  for (const point of points) {
    if (point.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

/** Compute bounded independent-pane geometry; zero panes retain the legacy chart layout. */
export function indicatorLayout(bottom: number, requestedCount: number, showVolume: boolean): IndicatorLayout {
  const count = Math.max(0, Math.min(MAX_INDICATOR_PANES, Math.floor(requestedCount)));
  if (!count) {
    const priceBottom = showVolume ? bottom * 0.77 : bottom - 12;
    return { paneCount: 0, paneTop: bottom, paneHeight: 0, paneSpace: 0, priceBottom, volumeTop: priceBottom + 28, volumeHeight: showVolume ? bottom - priceBottom : 0 };
  }
  const paneSpace = Math.min(count * 112, Math.max(0, bottom - 130));
  if (paneSpace < count) return indicatorLayout(bottom, 0, showVolume);
  const volumeHeight = showVolume ? Math.min(100, Math.max(24, (bottom - paneSpace - 80) * 0.24)) : 0;
  const priceBottom = Math.max(18, bottom - paneSpace - volumeHeight - (showVolume && volumeHeight > 0 ? 24 : 12));
  const paneHeight = paneSpace / count;
  return { paneCount: count, paneTop: bottom - paneSpace, paneHeight, paneSpace, priceBottom, volumeTop: priceBottom + 28, volumeHeight };
}
