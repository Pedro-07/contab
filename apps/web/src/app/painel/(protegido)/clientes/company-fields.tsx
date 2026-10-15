import type { Company } from '@contab/db';
import { formatCnpj, POA_STATUSES, TAX_REGIMES } from '@contab/domain';
import { POA_STATUS_LABEL, REGIME_LABEL } from '@/lib/labels';

/** Campos da empresa, usados no cadastro e na edição. */
export function CompanyFields({ company }: { company?: Company }) {
  return (
    <>
      <label htmlFor="cnpj">CNPJ</label>
      <input
        id="cnpj"
        name="cnpj"
        required
        inputMode="text"
        autoComplete="off"
        defaultValue={company ? formatCnpj(company.cnpj) : ''}
      />
      <label htmlFor="legalName">Razão social</label>
      <input id="legalName" name="legalName" required defaultValue={company?.legalName ?? ''} />
      <label htmlFor="tradeName">Nome fantasia</label>
      <input id="tradeName" name="tradeName" defaultValue={company?.tradeName ?? ''} />
      <label htmlFor="regime">Regime tributário</label>
      <select id="regime" name="regime" required defaultValue={company?.regime ?? ''}>
        <option value="" disabled>
          Escolha
        </option>
        {TAX_REGIMES.map((r) => (
          <option key={r} value={r}>
            {REGIME_LABEL[r]}
          </option>
        ))}
      </select>
      <label htmlFor="stateRegistration">Inscrição estadual</label>
      <input
        id="stateRegistration"
        name="stateRegistration"
        defaultValue={company?.stateRegistration ?? ''}
      />
      <label htmlFor="municipalRegistration">Inscrição municipal</label>
      <input
        id="municipalRegistration"
        name="municipalRegistration"
        defaultValue={company?.municipalRegistration ?? ''}
      />
      <label htmlFor="poaStatus">Procuração eletrônica (e-CAC)</label>
      <select id="poaStatus" name="poaStatus" defaultValue={company?.poaStatus ?? 'nao_verificada'}>
        {POA_STATUSES.map((s) => (
          <option key={s} value={s}>
            {POA_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <label htmlFor="poaValidUntil">Procuração válida até</label>
      <input
        id="poaValidUntil"
        name="poaValidUntil"
        type="date"
        defaultValue={company?.poaValidUntil ?? ''}
      />
      <label htmlFor="notes">Observações internas</label>
      <textarea id="notes" name="notes" rows={3} defaultValue={company?.notes ?? ''} />
    </>
  );
}
