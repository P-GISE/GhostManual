import { isolatedDatabase } from "./isolated-database.ts";

export default async function setup(project: {
  config: { env: Record<string, string | undefined> };
}) {
  const target = project.config.env["DATABASE_URL"];
  if (!target) throw new Error("Missing isolated compatibility database target");
  const database = await isolatedDatabase(
    13,
    project.config.env["GHOSTMANUAL_TEST_ADMIN_URL"],
    new URL(target).pathname.slice(1),
  );
  return database.close;
}
