import { ChartEngine } from './engine.ts';
import type { ChartOptions } from './engine.ts';
export { ChartEngine, formatPrice } from './engine.ts';
export { validateIndicatorOutput, indicatorRange, indicatorDataRange, indicatorPriceRange, indicatorY, indicatorValueAtY, indicatorLineSegments, bandPolygons, indicatorLayout, MAX_INDICATOR_PANES, MAX_INDICATOR_SERIES, MAX_INDICATOR_POINTS, MAX_INDICATOR_TOTAL_POINTS } from './indicators.ts';
export type { IndicatorPoint, IndicatorBandPoint, IndicatorPane, IndicatorSeries, IndicatorLineSeries, IndicatorHistogramSeries, IndicatorBandSeries, IndicatorOutput, IndicatorLayout, BandVertex, BandPolygon } from './indicators.ts';
export type { ChartOptions, ChartState } from './engine.ts';
export type { Candle, Anchor, Drawing, Tool, PriceScale } from './model.ts';
export { restoreDrawings, drawingStyle, DEFAULT_DRAWING_STYLE, MAX_DRAWINGS, MAX_BRUSH_POINTS } from './drawings.ts';
export { TOOL_GROUPS, DRAWING_KINDS, toolLabel, freehand, singlePoint } from './drawing-tools.ts';
export type { MagnetMode } from './magnet.ts';

/** Create a chart in a sized browser element. Call destroy() when unmounting. */
export function createChart(host: HTMLElement, options: Partial<ChartOptions> = {}): ChartEngine {
  return new ChartEngine(host, options);
}
