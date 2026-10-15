import { canEditClients } from '@contab/domain';
import { ActionForm } from '@/components/action-form';
import { requirePainel } from '@/server/painel';
import { createCompanyAction } from '../actions';
import { CompanyFields } from '../company-fields';

export default async function NovaEmpresaPage() {
  const { organization } = await requirePainel();
  if (!canEditClients(organization.role)) {
    return (
      <main>
        <h1>Nova empresa</h1>
        <p role="alert">Seu papel não permite cadastrar empresas.</p>
      </main>
    );
  }
  return (
    <main>
      <p>
        <a href="/clientes">← Clientes</a>
      </p>
      <h1>Nova empresa</h1>
      <ActionForm action={createCompanyAction} submitLabel="Cadastrar">
        <CompanyFields />
      </ActionForm>
    </main>
  );
}
