'use client';

import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

function errorMessage(status: number | undefined): string {
  if (status === 429) return 'Muitas tentativas. Aguarde alguns minutos.';
  return 'Código inválido. Confira o horário do celular e tente de novo.';
}

function CodeForm({
  label,
  inputMode,
  onCode,
  submitLabel,
}: {
  label: string;
  inputMode: 'numeric' | 'text';
  onCode: (code: string) => Promise<string | null>;
  submitLabel: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    const err = await onCode(code);
    setPending(false);
    if (err) setError(err);
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="code">{label}</label>
      <input
        id="code"
        name="code"
        inputMode={inputMode}
        autoComplete="one-time-code"
        required
        {...(inputMode === 'numeric' ? { pattern: '[0-9]{6}', maxLength: 6 } : {})}
      />
      <p>
        <button type="submit" disabled={pending}>
          {pending ? 'Verificando…' : submitLabel}
        </button>
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Primeira configuração: gera o segredo, mostra o QR (gerado no navegador) e os códigos de recuperação. */
export function MfaSetup() {
  const router = useRouter();
  const [setup, setSetup] = useState<{ qr: string; secret: string; backupCodes: string[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({});
    if (err || !data || !('totpURI' in data)) {
      setError('Não foi possível iniciar a configuração. Tente de novo.');
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get('secret') ?? '';
    // O QR é gerado localmente: o segredo nunca vai para serviço de terceiros.
    const qr = await QRCode.toDataURL(data.totpURI);
    setSetup({ qr, secret, backupCodes: data.backupCodes });
  }

  if (!setup) {
    return (
      <>
        <button type="button" onClick={start}>
          Configurar aplicativo autenticador
        </button>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <div className="card">
        <h2>1. Leia o QR code no aplicativo</h2>
        <img
          src={setup.qr}
          alt="QR code para configurar o aplicativo autenticador"
          width={200}
          height={200}
        />
        <p>
          Sem câmera? Digite esta chave no aplicativo:{' '}
          <span className="code" data-testid="totp-secret">
            {setup.secret}
          </span>
        </p>
      </div>
      <div className="card">
        <h2>2. Guarde os códigos de recuperação</h2>
        <p>Cada código funciona uma vez, se você perder o celular. Guarde em local seguro.</p>
        <ul data-testid="backup-codes">
          {setup.backupCodes.map((c) => (
            <li key={c} className="code">
              {c}
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>3. Confirme com um código</h2>
        <CodeForm
          label="Código de 6 dígitos"
          inputMode="numeric"
          submitLabel="Confirmar"
          onCode={async (code) => {
            const { error: err } = await authClient.twoFactor.verifyTotp({ code });
            if (err) return errorMessage(err.status);
            router.replace('/');
            router.refresh();
            return null;
          }}
        />
      </div>
    </>
  );
}

export function MfaVerify() {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);

  return (
    <>
      {useBackup ? (
        <CodeForm
          label="Código de recuperação"
          inputMode="text"
          submitLabel="Entrar"
          onCode={async (code) => {
            const { error: err } = await authClient.twoFactor.verifyBackupCode({ code });
            if (err) return errorMessage(err.status);
            router.replace('/');
            router.refresh();
            return null;
          }}
        />
      ) : (
        <CodeForm
          label="Código de 6 dígitos"
          inputMode="numeric"
          submitLabel="Entrar"
          onCode={async (code) => {
            const { error: err } = await authClient.twoFactor.verifyTotp({ code });
            if (err) return errorMessage(err.status);
            router.replace('/');
            router.refresh();
            return null;
          }}
        />
      )}
      <p>
        <button type="button" className="secondary" onClick={() => setUseBackup((v) => !v)}>
          {useBackup ? 'Usar o aplicativo autenticador' : 'Usar um código de recuperação'}
        </button>
      </p>
    </>
  );
}
