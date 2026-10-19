import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { guardMessage } from "@/lib/guard";
import { login } from "../actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string; t?: string }> }) {
  if (await isSignedIn()) redirect("/");
  const { e, t } = await searchParams;
  const msg = guardMessage(e, t);
  return (
    <main className="page">
      <form className="card login stack" action={login}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Task Hub</h1>
        <input className="in" type="password" name="password" placeholder="Hasło" autoFocus required />
        {msg ? <div className="sub" style={{ color: "var(--danger)" }}>{msg}</div> : null}
        <button className="pill primary" type="submit">Wejdź</button>
      </form>
    </main>
  );
}
