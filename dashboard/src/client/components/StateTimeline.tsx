import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Group } from "@visx/group";
import { Line, Bar } from "@visx/shape";
import { scaleTime } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { localPoint } from "@visx/event";
import { dateLocale } from "../i18n/index.ts";
import { CHART_TOKENS, useTheme } from "../theme/index.tsx";
import type { StateTransition } from "../../shared/types.ts";

interface Props {
  domain: [number, number];
  transitions: StateTransition[];
  hoverT: number | null;
  onHover: (t: number | null) => void;
  onZoom: (range: [number, number] | null) => void;
}

const MARGIN = { top: 6, right: 16, bottom: 4, left: 44 };
const LANE_H = 16;
const LANE_GAP = 6;
const LABEL_W = 40;
const DRAG_MIN_PX = 4;

// machine_state_txt → band color. Grid-fed = amber, battery/inverter = green.
function machineColor(s: string): string {
  switch (s) {
    case "AC-power": case "AC->inv": return "#f59e0b"; // mains
    case "inverter": case "inv->AC": return "#22c55e"; // battery/PV
    case "init": case "soft-start": case "batt-activate": return "#3b82f6";
    case "fault": return "#ef4444";
    default: return "#6b7280"; // standby / shutdown / unknown
  }
}
// charge_state_txt → band color.
function chargeColor(s: string): string {
  switch (s) {
    case "quick": return "#f59e0b";
    case "const-V": return "#eab308";
    case "float": return "#22c55e";
    case "Li-activate": return "#06b6d4";
    case "full": return "#16a34a";
    default: return "#6b7280"; // off / unknown
  }
}

const MAINS_STATES = new Set(["AC-power", "AC->inv"]);
const BATTERY_STATES = new Set(["inverter", "inv->AC"]);

interface Seg { state: string; start: number; end: number }

// Per-lane segments: merge consecutive transitions with the same value for
// this lane, so a charge-only flip doesn't split the mode lane (and vice
// versa). Each band boundary is a real change in its own lane.
function laneSegs(
  transitions: StateTransition[],
  pick: (tr: StateTransition) => string,
  domain: [number, number]
): Seg[] {
  const out: Seg[] = [];
  for (const tr of transitions) {
    const v = pick(tr);
    const last = out[out.length - 1];
    if (last && last.state === v) continue;
    if (last) last.end = tr.t;
    out.push({ state: v, start: tr.t, end: domain[1] });
  }
  return out.filter((s) => s.end > domain[0] && s.start < domain[1]);
}

