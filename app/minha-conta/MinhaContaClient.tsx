"use client";

import { useRef, useState } from "react";
import { PasswordInput } from "../components/AuthClientButtons";

type Props = {
  initialName: string;
  email: string;
  initialPhone: string;
  initialImage: string | null;
  hasPassword: boolean;
};

export function MinhaContaClient({
  initialName,
  email,
  initialPhone,
  initialImage,
  hasPassword,
}: Props) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone); // UI apenas (não envia para API enquanto não existir no Prisma)
  const [previewImage, setPreviewImage] = useState<string | null>(initialImage);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // (opcional) valida 2MB
    if (file.size > 2 * 1024 * 1024) {
      setProfileMsg({ ok: false, text: "Imagem muito grande. Máx. 2MB." });
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => setPreviewImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // ✅ phone removido do payload (seu Prisma não tem phone ainda)
        body: JSON.stringify({ name, image: previewImage }),
      });

      if (res.ok) {
        setProfileMsg({ ok: true, text: "Perfil atualizado com sucesso!" });
      } else {
        const data = await res.json().catch(() => ({}));
        setProfileMsg({ ok: false, text: data.error ?? "Erro ao salvar." });
      }
    } catch {
      setProfileMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);

    if (!newPwd || newPwd.length < 6) {
      setPwdMsg({ ok: false, text: "A nova senha deve ter ao menos 6 caracteres." });
      return;
    }

    if (newPwd !== confirmPwd) {
      setPwdMsg({ ok: false, text: "As senhas não coincidem." });
      return;
    }

    setSavingPwd(true);

    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setPwdMsg({ ok: true, text: "Senha alterada com sucesso!" });
        setCurrentPwd("");
        setNewPwd("");
        setConfirmPwd("");
      } else {
        setPwdMsg({ ok: false, text: data.error ?? "Erro ao alterar senha." });
      }
    } catch {
      setPwdMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setSavingPwd(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Minha Conta</h1>

      {/* ---- Dados Pessoais ---- */}
      <form onSubmit={saveProfile} className="rounded-2xl border theme-card p-6 space-y-5">
        <p className="text-xs font-medium tracking-wide theme-muted">DADOS PESSOAIS</p>

        {/* Foto de perfil */}
        <div className="flex items-center gap-5">
          <div
            className="h-20 w-20 rounded-full ring-2 overflow-hidden theme-logo cursor-pointer flex items-center justify-center flex-shrink-0"
            onClick={() => fileRef.current?.click()}
            title="Clique para trocar a foto"
          >
            {previewImage ? (
              <img src={previewImage} alt="Foto" className="h-full w-full object-cover" />
            ) : (
              <span className="text-3xl theme-muted">
                {name ? name.charAt(0).toUpperCase() : "?"}
              </span>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition theme-btn"
            >
              Trocar foto
            </button>

            {previewImage && (
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="ml-2 rounded-xl px-4 py-2 text-sm text-rose-400 hover:text-rose-300 transition"
              >
                Remover
              </button>
            )}

            <p className="mt-1 text-xs theme-muted">JPG ou PNG, máx. 2MB</p>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
          </div>
        </div>

        {/* Nome */}
        <label className="grid gap-1">
          <span className="text-xs theme-muted">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            type="text"
            disabled={savingProfile}
            className="w-full rounded-xl px-4 py-3 text-sm theme-input"
            placeholder="Seu nome completo"
          />
        </label>

        {/* Email (somente leitura) */}
        <label className="grid gap-1">
          <span className="text-xs theme-muted">E-mail</span>
          <input
            value={email}
            readOnly
            className="w-full rounded-xl px-4 py-3 text-sm opacity-50 cursor-not-allowed theme-input"
          />
          <span className="text-xs theme-muted">O e-mail não pode ser alterado.</span>
        </label>

        {/* Telefone (UI apenas) */}
        <label className="grid gap-1">
          <span className="text-xs theme-muted">Telefone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            disabled={savingProfile}
            className="w-full rounded-xl px-4 py-3 text-sm theme-input"
            placeholder="(00) 00000-0000"
          />
        </label>

        {profileMsg && (
          <div
            className={`rounded-xl border px-4 py-2 text-sm ${
              profileMsg.ok
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/25 bg-rose-500/10 text-rose-300"
            }`}
          >
            {profileMsg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={savingProfile}
          className={
            savingProfile
              ? "w-full cursor-not-allowed rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200/60 ring-1 ring-emerald-500/10"
              : "w-full rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20 transition"
          }
        >
          {savingProfile ? "Salvando..." : "Salvar dados"}
        </button>
      </form>

      {/* ---- Alterar Senha ---- */}
      <form onSubmit={changePassword} className="rounded-2xl border theme-card p-6 space-y-4">
        <p className="text-xs font-medium tracking-wide theme-muted">ALTERAR SENHA</p>

        {hasPassword && (
          <label className="grid gap-1">
            <span className="text-xs theme-muted">Senha atual</span>
            <PasswordInput
              value={currentPwd}
              onChangeAction={setCurrentPwd}
              placeholder="Senha atual"
              disabled={savingPwd}
            />
          </label>
        )}

        <label className="grid gap-1">
          <span className="text-xs theme-muted">Nova senha</span>
          <PasswordInput
            value={newPwd}
            onChangeAction={setNewPwd}
            placeholder="Nova senha (mín. 6 caracteres)"
            autoComplete="new-password"
            disabled={savingPwd}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs theme-muted">Confirmar nova senha</span>
          <PasswordInput
            value={confirmPwd}
            onChangeAction={setConfirmPwd}
            placeholder="Repita a nova senha"
            autoComplete="new-password"
            disabled={savingPwd}
          />
        </label>

        {pwdMsg && (
          <div
            className={`rounded-xl border px-4 py-2 text-sm ${
              pwdMsg.ok
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/25 bg-rose-500/10 text-rose-300"
            }`}
          >
            {pwdMsg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={savingPwd}
          className={
            savingPwd
              ? "w-full cursor-not-allowed rounded-xl bg-blue-500/10 px-4 py-3 text-sm font-semibold text-blue-200/60 ring-1 ring-blue-500/10"
              : "w-full rounded-xl bg-blue-500/15 px-4 py-3 text-sm font-semibold text-blue-300 ring-1 ring-blue-500/20 hover:bg-blue-500/20 transition"
          }
        >
          {savingPwd ? "Alterando..." : "Alterar senha"}
        </button>
      </form>
    </div>
  );
}
