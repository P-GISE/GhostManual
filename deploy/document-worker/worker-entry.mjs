import { lstatSync, readFileSync } from "node:fs";

try {
  if (
    process.getuid() !== 1000 ||
    process.getgid() !== 1000 ||
    process.env.DOCUMENT_EXTRACTOR_URL !== "https://localhost:18443/" ||
    !process.env.DATABASE_URL ||
    [
      "DOCUMENT_EXTRACTOR_CA",
      "DOCUMENT_EXTRACTOR_CERT",
      "DOCUMENT_EXTRACTOR_KEY",
      "ANTHROPIC_API_KEY",
      "SMTP_APP_PASSWORD",
      "GOOGLE_CLIENT_SECRET",
    ].some((name) => name in process.env)
  ) {
    throw new Error();
  }
  const status = Object.fromEntries(
    readFileSync("/proc/self/status", "utf8")
      .split("\n")
      .filter((line) => line.includes(":"))
      .map((line) => line.split(":", 2).map((value) => value.trim())),
  );
  if (
    ["CapEff", "CapPrm", "CapInh", "CapAmb", "CapBnd"].some(
      (name) => !/^0+$/.test(status[name] ?? ""),
    ) ||
    status.NoNewPrivs !== "1"
  )
    throw new Error();
  process.umask(0o077);
  for (const [name, file] of [
    ["DOCUMENT_EXTRACTOR_CA", "server-ca.pem"],
    ["DOCUMENT_EXTRACTOR_CERT", "client-cert.pem"],
    ["DOCUMENT_EXTRACTOR_KEY", "client-key.pem"],
  ]) {
    const path = `/run/secrets/${file}`;
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.uid !== 1000 ||
      (stat.mode & 0o777) !== 0o400 ||
      stat.size < 1 ||
      stat.size > 65536
    ) {
      throw new Error();
    }
    process.env[name] = readFileSync(path, "utf8");
  }
  await import("/app/scripts/document-jobs.ts");
} catch {
  console.error("document worker startup rejected");
  process.exitCode = 1;
}
