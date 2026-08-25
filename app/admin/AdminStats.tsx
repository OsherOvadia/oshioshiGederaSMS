"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LabelList,
  Label,
} from "recharts";

const PIE_TOP_N = 9;
const PIE_OTHER_MIN_PERCENT = 2;

const BAR_COLOR = "#b71c1c";
const BAR_COLOR_LIGHT = "#ef5350";
const CARD_SHADOW = "0 2px 12px rgba(0,0,0,0.08)";
const CARD_BORDER = "1px solid rgba(0,0,0,0.06)";

const PIE_COLORS = [
  "#1976d2",
  "#c62828",
  "#2e7d32",
  "#f57c00",
  "#7b1fa2",
  "#00838f",
  "#ad1457",
  "#546e7a",
  "#689f38",
  "#78909c",
];

type SignupsByDate = { date: string; count: number };
type CityCount = { name: string; value: number };

type Props = {
  signupsByDate: SignupsByDate[];
  cityCounts: CityCount[];
};

/**
 * The text alternative for a chart (WCAG 1.1.1). recharts emits unlabelled
 * <path> elements, so each chart is hidden from assistive technology and the
 * same numbers are offered as a real table beside it.
 */
function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: [string, string];
  rows: { label: string; value: number }[];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{columns[0]}</th>
          <th scope="col">{columns[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function groupCityCounts(items: CityCount[]): CityCount[] {
  if (items.length <= PIE_TOP_N) return items;
  const top = items.slice(0, PIE_TOP_N);
  const rest = items.slice(PIE_TOP_N);
  const otherSum = rest.reduce((s, x) => s + x.value, 0);
  if (otherSum > 0) top.push({ name: "אחר", value: otherSum });
  return top;
}

const CustomBarTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff",
      padding: "10px 14px",
      borderRadius: "8px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      border: "1px solid #eee",
      fontSize: "14px",
    }}>
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>{label}</div>
      <div style={{ color: "#555" }}>רישומים: {payload[0].value}</div>
    </div>
  );
};

const CustomPieTooltip = ({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload?: { percent?: number } }[] }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const percent = p.payload?.percent != null ? (p.payload.percent * 100).toFixed(1) : "";
  return (
    <div style={{
      background: "#fff",
      padding: "10px 14px",
      borderRadius: "8px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
      border: "1px solid #eee",
      fontSize: "14px",
    }}>
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>{p.name}</div>
      <div style={{ color: "#555" }}>{p.value} לקוחות {percent ? `(${percent}%)` : ""}</div>
    </div>
  );
};

export default function AdminStats({ signupsByDate, cityCounts }: Props) {
  const pieData = groupCityCounts(cityCounts);
  const total = pieData.reduce((s, x) => s + x.value, 0);

  return (
    <section className="stats-section" aria-labelledby="stats-heading" style={{ direction: "rtl", marginBottom: "28px" }}>
      <h2 id="stats-heading" className="stats-section-title" style={{
        borderBottom: "2px solid #b71c1c",
        paddingBottom: "6px",
        display: "inline-block",
        marginBottom: "16px",
        fontSize: "1.25rem",
        fontWeight: 700,
        color: "#1a1a1a",
      }}>
        סטטיסטיקות
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "stretch" }}>
        <div className="stats-card" style={{
          flex: "1 1 320px",
          minWidth: 0,
          background: "#fff",
          padding: "20px",
          border: CARD_BORDER,
          borderRadius: "12px",
          boxShadow: CARD_SHADOW,
        }}>
          <h3 style={{
            margin: "0 0 16px 0",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#333",
          }}>
            רישומים לפי תאריך
          </h3>
          {signupsByDate.length > 0 ? (
            <>
            <ChartDataTable
              caption="רישומים לפי תאריך"
              columns={["תאריך", "רישומים"]}
              rows={signupsByDate.map((d) => ({ label: d.date, value: d.count }))}
            />
            <div className="stats-chart-container" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signupsByDate} margin={{ top: 20, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "#555" }}
                  axisLine={{ stroke: "#e0e0e0" }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "#555" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: "rgba(183, 28, 28, 0.06)" }} />
                <Bar
                  dataKey="count"
                  name="רישומים"
                  fill={BAR_COLOR}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={56}
                >
                  <LabelList
                    dataKey="count"
                    position="top"
                    style={{ fontSize: 12, fill: "#333", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
            </>
          ) : (
            <p style={{ color: "#5f5a55", fontSize: "0.875rem", margin: 0 }}>אין עדיין נתוני רישום.</p>
          )}
        </div>
        <div className="stats-card stats-card-cities" style={{
          flex: "1 1 300px",
          minWidth: 0,
          background: "linear-gradient(180deg, #fafbfc 0%, #fff 100%)",
          padding: "24px",
          border: CARD_BORDER,
          borderRadius: "16px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
        }}>
          <h3 style={{
            margin: "0 0 20px 0",
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "#1a1a1a",
            letterSpacing: "0.02em",
          }}>
            ערים
          </h3>
          {pieData.length > 0 ? (
            <>
            <ChartDataTable
              caption={`לקוחות לפי עיר (סה״כ ${total})`}
              columns={["עיר", "לקוחות"]}
              rows={pieData.map((d) => ({ label: d.name, value: d.value }))}
            />
            <div className="stats-chart-container" aria-hidden="true" style={{ minHeight: "220px" }}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    // recharts focuses the pie root by default; the chart is
                    // aria-hidden in favour of the data table, and a focusable
                    // node inside an aria-hidden subtree is a WCAG failure.
                    rootTabIndex={-1}
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={pieData.length > 1 ? 2 : 0}
                    label={false}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="#fff" strokeWidth={2.5} />
                    ))}
                    <Label
                      position="center"
                      content={({ viewBox }) => {
                        const v = viewBox as { cx?: number; cy?: number } | undefined;
                        const cx = v?.cx ?? 0;
                        const cy = v?.cy ?? 0;
                        return (
                          <g textAnchor="middle" dominantBaseline="middle">
                            <text x={cx} y={cy - 6} fill="#1a1a1a" style={{ fontSize: "22px", fontWeight: 700 }}>
                              {total.toLocaleString("he-IL")}
                            </text>
                            <text x={cx} y={cy + 10} fill="#78909c" style={{ fontSize: "11px", fontWeight: 500 }}>
                              סה״כ
                            </text>
                          </g>
                        );
                      }}
                    />
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                  <Legend
                    layout="vertical"
                    align="left"
                    verticalAlign="middle"
                    wrapperStyle={{ fontSize: "13px", paddingRight: "8px" }}
                    iconType="square"
                    iconSize={10}
                    formatter={(value) => {
                      const item = pieData.find((d) => d.name === value);
                      const pct = item && total > 0 ? ((item.value / total) * 100).toFixed(0) : "";
                      return `${value} (${pct}%)`;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            </>
          ) : (
            <p style={{ color: "#5f5a55", fontSize: "0.875rem", margin: 0 }}>אין נתוני ערים.</p>
          )}
        </div>
      </div>
    </section>
  );
}
