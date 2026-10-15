import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { login } from "../actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await isSignedIn()) redirect("/");
  const { e } = await searchParams;
  return (
    <main className="page">
      <form className="card login stack" action={login}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Task Hub</h1>
        <input className="in" type="password" name="password" placeholder="Hasło" autoFocus required />
        {e ? <div className="sub" style={{ color: "var(--danger)" }}>Złe hasło.</div> : null}
        <button className="pill primary" type="submit">Wejdź</button>
      </form>
    </main>
  );
}
