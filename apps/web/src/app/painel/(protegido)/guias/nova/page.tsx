import { listClientCompanies } from '@contab/core';
import { canManageGuides, GUIDE_TYPES, isUuid } from '@contab/domain';
import { ActionForm } from '@/components/action-form';
import { GUIDE_TYPE_NAME } from '@/lib/labels';
import { requirePainel } from '@/server/painel';
import { createGuideAction } from '../actions';

/** Guia avulsa (contingência, P23): o escritório informa os dados e depois sobe o PDF. */
export default async function NovaGuiaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, organization } = await requirePainel();
  if (!canManageGuides(organization.role)) {
    return (
      <main>
        <h1>Nova guia</h1>
        <p role="alert">Seu papel não permite criar guias.</p>
      </main>
    );
  }
  const params = await searchParams;
  const { rows: companies } = await listClientCompanies(ctx, { status: 'ativa', limit: 2000 });
  const selected = isUuid(params.empresa) ? params.empresa : '';
  return (
    <main>
      <p>
        <a href="/guias">← Guias</a>
      </p>
      <h1>Nova guia avulsa</h1>
      <p className="muted">
        Use para guias que ainda não chegam sozinhas. Depois de criar, você envia o PDF e publica.
      </p>
      {companies.length === 0 ? (
        <p role="status">
          Cadastre uma empresa antes. <a href="/clientes/nova">Nova empresa</a>
        </p>
      ) : (
        <ActionForm action={createGuideAction} submitLabel="Criar guia">
          <label htmlFor="companyId">Empresa</label>
          <select id="companyId" name="companyId" required defaultValue={selected}>
            <option value="" disabled>
              Escolha
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.tradeName || c.legalName}
              </option>
            ))}
          </select>
          <label htmlFor="type">Tipo</label>
          <select id="type" name="type" required defaultValue="">
            <option value="" disabled>
              Escolha
            </option>
            {GUIDE_TYPES.map((t) => (
              <option key={t} value={t}>
                {GUIDE_TYPE_NAME[t]}
              </option>
            ))}
          </select>
          <label htmlFor="period">Competência (MM/AAAA)</label>
          <input id="period" name="period" required placeholder="10/2026" inputMode="numeric" />
          <label htmlFor="dueDate">Vencimento</label>
          <input id="dueDate" name="dueDate" type="date" required />
          <label htmlFor="amount">Valor (R$)</label>
          <input id="amount" name="amount" required inputMode="decimal" placeholder="1.234,56" />
          <label htmlFor="barcode">Linha digitável</label>
          <input id="barcode" name="barcode" inputMode="numeric" autoComplete="off" />
          <label htmlFor="pixCode">Pix copia e cola</label>
          <textarea id="pixCode" name="pixCode" rows={3} autoComplete="off" />
          <p className="muted">Informe a linha digitável, o Pix ou os dois.</p>
        </ActionForm>
      )}
    </main>
  );
}
