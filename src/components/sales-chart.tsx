"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/domain/money";

export interface SalesPoint {
  label: string;
  sales: number;
  goal: number;
  reached: boolean;
}

const fmtM = (v: number) => `$${Math.round(v / 1_000_000)} M`;

/** Ventas mensuales (COP) frente a la meta. Un solo eje; la meta es una línea punteada. */
export function SalesChart({ data }: { data: SalesPoint[] }) {
  return (
    <div role="img" aria-label="Gráfico de ventas mensuales frente a la meta comercial" className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#E6E6E3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#B7BCBC" }} tick={{ fontSize: 12, fill: "#6E7677" }} />
          <YAxis tickFormatter={fmtM} tickLine={false} axisLine={false} width={64} tick={{ fontSize: 12, fill: "#6E7677" }} />
          <Tooltip
            cursor={{ fill: "rgba(0,102,99,0.06)" }}
            formatter={(value, name) => [formatMoney(String(value), "COP", 0), name]}
            contentStyle={{ border: "1px solid #E6E6E3", borderRadius: 8, fontSize: 12, boxShadow: "none" }}
          />
          <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sales" name="Ventas del mes" fill="#006663" maxBarSize={36} radius={[4, 4, 0, 0]} />
          <Line dataKey="goal" name="Meta mensual" stroke="#FA4616" strokeWidth={2} strokeDasharray="6 4" dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
