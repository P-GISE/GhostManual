"use client";
import { HTTPError } from "ky";
import { useId, useState } from "react";
import { http, message } from "../lib/client";
import { useWorkspaceList } from "./CurrentWorkspace";
import { switchWorkspace } from "./Teams";

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
  const list = useWorkspaceList();
  const teams = list?.some((entry) => entry.current && entry.name === null)
    ? list.filter((entry) => entry.name !== null)
    : [];
  const [target, setTarget] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  if (!teams.length) return null;
  async function move() {
    if (!confirm || !target) return;
    onBusy(true);
    setError("");
    setUncertain(false);
    try {
      await http.post(`/api/sources/${id}/move`, {
        json: { targetWorkspaceId: target, acknowledgeAiHistoryDeletion: true },
      });
      onMoved(target);
    } catch (error) {
      setUncertain(!(error instanceof HTTPError) || error.response.status >= 500);
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
        disabled={disabled || uncertain}
        onChange={(event) => {
          setTarget(event.target.value);
          setConfirm(false);
          setUncertain(false);
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
          disabled={disabled || uncertain || !target}
          onChange={(event) => setConfirm(event.target.checked)}
        />
        관련 AI 질문·답변 기록이 영구 삭제되고 기존 공유 독자 세션이 종료되는 것을 확인했습니다.
      </label>
      <button
        type="button"
        className="secondary"
        disabled={disabled || uncertain || !target || !confirm}
        onClick={move}
      >
        이 업무를 팀으로 옮기기
      </button>
      {uncertain && (
        <>
          <p>
            응답을 받지 못했습니다. 선택한 팀에서 업무를 확인하세요. 업무가 없으면 개인 문서함으로
            돌아와 다시 시도하세요.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={async () => {
              onBusy(true);
              try {
                await switchWorkspace(target, `/sources/${id}`);
              } catch (error) {
                setError(await message(error));
              } finally {
                onBusy(false);
              }
            }}
          >
            선택한 팀에서 업무 확인
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
