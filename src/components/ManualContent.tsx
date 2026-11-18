import type { ManualDraft } from "../lib/schemas";
import { toSections } from "../lib/sections";

export function ManualContent({ content }: { readonly content: ManualDraft }) {
  return (
    <article className="document">
      {toSections(content).map((section) => (
        <section key={section.id}>
          <h3>{section.name}</h3>
          {section.state === "na" ? (
            <p className="muted">해당 없음</p>
          ) : section.kind === "list" && section.items.length ? (
            <ol>
              {section.items.map((item) => (
                <li key={`${section.id}-${item}`}>{item}</li>
              ))}
            </ol>
          ) : (
            <p className={section.text ? undefined : "muted"}>
              {section.text ?? "확인된 내용 없음"}
            </p>
          )}
        </section>
      ))}
      <section>
        <h3>미확인 항목</h3>
        {content.unknowns.length ? (
          <ol>
            {content.unknowns.map((item) => (
              <li key={`unknowns-${item}`}>{item}</li>
            ))}
          </ol>
        ) : (
          <p className="muted">확인된 내용 없음</p>
        )}
      </section>
    </article>
  );
}
