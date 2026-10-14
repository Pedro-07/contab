import { previewInvitation } from '@contab/core';
import { ActionForm } from '@/components/action-form';
import { ROLE_LABEL } from '@/lib/labels';
import { getRequestMeta } from '@/server/painel';
import { acceptInvitationAction } from './actions';

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewInvitation(token, await getRequestMeta());

  if (!preview) {
    return (
      <main>
        <h1>Convite indisponível</h1>
        <p role="alert">
          Este convite é inválido, expirou ou já foi usado. Peça um novo convite ao escritório.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Convite para {preview.tenantName}</h1>
      <p>
        Você foi convidado como <strong>{ROLE_LABEL[preview.role]}</strong> para o e-mail{' '}
        <strong>{preview.email}</strong>.
      </p>
      <p className="muted">Ao aceitar, enviaremos um link de acesso para esse e-mail.</p>
      <ActionForm action={acceptInvitationAction} submitLabel="Aceitar convite">
        <input type="hidden" name="token" value={token} />
      </ActionForm>
    </main>
  );
}
