import { getDeliverySettings } from '@contab/core';
import { canManageConnections } from '@contab/domain';
import { ActionForm } from '@/components/action-form';
import { requirePainel } from '@/server/painel';
import { saveSettingsAction } from './actions';

export default async function ConfiguracoesPage() {
  const { ctx, organization } = await requirePainel();
  if (!canManageConnections(organization.role)) {
    return (
      <main>
        <h1>Configurações</h1>
        <p role="alert">Seu papel não permite alterar as configurações.</p>
      </main>
    );
  }
  const s = await getDeliverySettings(ctx);
  return (
    <main>
      <h1>Configurações › Entrega</h1>
      <ActionForm action={saveSettingsAction} submitLabel="Salvar">
        <label htmlFor="reminderDaysBefore">Lembrete antes do vencimento (dias)</label>
        <input
          id="reminderDaysBefore"
          name="reminderDaysBefore"
          type="number"
          min={0}
          max={30}
          required
          defaultValue={s.reminderDaysBefore}
        />
        <p className="muted">Use 0 para não mandar lembrete.</p>
        <label htmlFor="deliveryHour">Horário dos lembretes e avisos (hora local)</label>
        <input
          id="deliveryHour"
          name="deliveryHour"
          type="number"
          min={6}
          max={20}
          required
          defaultValue={s.deliveryHour}
        />
        <label htmlFor="replyToEmail">E-mail que recebe as respostas dos clientes</label>
        <input
          id="replyToEmail"
          name="replyToEmail"
          type="email"
          defaultValue={s.replyToEmail ?? ''}
          autoComplete="email"
        />
        <p className="muted">
          Os e-mails saem com o nome do escritório; quando o cliente responde, a resposta vai para
          este endereço. Fuso: {s.timezone}.
        </p>
        <label htmlFor="meiGenerationDay">Dia de gerar o DAS do MEI</label>
        <input
          id="meiGenerationDay"
          name="meiGenerationDay"
          type="number"
          min={1}
          max={19}
          required
          defaultValue={s.meiGenerationDay}
        />
        <p className="muted">
          Com a Receita Federal conectada, o DAS do mês anterior sai sozinho nesse dia e vai para o
          cliente. O vencimento é dia 20.
        </p>
      </ActionForm>
    </main>
  );
}
