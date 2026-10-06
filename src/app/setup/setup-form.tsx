"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setupAction, type SetupState } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});
  if (state.done) {
    return (
      <div className="space-y-4">
        <p role="status" className="border-l-2 border-brand bg-muted px-3 py-2 text-sm">
          Administrador creado. Esta página queda cerrada para siempre.
        </p>
        <Button render={<Link href="/login" />} size="lg" className="w-full">
          Ir a ingresar
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="token">Token de configuración</Label>
        <Input id="token" name="token" type="password" autoComplete="off" required autoFocus />
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Nombre del administrador</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña (mínimo 12 caracteres)</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {state.error && (
        <p role="alert" className="border-l-2 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creando…" : "Crear administrador"}
      </Button>
    </form>
  );
}
