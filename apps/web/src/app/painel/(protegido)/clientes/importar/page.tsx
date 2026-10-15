import { CSV_COLUMNS } from '@contab/core';
import { canEditClients } from '@contab/domain';
import { requirePainel } from '@/server/painel';
import { ImportForm } from './import-form';

export default async function ImportarPage() {
  const { organization } = await requirePainel();
  if (!canEditClients(organization.role)) {
    return (
      <main>
        <h1>Importar clientes</h1>
        <p role="alert">Seu papel não permite importar clientes.</p>
      </main>
    );
  }
  return (
    <main>
      <p>
        <a href="/clientes">← Clientes</a>
      </p>
      <h1>Importar clientes</h1>
      <p>
        Uma linha por contato. Para uma empresa com dois contatos, repita o CNPJ em duas linhas.
        Pode ser o arquivo salvo pelo Excel (separado por ponto e vírgula).
      </p>
      <p>
        <a href="/clientes/importar/modelo" download>
          Baixar o modelo
        </a>
      </p>
      <details>
        <summary>Colunas do arquivo</summary>
        <p className="code">{CSV_COLUMNS.join('; ')}</p>
        <p className="muted">
          Obrigatórias: cnpj, razao_social e regime (SN, MEI, LP ou LR). Nas colunas de autorização,
          use &quot;sim&quot; ou &quot;não&quot;. Importar o mesmo arquivo de novo atualiza os dados
          sem duplicar.
        </p>
      </details>
      <ImportForm />
    </main>
  );
}
