"use client";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";

const workspaces = z.array(
  z.object({
    id: z.uuid(),
    name: z.string().nullable(),
    current: z.boolean(),
  }),
);
export function SourceMove({
  id,
  disabled,
  onBusy,
  onMoved,
}: {
  readonly id: string;
  readonly disabled: boolean;
  readonly onBusy: (busy: boolean) => void;
  readonly onMoved: (target: string) => void;
}) {
  const fieldId = useId();
  const [teams, setTeams] = useState<z.infer<typeof workspaces>>([]);
  const [target, setTarget] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    read("/api/workspaces", workspaces)
      .then((list) => {
        if (active && list.some((entry) => entry.current && entry.name === null))
          setTeams(list.filter((entry) => entry.name !== null));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!teams.length) return null;
  async function move() {
    if (!confirm || !target) return;
    onBusy(true);
    setError("");
    try {
      await http.post(`/api/sources/${id}/move`, {
        json: { targetWorkspaceId: target, acknowledgeAiHistoryDeletion: true },
      });
      onMoved(target);
    } catch (error) {
      setError(await message(error));
    } finally {
      onBusy(false);
    }
  }
  return (
    <section aria-label="팀 문서함으로 업무 이동">
      <h3>팀 문서함으로 옮기기</h3>
      <p>
        원본·버전·매뉴얼·공유 링크는 유지됩니다. 옮긴 뒤에는 팀원이 이 업무를 열람하고 수정할 수
        있습니다. 개인 문서함에서는 사라집니다.
      </p>
      <label htmlFor={fieldId}>옮길 팀 문서함</label>
      <select
        id={fieldId}
        value={target}
        disabled={disabled}
        onChange={(event) => {
          setTarget(event.target.value);
          setConfirm(false);
        }}
      >
        <option value="">팀을 선택하세요</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <label>
        <input
          type="checkbox"
          checked={confirm}
          disabled={disabled || !target}
          onChange={(event) => setConfirm(event.target.checked)}
        />
        관련 AI 질문·답변 기록이 영구 삭제되고 기존 공유 독자 세션이 종료되는 것을 확인했습니다.
      </label>
      <button
        type="button"
        className="secondary"
        disabled={disabled || !target || !confirm}
        onClick={move}
      >
        이 업무를 팀으로 옮기기
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
