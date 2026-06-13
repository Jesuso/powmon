import { useId, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Group } from "@visx/group";
import { LinePath, Line, Bar, Area } from "@visx/shape";
import { scaleTime, scaleLinear } from "@visx/scale";
import { AxisLeft, AxisRight, AxisBottom } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { curveMonotoneX } from "@visx/curve";
import { ParentSize } from "@visx/responsive";
import { TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { bisector } from "d3-array";
import { dateLocale } from "../i18n/index.ts";
import { CHART_TOKENS, useTheme } from "../theme/index.tsx";
import type { FieldMeta, HistoryPoint } from "../../shared/types.ts";

export interface Gap { from: number; to: number }
export interface RefLine {
  value: number; label: string; color: string; dash?: boolean;
  axis?: "left" | "right"; // which y-scale the value lives on (default left)
  tip?: string;            // hover explanation (SVG <title>)
}

interface Props {
  title: string;
  unit: string;
  series: FieldMeta[];
  // Second value axis on the right (e.g. battery: SOC % left, volts right).
  seriesRight?: FieldMeta[];
  unitRight?: string;
  leftDomain?: [number, number]; // fixed left-axis domain (skip autoscale)
  data: HistoryPoint[];
  domain: [number, number];
  hoverT: number | null;
  onHover: (t: number | null) => void;
  onZoom: (range: [number, number] | null) => void;
  gaps: Gap[];
  gapThreshold: number;
  nights?: Gap[];
  refLines?: RefLine[];
  // Day-compare overlay: same series drawn dashed/dimmed. The caller pre-shifts
  // the timestamps onto the primary day's clock so both share one x-axis.
  compareData?: HistoryPoint[];
  compareLabel?: string;
  // When set, tooltip values also show money (value × rate).
  money?: { rate: number; currency: string };
  expanded?: boolean;
  onToggleExpand?: () => void;
  expandLabel?: string;
}

const MARGIN = { top: 12, right: 16, bottom: 28, left: 44 };
const RIGHT_AXIS_W = 40;
const DRAG_MIN_PX = 4;
const bisectT = bisector<HistoryPoint, number>((d) => d.t).left;

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function nearest(data: HistoryPoint[], t: number): HistoryPoint | null {
  if (!data.length) return null;
  let idx = bisectT(data, t);
  if (idx <= 0) idx = 0;
  else if (idx >= data.length) idx = data.length - 1;
  else if (t - data[idx - 1].t < data[idx].t - t) idx = idx - 1;
  return data[idx];
}

type InnerProps = Omit<Props, "title"> & { width: number; height: number };

function Inner({ width, height, series, seriesRight = [], leftDomain, data, domain, hoverT, onHover, onZoom, gaps, gapThreshold, nights = [], refLines = [], compareData, compareLabel, money }: InnerProps) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const c = CHART_TOKENS[resolved];
  const clipId = useId();
  const locale = dateLocale();
  // Multi-day windows need dates on the axis, not clock times.
  const span = domain[1] - domain[0];
  const timeFmt = (ts: number) => {
    const d = new Date(ts);
    return span > 48 * 3600_000
      ? d.toLocaleDateString(locale, { month: "short", day: "numeric" })
      : d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  };
  const hasRight = seriesRight.length > 0;
  const marginRight = hasRight ? RIGHT_AXIS_W : MARGIN.right;
  const iw = Math.max(10, width - MARGIN.left - marginRight);
  const ih = Math.max(10, height - MARGIN.top - MARGIN.bottom);

  const xScale = useMemo(
    () => scaleTime({ domain: [new Date(domain[0]), new Date(domain[1])], range: [0, iw] }),
    [domain, iw]
  );

  const visible = useMemo(
    () => data.filter((d) => d.t >= domain[0] && d.t <= domain[1]),
    [data, domain]
  );
  // Compare points inside the domain join the autoscale scan so the dashed
  // overlay stays framed instead of clipping at the primary day's extremes.
  const compareVisible = useMemo(
    () => (compareData ?? []).filter((d) => d.t >= domain[0] && d.t <= domain[1]),
    [compareData, domain]
  );

  const autoScale = useCallback((metas: FieldMeta[], refs: RefLine[]) => {
    let lo = Infinity, hi = -Infinity;
    for (const d of [...visible, ...compareVisible]) for (const s of metas) {
      for (const k of [s.key, `${s.key}__min`, `${s.key}__max`]) {
        const v = d[k];
        if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
    }
    // Keep reference lines on-chart so the curve is framed against its setpoints.
    for (const r of refs) { if (r.value < lo) lo = r.value; if (r.value > hi) hi = r.value; }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.1;
    return scaleLinear({ domain: [lo - pad, hi + pad], range: [ih, 0], nice: true });
  }, [visible, compareVisible, ih]);

  const leftRefs = useMemo(() => refLines.filter((r) => (r.axis ?? "left") === "left"), [refLines]);
  const rightRefs = useMemo(() => refLines.filter((r) => r.axis === "right"), [refLines]);

  const yScale = useMemo(() => {
    if (leftDomain) {
      // Tiny overshoot so a line pinned at the domain edge (SOC 100%) stays visible.
      const pad = (leftDomain[1] - leftDomain[0]) * 0.02;
      return scaleLinear({ domain: [leftDomain[0] - pad, leftDomain[1] + pad], range: [ih, 0] });
    }
    return autoScale(series, leftRefs);
  }, [leftDomain, ih, autoScale, series, leftRefs]);
  const yScaleRight = useMemo(
    () => (hasRight ? autoScale(seriesRight, rightRefs) : null),
    [hasRight, autoScale, seriesRight, rightRefs]
  );
  const scaleFor = (key: string) =>
    yScaleRight && seriesRight.some((s) => s.key === key) ? yScaleRight : yScale;

  const allSeries = useMemo(() => [...series, ...seriesRight], [series, seriesRight]);

  // Per-series points with a NaN sentinel inserted across data gaps so the
  // line breaks (via `defined`) instead of interpolating across an outage.
  const toLines = useCallback(
    (src: HistoryPoint[]) =>
      allSeries.map((s) => {
        const pts = src.filter((d) => Number.isFinite(d[s.key]));
        const out: HistoryPoint[] = [];
        for (let i = 0; i < pts.length; i++) {
          if (i > 0 && pts[i].t - pts[i - 1].t > gapThreshold) {
            out.push({ t: (pts[i - 1].t + pts[i].t) / 2 } as HistoryPoint); // sentinel: no s.key
          }
          out.push(pts[i]);
        }
        return { s, data: out };
      }),
    [allSeries, gapThreshold]
  );
  const lines = useMemo(() => toLines(data), [toLines, data]);
  const compareLines = useMemo(
    () => (compareData?.length ? toLines(compareData) : []),
    [toLines, compareData]
  );

  const [drag, setDragState] = useState<{ x0: number; x1: number } | null>(null);
  const dragRef = useRef<{ x0: number; x1: number } | null>(null);
  const setDrag = useCallback((d: { x0: number; x1: number } | null) => {
    dragRef.current = d;
    setDragState(d);
  }, []);
  const [mouseY, setMouseY] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const px = (e: React.MouseEvent) => {
    const p = localPoint(e);
    return p ? { x: p.x - MARGIN.left, y: p.y } : null;
  };

  const onDown = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const p = px(e);
    if (!p) return;
    e.preventDefault(); // stop native text selection from stealing the drag
    setDrag({ x0: p.x, x1: p.x });
    setMouseY(null);
    onHover(null);
  }, [onHover, setDrag]);

  // Once a drag starts, follow the mouse window-wide and clamp to the plot,
  // so dragging past the chart edge selects "up to the edge" instead of
  // dropping the zoom.
  useEffect(() => {
    if (!drag) return;
    const plotX = (e: MouseEvent): number | null => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return Math.max(0, Math.min(iw, e.clientX - rect.left - MARGIN.left));
    };
    const move = (e: MouseEvent) => {
      const x = plotX(e);
      if (x != null && dragRef.current) setDrag({ ...dragRef.current, x1: x });
    };
    const up = (e: MouseEvent) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const x = plotX(e) ?? d.x1;
      const a = Math.min(d.x0, x), b = Math.max(d.x0, x);
      if (b - a < DRAG_MIN_PX) return; // click, not a zoom
      onZoom([xScale.invert(a).getTime(), xScale.invert(b).getTime()]);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag !== null, iw, xScale, onZoom, setDrag]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (dragRef.current) return; // window handler owns drag updates
      const p = px(e);
      if (!p) return;
      const d = nearest(data, xScale.invert(p.x).getTime());
      if (!d) return;
      setMouseY(p.y);
      onHover(d.t);
    },
    [data, xScale, onHover]
  );

  const onLeave = useCallback(() => {
    if (dragRef.current) return; // keep the drag alive past the edge
    setMouseY(null);
    onHover(null);
  }, [onHover]);

  // Ref lines sit at their true value; labels get nudged apart so
  // near-identical setpoints (e.g. 54.8 V vs 55.2 V) stay readable.
  const refEntries = useMemo(() => {
    const entries = refLines
      // Right-axis refs vanish with their axis (legend-hidden series).
      .filter((r) => r.axis !== "right" || yScaleRight)
      .map((r, i) => ({ r, i, y: (r.axis === "right" && yScaleRight ? yScaleRight : yScale)(r.value), ly: 0 }))
      .sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const e of entries) {
      e.ly = Math.max(prev + 10, e.y - 3, 8);
      prev = e.ly;
    }
    return entries;
  }, [refLines, yScale, yScaleRight]);

  const hoverX = hoverT != null ? xScale(new Date(hoverT)) : null;
  const showLine = hoverX != null && hoverX >= 0 && hoverX <= iw;
  // Synced tooltip: readout on every chart at the shared hover timestamp,
  // unless that timestamp lands inside a data gap (no real sample there).
  const hoverPt = useMemo(() => (hoverT != null ? nearest(data, hoverT) : null), [hoverT, data]);
  const comparePt = useMemo(
    () => (hoverT != null && compareData?.length ? nearest(compareData, hoverT) : null),
    [hoverT, compareData]
  );
  const inGap = hoverT != null && hoverPt != null && Math.abs(hoverPt.t - hoverT) > gapThreshold;
  const showTip = !drag && showLine && hoverPt != null && !inGap;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <svg width={width} height={height}>
        <defs>
          <clipPath id={clipId}><rect x={0} y={0} width={iw} height={ih} /></clipPath>
        </defs>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={iw} height={ih} stroke={c.grid} strokeDasharray="2,3" />
          <GridColumns scale={xScale} width={iw} height={ih} stroke={c.grid} strokeDasharray="2,3" />
          <g clipPath={`url(#${clipId})`}>
            {nights.map((g, i) => {
              const a = Math.max(0, xScale(new Date(g.from)));
              const b = Math.min(iw, xScale(new Date(g.to)));
              if (b <= a) return null;
              return <Bar key={`n${i}`} x={a} y={0} width={b - a} height={ih}
                fill={c.night} opacity={c.nightOpacity} pointerEvents="none" />;
            })}
            {gaps.map((g, i) => {
              const a = Math.max(0, xScale(new Date(g.from)));
              const b = Math.min(iw, xScale(new Date(g.to)));
              if (b <= a) return null;
              return <Bar key={i} x={a} y={0} width={b - a} height={ih} fill="#9ca3af" opacity={0.13} pointerEvents="none" />;
            })}
            {compareLines.map(({ s, data: ld }) => (
              <LinePath<HistoryPoint>
                key={`cmp-${s.key}`}
                data={ld}
                defined={(d) => Number.isFinite(d[s.key])}
                x={(d) => xScale(new Date(d.t)) ?? 0}
                y={(d) => scaleFor(s.key)(d[s.key]) ?? 0}
                stroke={s.color}
                strokeWidth={1.3}
                strokeOpacity={0.55}
                strokeDasharray="4,3"
                curve={curveMonotoneX}
              />
            ))}
            {lines.map(({ s, data: ld }) => (
              <Area<HistoryPoint>
                key={`band-${s.key}`}
                data={ld}
                defined={(d) =>
                  Number.isFinite(d[`${s.key}__min`]) && Number.isFinite(d[`${s.key}__max`])}
                x={(d) => xScale(new Date(d.t)) ?? 0}
                y0={(d) => scaleFor(s.key)(d[`${s.key}__min`]) ?? 0}
                y1={(d) => scaleFor(s.key)(d[`${s.key}__max`]) ?? 0}
                fill={s.color}
                fillOpacity={0.14}
                stroke="none"
                curve={curveMonotoneX}
              />
            ))}
            {lines.map(({ s, data: ld }) => (
              <LinePath<HistoryPoint>
                key={s.key}
                data={ld}
                defined={(d) => Number.isFinite(d[s.key])}
                x={(d) => xScale(new Date(d.t)) ?? 0}
                y={(d) => scaleFor(s.key)(d[s.key]) ?? 0}
                stroke={s.color}
                strokeWidth={1.6}
                curve={curveMonotoneX}
              />
            ))}
          </g>
          {refEntries.map(({ r, i, y }) => (
            <Line key={`ref-${i}`} from={{ x: 0, y }} to={{ x: iw, y }} stroke={r.color} strokeWidth={1}
              strokeDasharray={r.dash === false ? undefined : "4,3"} opacity={0.7} pointerEvents="none" />
          ))}
          <AxisLeft scale={yScale} numTicks={4} stroke={c.axis} tickStroke={c.axis}
            tickLabelProps={() => ({
              // Dual axes: tint each axis to its line so ownership is obvious.
              fill: hasRight ? series[0]?.color ?? c.axisText : c.axisText,
              fontSize: 10, dx: -2, dy: 3, textAnchor: "end",
            })} />
          {yScaleRight && (
            <AxisRight scale={yScaleRight} left={iw} numTicks={4} stroke={c.axis} tickStroke={c.axis}
              tickLabelProps={() => ({
                fill: seriesRight[0]?.color ?? c.axisText,
                fontSize: 10, dx: 2, dy: 3, textAnchor: "start",
              })} />
          )}
          <AxisBottom scale={xScale} top={ih} numTicks={4} stroke={c.axis} tickStroke={c.axis}
            tickFormat={(v) => timeFmt(+v)}
            tickLabelProps={() => ({ fill: c.axisText, fontSize: 10, dy: 2, textAnchor: "middle" })} />
          {drag && (
            <Bar x={Math.min(drag.x0, drag.x1)} y={0} width={Math.abs(drag.x1 - drag.x0)} height={ih}
              fill={c.crosshair} opacity={0.15} pointerEvents="none" />
          )}
          {showLine && (
            <Line from={{ x: hoverX!, y: 0 }} to={{ x: hoverX!, y: ih }}
              stroke={c.crosshair} strokeWidth={1} strokeDasharray="3,3" pointerEvents="none" />
          )}
          <Bar x={0} y={0} width={iw} height={ih} fill="transparent" style={{ cursor: "crosshair" }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseLeave={onLeave}
            onDoubleClick={() => onZoom(null)} />
          {/* Labels above the capture bar so their <title> tips actually hover. */}
          {refEntries.map(({ r, i, ly }) => (
            <text key={`reflbl-${i}`} x={iw - 2} y={ly} fontSize={9} fill={r.color}
              textAnchor="end" opacity={0.9} style={{ cursor: r.tip ? "help" : undefined }}>
              {r.tip && <title>{r.tip}</title>}
              {r.label}
            </text>
          ))}
        </Group>
      </svg>
      {showTip && (
        <TooltipWithBounds left={hoverX! + MARGIN.left} top={mouseY ?? MARGIN.top + 4}
          style={{ ...defaultStyles, background: c.tooltipBg, color: c.tooltipText, border: `1px solid ${c.tooltipBorder}`, fontSize: 11 }}>
          <div style={{ opacity: 0.7, marginBottom: 4 }}>{new Date(hoverPt!.t).toLocaleString(locale)}</div>
          {allSeries.map((s) => (
            <div key={s.key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ width: 8, height: 8, background: s.color, borderRadius: 2, display: "inline-block" }} />
              <span style={{ flex: 1 }}>{t(`field.${s.key}`)}</span>
              <b>{fmt(hoverPt![s.key])}{s.unit && s.unit.length <= 3 ? ` ${s.unit}` : ""}</b>
              {Number.isFinite(hoverPt![`${s.key}__min`]) &&
                hoverPt![`${s.key}__min`] !== hoverPt![`${s.key}__max`] && (
                <span style={{ opacity: 0.55 }}>
                  {fmt(hoverPt![`${s.key}__min`])}–{fmt(hoverPt![`${s.key}__max`])}
                </span>
              )}
              {money && Number.isFinite(hoverPt![s.key]) && (
                <span style={{ opacity: 0.75 }}>{money.currency}{(hoverPt![s.key] * money.rate).toFixed(2)}</span>
              )}
            </div>
          ))}
          {compareLabel && comparePt && (
            <div style={{ marginTop: 6, paddingTop: 5, borderTop: `1px dashed ${c.tooltipBorder}` }}>
              <div style={{ opacity: 0.7, marginBottom: 3 }}>{compareLabel}</div>
              {allSeries.map((s) => (
                <div key={`cmp-${s.key}`} style={{ display: "flex", gap: 6, alignItems: "center", opacity: 0.8 }}>
                  <span style={{ width: 8, height: 8, background: s.color, opacity: 0.55, borderRadius: 2, display: "inline-block" }} />
                  <span style={{ flex: 1 }}>{t(`field.${s.key}`)}</span>
                  <b>{fmt(comparePt[s.key])}{s.unit && s.unit.length <= 3 ? ` ${s.unit}` : ""}</b>
                </div>
              ))}
            </div>
          )}
        </TooltipWithBounds>
      )}
    </div>
  );
}

