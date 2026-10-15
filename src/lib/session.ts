// Strażnik stron: zalogowany właściciel albo przekierowanie do logowania.
import { redirect } from "next/navigation";
import { isSignedIn } from "./auth";
import { ensureOwner } from "./repo";

export async function requireOwner() {
  if (!(await isSignedIn())) redirect("/login");
  return ensureOwner();
}

export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const v = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return v ? `https://${v}` : "http://localhost:3000";
}
