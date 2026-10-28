"use client";
import { HTTPError } from "ky";
import { useEffect, useState } from "react";
import { z } from "zod";
import { http, message, read } from "../lib/client";
import { ManualDetail } from "./ManualDetail";
export function Share() {
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    async function exchange() {
      const token = window.location.hash.slice(1);
      try {
        window.history.replaceState(null, "", window.location.pathname);
        if (token) {
          const session = z
            .object({ manualId: z.uuid(), expiresAt: z.string() })
            .parse(await http.post("/api/share", { json: { token } }).json());
          setId(session.manualId);
        } else {
          const session = await read(
            "/api/session",
            z.object({ role: z.literal("reader"), manualId: z.uuid(), expiresAt: z.string() }),
            true,
          );
          setId(session.manualId);
        }
      } catch (e) {
        // Signed-out visitors log in first and come back to the same link.
        if (token && e instanceof HTTPError && e.response.status === 401) {
          const code = z.object({ error: z.object({ code: z.string() }) }).safeParse(e.data)?.data
            ?.error.code;
          if (code === "unauthorized" || code === "login_required") {
            window.location.assign(`/login?next=${encodeURIComponent(`/share#${token}`)}`);
            return;
          }
        }
        setError(await message(e));
      }
    }
    void exchange();
  }, []);
  return id ? (
    <ManualDetail id={id} reader />
  ) : (
    <section className="prose">
      <h1>공유 매뉴얼</h1>
      {error ? (
        <p className="error" role="alert">
          {error} 공유한 담당자에게 새 링크를 요청해 주세요.
        </p>
      ) : (
        <p role="status">읽기 전용 공유 권한을 확인하고 있습니다.</p>
      )}
    </section>
  );
}