export function TimeSeriesChart(props: Props) {
  const { t } = useTranslation();
  const all = [...props.series, ...(props.seriesRight ?? [])];
  // Click a legend item to hide/show that series. yScale, tooltip and lines
  // all derive from the filtered list, so they adapt for free.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < all.length - 1) next.add(key); // keep at least one visible
      return next;
    });
  const active = props.series.filter((s) => !hidden.has(s.key));
  const activeRight = (props.seriesRight ?? []).filter((s) => !hidden.has(s.key));
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{props.title}</span>
        <span className="card-head-right">
          <span className="card-unit">
            {props.unitRight ? `${props.unit} / ${props.unitRight}` : props.unit}
          </span>
          {props.onToggleExpand && (
            <button className="chart-max" aria-label={props.expandLabel} title={props.expandLabel}
              onClick={props.onToggleExpand}>
              {props.expanded ? "⤡" : "⤢"}
            </button>
          )}
        </span>
      </div>
      <div className="legend">
        {all.map((s) => (
          <button key={s.key} className={hidden.has(s.key) ? "legend-item off" : "legend-item"}
            aria-pressed={!hidden.has(s.key)} onClick={() => toggle(s.key)}>
            <i style={{ background: s.color }} />{t(`field.${s.key}`)}
          </button>
        ))}
        {props.compareLabel && (
          <span className="legend-cmp" title={t("app.compareLegend", { defaultValue: "Dashed lines = compare day" })}>
            <i />{props.compareLabel}
          </span>
        )}
      </div>
      <div className="chart-body">
        <ParentSize>{({ width, height }) =>
          <Inner {...props} series={active} seriesRight={activeRight} width={width} height={height || 220} />}</ParentSize>
      </div>
    </div>
  );
}