function fmtDur(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

function Inner({ width, domain, transitions, hoverT, onHover, onZoom }: Props & { width: number }) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const c = CHART_TOKENS[resolved];
  const locale = dateLocale();
  const iw = Math.max(10, width - MARGIN.left - MARGIN.right);
  const height = MARGIN.top + LANE_H * 2 + LANE_GAP + MARGIN.bottom;
  const lanesH = LANE_H * 2 + LANE_GAP;

  const xScale = useMemo(
    () => scaleTime({ domain: [new Date(domain[0]), new Date(domain[1])], range: [0, iw] }),
    [domain, iw]
  );

  const machineSegs = useMemo(() => laneSegs(transitions, (tr) => tr.machine, domain), [transitions, domain]);
  const chargeSegs = useMemo(() => laneSegs(transitions, (tr) => tr.charge, domain), [transitions, domain]);

  const clampX = (v: number) => Math.max(0, Math.min(iw, v));
  const machineY = MARGIN.top;
  const chargeY = MARGIN.top + LANE_H + LANE_GAP;

  // Drag-to-zoom, same pattern as TimeSeriesChart: window-wide tracking so
  // dragging past the edge selects "up to the edge" instead of dropping it.
  const [drag, setDragState] = useState<{ x0: number; x1: number } | null>(null);
  const dragRef = useRef<{ x0: number; x1: number } | null>(null);
  const setDrag = (d: { x0: number; x1: number } | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const onDown = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const p = localPoint(e);
    if (!p) return;
    e.preventDefault(); // stop native text selection from stealing the drag
    setDrag({ x0: p.x - MARGIN.left, x1: p.x - MARGIN.left });
    onHover(null);
  }, [onHover]);

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
  }, [drag !== null, iw, xScale, onZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (dragRef.current) return; // window handler owns drag updates
      const p = localPoint(e);
      if (!p) return;
      onHover(xScale.invert(p.x - MARGIN.left).getTime());
    },
    [xScale, onHover]
  );

  const onLeave = useCallback(() => {
    if (dragRef.current) return; // keep the drag alive past the edge
    onHover(null);
  }, [onHover]);

  const hoverX = hoverT != null ? xScale(new Date(hoverT)) : null;
  const showLine = !drag && hoverX != null && hoverX >= 0 && hoverX <= iw;

  const timeFmt = (ts: number) =>
    new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  const band = (seg: Seg, y: number, color: string, label: string) => {
    const from = Math.max(seg.start, domain[0]);
    const to = Math.min(seg.end, domain[1]);
    const a = clampX(xScale(new Date(from)));
    const b = clampX(xScale(new Date(to)));
    if (b - a < 0.5) return null;
    return (
      <g key={`${y}-${seg.start}`}>
        <rect x={a} y={y} width={b - a} height={LANE_H} fill={color} opacity={0.85} rx={2}>
          <title>{`${label} · ${timeFmt(seg.start)}–${timeFmt(seg.end)} · ${fmtDur(seg.end - seg.start)}`}</title>
        </rect>
        {b - a > 46 && (
          <text x={a + 4} y={y + LANE_H - 4} fontSize={10} fill="#0b0b0b" opacity={0.85} pointerEvents="none">
            {label}
          </text>
        )}
      </g>
    );
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={0}>
          {machineSegs.map((s) => band(s, machineY, machineColor(s.state), t(`mode.${s.state}`, { defaultValue: s.state })))}
          {chargeSegs.map((s) => band(s, chargeY, chargeColor(s.state), t(`chargeState.${s.state}`, { defaultValue: s.state })))}

          {drag && (
            <Bar x={Math.min(drag.x0, drag.x1)} y={machineY} width={Math.abs(drag.x1 - drag.x0)} height={lanesH}
              fill={c.crosshair} opacity={0.2} pointerEvents="none" />
          )}
          {showLine && (
            <Line from={{ x: hoverX!, y: machineY }} to={{ x: hoverX!, y: machineY + lanesH }}
              stroke={c.crosshair} strokeWidth={1} strokeDasharray="3,3" pointerEvents="none" />
          )}
          <Bar x={0} y={machineY} width={iw} height={lanesH} fill="transparent" style={{ cursor: "crosshair" }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseLeave={onLeave} />
        </Group>
        {/* lane labels in the left margin */}
        <text x={LABEL_W} y={machineY + LANE_H - 4} fontSize={10} fill={c.axisText} textAnchor="end">
          {t("band.mode")}
        </text>
        <text x={LABEL_W} y={chargeY + LANE_H - 4} fontSize={10} fill={c.axisText} textAnchor="end">
          {t("band.charge")}
        </text>
      </svg>
    </div>
  );
}

export function StateTimeline(props: Props) {
  const { t } = useTranslation();
  const { domain, transitions } = props;

  // Visible-window time shares: how long on mains vs battery/PV. Shown in
  // the legend so the band answers "how grid-dependent was I" at a glance.
  const shares = useMemo(() => {
    let mains = 0, battery = 0;
    for (const seg of laneSegs(transitions, (tr) => tr.machine, domain)) {
      const ms = Math.min(seg.end, domain[1]) - Math.max(seg.start, domain[0]);
      if (MAINS_STATES.has(seg.state)) mains += ms;
      else if (BATTERY_STATES.has(seg.state)) battery += ms;
    }
    const span = domain[1] - domain[0];
    return span > 0 && mains + battery > 0
      ? { mains: Math.round((mains / span) * 100), battery: Math.round((battery / span) * 100) }
      : null;
  }, [transitions, domain]);

  return (
    <div className="card band-card">
      <div className="card-head">
        <span className="card-title">{t("band.title")}</span>
        <span className="legend">
          <span className="legend-item">
            <i style={{ background: "#f59e0b" }} />
            {t("band.mains")}{shares ? ` ${shares.mains}%` : ""}
          </span>
          <span className="legend-item">
            <i style={{ background: "#22c55e" }} />
            {t("band.battery")}{shares ? ` ${shares.battery}%` : ""}
          </span>
        </span>
      </div>
      <ParentSize>{({ width }) => <Inner {...props} width={width} />}</ParentSize>
    </div>
  );
}
