"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { message, read } from "../lib/client";

const cellSchema = z
  .object({
    t: z.string(),
    v: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    f: z.string().optional(),
  })
  .nullable();
const changesSchema = z.object({
  compared: z.boolean(),
  total: z.number(),
  changes: z.array(
    z.object({ sheet: z.string(), address: z.string(), before: cellSchema, after: cellSchema }),
  ),
});
type Cell = z.infer<typeof cellSchema>;
const show = (cell: Cell) =>
  cell === null ? "(빈 칸)" : cell.f !== undefined ? `=${cell.f}` : String(cell.v ?? "");

// Loaded only when opened: a version can change thousands of cells.
export function CellChanges({
  sourceId,
  revision,
}: {
  readonly sourceId: string;
  readonly revision: number;
}) {
  const [data, setData] = useState<z.infer<typeof changesSchema> | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  function load(open: boolean) {
    if (!open || data || pending.current) return;
    pending.current = true;
    setError("");
    read(`/api/sources/${sourceId}/revisions/${revision}/cells`, changesSchema)
      .then(setData)
      .catch(async (e) => setError(await message(e)))
      .finally(() => {
        pending.current = false;
      });
  }
  return (
    <details onToggle={(e) => load(e.currentTarget.open)}>
      <summary>칸별 변경 보기 (이전 값 → 새 값)</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">칸별 변경을 불러오고 있습니다.</p>}
      {data && !data.compared && (
        <p className="help">
          시트·셀이 많아 이 버전은 칸별로 비교하지 않았습니다. 두 버전 원본을 내려받아 확인하세요.
        </p>
      )}
      {data?.compared && (
        <>
          <p className="help">
            바뀐 칸 {data.total.toLocaleString()}개
            {data.total > data.changes.length
              ? ` · 처음 ${data.changes.length.toLocaleString()}개만 표시합니다. 전체는 두 버전 원본을 내려받아 확인하세요.`
              : ""}{" "}
            · 이 기록은 서비스 안에만 저장되며 AI로 보내지 않습니다.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">시트</th>
                  <th scope="col">칸</th>
                  <th scope="col">이전</th>
                  <th scope="col">이후</th>
                </tr>
              </thead>
              <tbody>
                {data.changes.map((c) => (
                  <tr key={`${c.sheet}!${c.address}`}>
                    <td>{c.sheet}</td>
                    <td>{c.address}</td>
                    <td>
                      <del>{show(c.before)}</del>
                    </td>
                    <td>
                      <ins>{show(c.after)}</ins>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
