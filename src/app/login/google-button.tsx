"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from "firebase/auth";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { googleLoginAction } from "./actions";

/** Configuración PÚBLICA de la app web de Firebase (no es un secreto). */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

export const googleLoginEnabled = Boolean(config.apiKey && config.authDomain && config.projectId);

export function GoogleButton({ next }: { next?: string }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  if (!googleLoginEnabled) return null;

  async function signIn() {
    setError(undefined);
    setPending(true);
    try {
      const app = getApps().length ? getApp() : initializeApp(config);
      const auth = getAuth(app);
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      // La sesión de la aplicación la crea el servidor; el estado de Firebase en el navegador no se conserva.
      await signOut(auth);
      const res = await googleLoginAction(idToken, next ?? "/");
      if (res.error) setError(res.error);
      else window.location.assign(res.next ?? "/");
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setError(code === "auth/unauthorized-domain" ? "Este dominio aún no está autorizado en Firebase Authentication." : "No se pudo ingresar con Google. Inténtalo de nuevo.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" size="lg" className="w-full" onClick={signIn} disabled={pending}>
        <svg aria-hidden viewBox="0 0 48 48" className="size-4">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
          <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2.1 1.4-4.7 2.3-7.7 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        {pending ? "Conectando…" : "Ingresar con Google"}
      </Button>
      {error && (
        <p role="alert" className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
