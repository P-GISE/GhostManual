"use client";
export function SourceDelete({
  confirmed,
  disabled,
  onConfirm,
  onDelete,
}: {
  readonly confirmed: boolean;
  readonly disabled: boolean;
  readonly onConfirm: (confirmed: boolean) => void;
  readonly onDelete: () => void;
}) {
  return (
    <>
      {" "}
      <hr />
      <h2>원본 삭제</h2>
      <p className="help">
        이 원본과 연결된 매뉴얼, 공유 링크와 질문 기록을 영구 삭제합니다. 다른 원본은 유지됩니다.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled}
          onChange={(event) => onConfirm(event.target.checked)}
        />
        원본과 연결된 매뉴얼·공유·질문 기록의 영구 삭제를 확인했습니다.
      </label>
      <button
        type="button"
        className="secondary"
        disabled={disabled || !confirmed}
        onClick={onDelete}
      >
        이 원본 삭제
      </button>
    </>
  );
}
